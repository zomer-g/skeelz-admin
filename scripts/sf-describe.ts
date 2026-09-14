/**
 * Writes docs/sf-schema-report.md (and the raw JSON to .sf-describe/) from the
 * live org. Read-only. Needs SF_LOGIN_URL, SF_CLIENT_ID and SF_CLIENT_SECRET,
 * e.g. in a local .env:
 *
 *   npm run sf:describe                 # Case, Contact, Account
 *   npm run sf:describe -- Job__c Task  # extra objects
 */
import { mkdir, writeFile } from "node:fs/promises";
import { buildSchemaReport, DEFAULT_OBJECTS, reportToMarkdown } from "../src/lib/sf/schema-report";

async function main() {
  const extra = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const objects = [...new Set([...DEFAULT_OBJECTS, ...extra])];

  console.log(`[sf-describe] describing ${objects.join(", ")} …`);
  const report = await buildSchemaReport(objects);

  await mkdir(".sf-describe", { recursive: true });
  await writeFile(".sf-describe/report.json", JSON.stringify(report, null, 2));
  await writeFile("docs/sf-schema-report.md", reportToMarkdown(report));

  console.log("[sf-describe] wrote docs/sf-schema-report.md and .sf-describe/report.json");
  if (report.apiUsage) {
    console.log(`[sf-describe] API usage today: ${report.apiUsage.max - report.apiUsage.remaining}/${report.apiUsage.max}`);
  }
}

main().catch((err: Error) => {
  console.error("[sf-describe] FAILED:", err.message);
  // exitCode, not exit(): exiting with fetch sockets still closing aborts Node on Windows.
  process.exitCode = 1;
});
