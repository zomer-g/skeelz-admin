import { googleConfigured, googleFetch } from "./auth";

/** GA4 Data API (v1beta runReport) over REST. */

export function ga4Configured(): boolean {
  return Boolean(process.env.GA4_PROPERTY_ID) && googleConfigured();
}

interface RunReportResponse {
  rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
  rowCount?: number;
  propertyQuota?: { tokensPerDay?: { consumed: number; remaining: number } };
}

export interface ReportRow {
  dims: Record<string, string>;
  metrics: Record<string, number>;
}

export interface ReportRequest {
  startDate: string;
  endDate: string;
  dimensions: string[];
  metrics: string[];
  dimensionFilter?: unknown;
}

const PAGE_SIZE = 10_000;

export async function runReport(req: ReportRequest): Promise<{ rows: ReportRow[]; quotaRemaining: number | null }> {
  const property = process.env.GA4_PROPERTY_ID;
  if (!property) throw new Error("GA4_PROPERTY_ID is not set");

  const rows: ReportRow[] = [];
  let quotaRemaining: number | null = null;
  for (let offset = 0; ; ) {
    const res = await googleFetch<RunReportResponse>(
      `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(property)}:runReport`,
      {
        method: "POST",
        body: {
          dateRanges: [{ startDate: req.startDate, endDate: req.endDate }],
          dimensions: req.dimensions.map((name) => ({ name })),
          metrics: req.metrics.map((name) => ({ name })),
          dimensionFilter: req.dimensionFilter,
          limit: PAGE_SIZE,
          offset,
          returnPropertyQuota: true,
        },
      },
    );
    for (const r of res.rows ?? []) {
      rows.push({
        dims: Object.fromEntries(req.dimensions.map((d, i) => [d, r.dimensionValues[i]?.value ?? ""])),
        metrics: Object.fromEntries(req.metrics.map((m, i) => [m, Number(r.metricValues[i]?.value ?? 0)])),
      });
    }
    quotaRemaining = res.propertyQuota?.tokensPerDay?.remaining ?? quotaRemaining;
    offset += res.rows?.length ?? 0;
    if (!res.rows?.length || offset >= (res.rowCount ?? 0)) break;
  }
  return { rows, quotaRemaining };
}

/** "20260914" → "2026-09-14" */
export const gaDate = (value: string) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;

/** The public site's job pages: /job/<24-hex id>. */
export const JOB_PATH = /^\/job\/([0-9a-f]{24})/i;

export function jobKeyFromPath(path: string): string | null {
  return path.match(JOB_PATH)?.[1]?.toLowerCase() ?? null;
}
