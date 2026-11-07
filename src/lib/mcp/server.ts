import { firstInWindow, hit } from "@/lib/api/rate-limit";
import { recordIds } from "@/lib/audit-ids";
import { AuditWriteError, writeAudit, writeAuditStrict } from "@/lib/audit";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { appVersion } from "@/lib/connect/version";
import { logError } from "@/lib/log";
import { afterExport, atExportLimit, dailyExportUsage, EXPORT_LIMITS, MCP_PEOPLE_LISTED } from "@/lib/security/exports";
import { LockTimeoutError, withUserLock } from "@/lib/security/lock";
import { ArgError, parseArgs } from "./args";
import { MCP_LIMITS, PROTOCOL_VERSIONS, SERVER_NAME, SERVER_TITLE } from "./config";
import { mcpJson } from "./http";
import { touchGrant } from "./oauth";
import { describeTool, findTool, toolsFor, type Tool, type ToolContext } from "./tools";

/**
 * The MCP protocol over Streamable HTTP, stateless: every POST carries one JSON-RPC message
 * (or a batch) and gets plain JSON back. No sessions and no server-sent events — the bearer
 * token identifies the caller on every request, so there is nothing to keep between them.
 */

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const MIN = 60_000;
/** Messages one POST may carry: clients send one, or a handful; thousands is a flood. */
const MAX_BATCH = 20;

const INSTRUCTIONS = `SKEELZ Admin: the back office of jobs.skeelz.co.il, an Israeli job board, read from its Salesforce mirror and Google Analytics.
Data is in Hebrew. Jobs and applications are Salesforce Cases; candidates are Contacts; companies are jobs grouped by company name.
Figures default to the "paid" scope (paid jobs and the applications to them), as the dashboard does; pass scope=all for every job.
Each result carries admin_url links to the matching screen; share them so the person can check the source.
The tools available depend on the person's role on the site. Personal data of candidates is confidential: use it only for the task at hand.`;

const rpcResult = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: RpcRequest["id"] | undefined, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

const isRequest = (m: unknown): m is RpcRequest =>
  Boolean(m) && typeof m === "object" && (m as RpcRequest).jsonrpc === "2.0" && typeof (m as RpcRequest).method === "string";

/** Handles a POSTed body: one message or a batch. Notifications and responses get no reply (202 when nothing is left). */
export async function handleRpc(body: unknown, ctx: ToolContext, ip: string): Promise<Response> {
  const batch = Array.isArray(body);
  const messages = batch ? body : [body];
  if (!messages.length) return mcpJson(rpcError(null, -32600, "Empty batch"), 400);
  if (messages.length > MAX_BATCH) return mcpJson(rpcError(null, -32600, `Batch too large (at most ${MAX_BATCH} messages)`), 400);

  const replies: unknown[] = [];
  for (const m of messages) {
    if (!isRequest(m)) {
      // A client's response to a server request (we send none) or junk.
      if (m && typeof m === "object" && "result" in m) continue;
      replies.push(rpcError(null, -32600, "Invalid Request"));
      continue;
    }
    if (m.id === undefined || m.id === null) continue; // a notification
    replies.push(await dispatch(m, ctx, ip));
  }
  if (!replies.length) return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
  return mcpJson(batch ? replies : replies[0]);
}

async function dispatch(m: RpcRequest, ctx: ToolContext, ip: string) {
  const params = m.params && typeof m.params === "object" ? m.params : {};
  // Every request counts against the connection's budget — before anything is written to the
  // activity log, so a client cannot fill it with denied calls or handshakes.
  if (!hit(`mcp:${ctx.principal.grantId}`, MCP_LIMITS.callsPerMinute, MIN).ok) {
    return rpcError(m.id, -32000, "Rate limit reached; wait a minute and try again.");
  }
  switch (m.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : PROTOCOL_VERSIONS[0];
      const client = (params.clientInfo as { name?: unknown } | undefined)?.name;
      // A handshake per session is worth a line; one every request is not.
      if (firstInWindow(`mcp-init:${ctx.principal.grantId}`, MIN)) {
        void writeAudit(ctx.principal.person.email, "mcp.initialize", ctx.principal.clientName, {
          grantId: ctx.principal.grantId,
          role: ctx.principal.role,
          clientInfo: typeof client === "string" ? client.slice(0, 100) : null,
          ip,
        });
      }
      return rpcResult(m.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, title: SERVER_TITLE, version: appVersion() },
        instructions: `${INSTRUCTIONS}\nThis connection works as ${ctx.principal.person.email} with the role ${ctx.principal.role} (${ROLE_LABELS[ctx.principal.role]}).`,
      });
    }
    case "ping":
      return rpcResult(m.id, {});
    case "tools/list":
      return rpcResult(m.id, { tools: toolsFor(ctx.principal.role, ctx.principal.staffData).map(describeTool) });
    case "tools/call":
      return rpcResult(m.id, await callTool(params, ctx, ip));
    case "resources/list":
      return rpcResult(m.id, { resources: [] });
    case "resources/templates/list":
      return rpcResult(m.id, { resourceTemplates: [] });
    case "prompts/list":
      return rpcResult(m.id, { prompts: [] });
    default:
      return rpcError(m.id, -32601, `Method not found: ${m.method}`);
  }
}

