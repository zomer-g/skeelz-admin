/**
 * Quick Salesforce connectivity check, step by step, so a failure names the
 * step that failed: token → Run-As user → API version → visible objects →
 * read access per core object. Read-only; prints no secrets.
 *
 *   npm run sf:check
 */
import { sf } from "../src/lib/sf/client";
import { testConnection } from "../src/lib/sf/diagnostics";

const CORE = ["Account", "Contact", "Case"];

async function step<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const value = await fn();
    console.log(`✓ ${label}`);
    return value;
  } catch (err) {
    console.log(`✗ ${label}: ${(err as Error).message}`);
    return undefined;
  }
}

async function main() {
  const instanceUrl = await step("token (External Client App + Run-As user)", () => sf.instanceUrl());
  if (!instanceUrl) {
    process.exitCode = 1;
    return;
  }
  console.log(`  instance: ${instanceUrl}`);

  const user = await step("userinfo", () => sf.userInfo());
  if (user) console.log(`  running as: ${user.preferred_username} (${user.name})`);

  const versions = await step("API versions", () => sf.availableVersions());
  if (versions) {
    const configured = sf.apiVersion();
    console.log(`  configured v${configured}: ${versions.includes(configured) ? "available" : "NOT available"}; latest v${versions.at(-1)}`);
  }

  const global = await step("describeGlobal", () => sf.describeGlobal());
  if (global) {
    const names = new Set(global.sobjects.map((o) => o.name));
    console.log(`  visible objects: ${names.size}; ${CORE.map((n) => `${n}=${names.has(n) ? "yes" : "NO"}`).join(" ")}`);
  }

  const conn = await step("read access per object", () => testConnection());
  for (const o of conn?.objects ?? []) {
    console.log(`  ${o.name}: ${o.ok ? `${o.count} records` : o.error}`);
  }
}

main().catch((err: Error) => {
  console.error("[sf-check] FAILED:", err.message);
  process.exitCode = 1;
});
