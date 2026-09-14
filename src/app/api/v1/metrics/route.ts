import { cachedApplicationFacts, countActiveJobs, siteTotals } from "@/lib/api/data";
import { apiError, apiJson, choiceParam, isDay, withApiToken } from "@/lib/api/inbound";
import { API_LIMITS } from "@/lib/api/spec";
import { addDays, israelDay, israelMidnight } from "@/lib/dashboard/params";
import { computeCandidateMetrics, countNewJobs, syncFreshness } from "@/lib/metrics/candidates";
import { inScope } from "@/lib/metrics/paid";

export const dynamic = "force-dynamic";

const round1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

/** The candidates-tab funnel and site totals for a range of Israel days. Aggregates only. */
export const GET = withApiToken(
  "GET /api/v1/metrics",
  async (req: Request) => {
    const params = new URL(req.url).searchParams;
    const toDay = params.get("to") || israelDay();
    const fromDay = params.get("from") || addDays(toDay, -29);
    if (!isDay(fromDay) || !isDay(toDay)) return apiError(400, "invalid_parameter", "from and to must be dates: YYYY-MM-DD.");
    if (fromDay > toDay) return apiError(400, "invalid_parameter", "from must not be after to.");
    const days = (Date.parse(toDay) - Date.parse(fromDay)) / 86_400_000 + 1;
    if (days > API_LIMITS.maxRangeDays) return apiError(400, "range_too_long", `The range may span at most ${API_LIMITS.maxRangeDays} days.`);
    const scope = choiceParam(params, "scope", ["paid", "all"] as const);
    const basis = choiceParam(params, "basis", ["application", "event"] as const);
    if (!scope) return apiError(400, "invalid_parameter", "scope must be paid or all.");
    if (!basis) return apiError(400, "invalid_parameter", "basis must be application or event.");

    const from = israelMidnight(fromDay);
    const to = israelMidnight(addDays(toDay, 1));
    const [facts, newJobs, active, site, freshness] = await Promise.all([
      cachedApplicationFacts(),
      countNewJobs(from, to),
      countActiveJobs(),
      siteTotals(fromDay, toDay, scope),
      syncFreshness(),
    ]);
    const m = computeCandidateMetrics(facts.filter(inScope(scope)), scope === "paid" ? newJobs.paid : newJobs.all, { from, to, basis });

    return apiJson({
      range: { from: fromDay, to: toDay, scope, basis },
      jobs: { new: m.newJobs, active: scope === "paid" ? active.paid : active.all },
      applications: {
        received: m.applications,
        status_new: m.statusNew,
        requested_cv: m.requestedCv,
        cv_received: m.cvReceived,
        in_handling: m.inHandling,
        sent_to_employer: m.sentToEmployer,
        employer_responded: m.employerResponded,
        interviews: m.interviews,
        accepted: m.accepted,
        rejected_by_us: m.rejectedByUs,
      },
      timing: {
        first_touch_hours_median: round1(m.firstTouchHours.median),
        days_to_transfer_median: round1(m.daysToTransfer.median),
      },
      reject_reasons: m.rejectReasons,
      site,
      data_freshness: { salesforce_synced_at: freshness.casesSyncedAt?.toISOString() ?? null },
    });
  },
  { heavy: true },
);
