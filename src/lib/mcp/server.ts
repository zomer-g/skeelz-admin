import { hit } from "@/lib/api/rate-limit";
import { writeAudit } from "@/lib/audit";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { appVersion } from "@/lib/connect/version";
import { logError } from "@/lib/log";
import { ArgError, parseArgs } from "./args";
import { MCP_LIMITS, PROTOCOL_VERSIONS, SERVER_NAME, SERVER_TITLE } from "./config";
import { mcpJson } from "./http";
import { touchGrant } from "./oauth";
import { describeTool, findTool, toolsFor, type ToolContext } from "./tools";

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
  switch (m.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : PROTOCOL_VERSIONS[0];
      const client = (params.clientInfo as { name?: unknown } | undefined)?.name;
      void writeAudit(ctx.principal.person.email, "mcp.initialize", ctx.principal.clientName, {
        grantId: ctx.principal.grantId,
        role: ctx.principal.role,
        clientInfo: typeof client === "string" ? client.slice(0, 100) : null,
        ip,
      });
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
      return rpcResult(m.id, { tools: toolsFor(ctx.principal.role).map(describeTool) });
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
  const found = findTool(name, principal.role);
  if (!found.ok) {
    if (found.reason === "forbidden") {
      void writeAudit(actor, "mcp.denied", name, { grantId: principal.grantId, role: principal.role, required: found.required });
      return toolText(`Not allowed: ${name} needs the ${found.required} role; this connection works as ${principal.role}.`, true);
    }
    return toolText(`Unknown tool: ${name}`, true);
  }
  const { tool } = found;

  const limits = [hit(`mcp:${principal.grantId}`, MCP_LIMITS.callsPerMinute, MIN), ...(tool.heavy ? [hit(`mcp-heavy:${principal.person.id}`, MCP_LIMITS.heavyPerMinute, MIN)] : [])];
  if (limits.some((l) => !l.ok)) return toolText("Rate limit reached; wait a minute and try again.", true);

  let args;
  try {
    args = parseArgs(tool.fields, tool.required ?? [], params.arguments);
  } catch (err) {
    return toolText(`Invalid arguments: ${(err as Error).message}`, true);
  }

  // Every call is in the activity log, as every screen view is.
  void writeAudit(actor, "mcp.call", tool.name, { grantId: principal.grantId, client: principal.clientName, role: principal.role, args });
  void touchGrant(principal.grantId, ip).catch((err: unknown) => logError("mcp touch", err));

  try {
    const data = await tool.run(args, ctx);
    return toolText(JSON.stringify(data, null, 1));
  } catch (err) {
    if (err instanceof ArgError) return toolText(err.message, true);
    // Never the message: a database error's message holds the SQL and its values.
    logError(`mcp ${tool.name}`, err);
    return toolText("Something went wrong on the server.", true);
  }
}