const toolText = (text: string, isError = false) => ({ content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });

async function callTool(params: Record<string, unknown>, ctx: ToolContext, ip: string) {
  const { principal } = ctx;
  const actor = principal.person.email;
  const name = typeof params.name === "string" ? params.name : "";
  const found = findTool(name, principal.role, principal.staffData);
  if (!found.ok) {
    if (found.reason === "forbidden") {
      void writeAudit(actor, "mcp.denied", name, { grantId: principal.grantId, role: principal.role, required: found.required });
      return toolText(`Not allowed: ${name} needs the ${found.required} role; this connection works as ${principal.role}.`, true);
    }
    // Unknown — or a staff tool on a connection without staff data, which must look the same.
    // Probing leaves a trace (once per connection, name and ten minutes).
    if (firstInWindow(`mcp-unknown:${principal.grantId}:${name.slice(0, 80)}`, 10 * MIN)) {
      void writeAudit(actor, "mcp.denied", name.slice(0, 100), { grantId: principal.grantId, role: principal.role, reason: "unknown_tool" });
    }
    return toolText(`Unknown tool: ${name}`, true);
  }
  const { tool } = found;

  // The per-connection budget was counted in dispatch(); the heavy tools have one more, per person.
  if (tool.heavy && !hit(`mcp-heavy:${principal.person.id}`, MCP_LIMITS.heavyPerMinute, MIN).ok) {
    return toolText("Rate limit reached; wait a minute and try again.", true);
  }

  let args;
  try {
    args = parseArgs(tool.fields, tool.required ?? [], params.arguments);
  } catch (err) {
    if (firstInWindow(`mcp-badargs:${principal.grantId}:${tool.name}`, MIN)) {
      void writeAudit(actor, "mcp.denied", tool.name, { grantId: principal.grantId, role: principal.role, reason: "invalid_arguments" });
    }
    return toolText(`Invalid arguments: ${(err as Error).message}`, true);
  }

  // Every call is in the activity log, as every screen view is. A tool that returns people does
  // not run unless this entry was written.
  const callEntry = { grantId: principal.grantId, client: principal.clientName, role: principal.role, args };
  if (tool.people) {
    try {
      await writeAuditStrict(actor, "mcp.call", tool.name, callEntry);
    } catch {
      return toolText("The activity log is unavailable right now, so this tool did not run. Try again in a moment.", true);
    }
  } else {
    void writeAudit(actor, "mcp.call", tool.name, callEntry);
  }
  void touchGrant(principal.grantId, ip).catch((err: unknown) => logError("mcp touch", err));

  try {
    const data = tool.people ? await withUserLock("exports", actor, () => runCountingPeople(tool, args, ctx, actor)) : await tool.run(args, ctx);
    if (typeof data === "string") return toolText(data, true);
    return toolText(JSON.stringify(data, null, 1));
  } catch (err) {
    if (err instanceof ArgError) return toolText(err.message, true);
    if (err instanceof AuditWriteError) return toolText("The activity log is unavailable right now, so no personal details were sent. Try again in a moment.", true);
    if (err instanceof LockTimeoutError) return toolText("A previous request of yours is still running; try again in a moment.", true);
    // Never the message: a database error's message holds the SQL and its values.
    logError(`mcp ${tool.name}`, err);
    return toolText("Something went wrong on the server.", true);
  }
}

/**
 * A tool that returns people, under the person's export lock: the budget check, the run and the
 * counted entry cannot interleave with another hand-over of theirs. The entry names the records
 * the answer carried (lib/audit-ids.ts) and is written strictly: when it fails, nothing is sent.
 * A string is the refusal to show.
 */
async function runCountingPeople(tool: Tool, args: Parameters<Tool["run"]>[0], ctx: ToolContext, actor: string): Promise<unknown> {
  // A tool that returns people counts against the person's daily export budget, like the copy buttons.
  const usage = await dailyExportUsage(actor);
  if (usage.exported >= usage.allowed) {
    await atExportLimit(actor, usage, `mcp:${tool.name}`);
    return `Daily export limit reached: ${usage.allowed.toLocaleString("en-US")} people's details a day per person, across the site's copy buttons and these tools. The admins were notified and can allow another ${EXPORT_LIMITS.grant.toLocaleString("en-US")} today at /admin/security.`;
  }
  const data = await tool.run(args, ctx);
  const count = tool.people ? tool.people(data) : 0;
  if (count > 0) {
    const { ids, more } = recordIds(data);
    await writeAuditStrict(actor, MCP_PEOPLE_LISTED, tool.name, { grantId: ctx.principal.grantId, count, ids, ...(more ? { more_ids: true } : {}) });
    await afterExport(actor, usage, count);
  }
  return data;
}
