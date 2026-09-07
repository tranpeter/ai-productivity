import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import {
  type Config,
  type AnalysisInput,
  type RecordData,
  type Issue,
  type PR,
  type Period,
  type Evidence,
  type Metric,
  type PeriodResult,
  type Report,
} from "../shared/contracts.js";
import { resolvePeriods } from "./periods.js";
const days = (a: string, b: string) =>
  (Date.parse(b) - Date.parse(a)) / 86400000;
const inside = (at: string, p: Period) => at >= p.start && at < p.end;
export const quantile = (values: number[], p: number) => {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b),
    x = (v.length - 1) * p,
    a = Math.floor(x);
  return v[a] + (v[Math.ceil(x)] - v[a]) * (x - a);
};
export const delta = (a: number | null, b: number | null) => ({
  absolute: a === null || b === null ? null : a - b,
  relative: a === null || b === null || b === 0 ? null : ((a - b) / b) * 100,
});
export function analyze(
  records: RecordData[],
  config: Config,
  input: AnalysisInput,
): Report {
  const { current, baseline } = resolvePeriods(input, config);
  let selected = records.filter((r) => input.sourceIds.includes(r.sourceId));
  const safeConfig = structuredClone(config);
  safeConfig.sources = safeConfig.sources.map((s) => ({
    ...s,
    args: [],
    command: undefined,
    mappings: {},
  }));
  return {
    id: randomUUID(),
    created: new Date().toISOString(),
    version: "1",
    config: safeConfig,
    input,
    current: periodAnalysis(selected, config, input, current),
    baseline: baseline
      ? periodAnalysis(selected, config, input, baseline)
      : null,
    synthetic: selected.some((r) => r.synthetic),
    warnings: [
      "Observed changes do not establish an AI tool effect.",
      "AI review rankings require recorded run IDs and configured integration identities.",
    ],
  };
}
function periodAnalysis(
  records: RecordData[],
  config: Config,
  input: AnalysisInput,
  p: Period,
): PeriodResult {
  const c = config.reporting,
    allIssues = records.filter((r): r is Issue => r.kind === "issue"),
    prs = records.filter(
      (r): r is PR =>
        r.kind === "pr" &&
        (!input.repositories.length ||
          input.repositories.includes(r.repository)),
    );
  const linked = new Set(prs.flatMap((r) => r.issueKeys));
  const issues = allIssues.filter(
    (r) =>
      r.type.toLowerCase() !== "epic" &&
      (!input.projects.length || input.projects.includes(r.project)) &&
      (!input.linkedOnly || linked.has(r.key)),
  );
  const result: PeriodResult = {
    period: p,
    metrics: [],
    evidence: [],
    stages: [],
    workMix: [],
    aging: [],
    epics: [],
    prs: [],
    unknownAI: 0,
    coverage: {
      issues: issues.length,
      completeIssues: issues.filter((r) => r.historyComplete).length,
      prs: prs.length,
      completePRs: prs.filter((r) => r.historyComplete).length,
      linked: issues.filter((i) => linked.has(i.key)).length,
    },
    warnings: [],
  };
  const durations: Record<string, number[]> = { cycle: [], pr: [], review: [] },
    stageSums: Record<string, number> = {},
    mix: Record<string, number> = {},
    epics = new Map<string, Issue[]>();
  let completions = 0,
    reopenN = 0,
    reopenYes = 0,
    immature = 0,
    defectN = 0,
    defectYes = 0;
  const excluded: Record<string, number> = { cycle: 0, pr: 0, review: 0 };
  const evidence = (
    metric: string,
    r: Issue | PR,
    value: number | null,
    reason?: string,
    exposure = "unknown",
  ) =>
    result.evidence.push({
      metric,
      sourceId: r.sourceId,
      id: r.kind === "issue" ? r.key : r.id,
      title: r.title,
      url: r.url,
      included: !reason,
      reason,
      value,
      exposure,
    });
  const exposure = (start: string | undefined, end: string) =>
    !start
      ? "unknown"
      : c.adoptionEvents.some((e) => {
            const at = DateTime.fromISO(e.date, { zone: c.timezone })
              .toUTC()
              .toISO()!;
            return start < at && end >= at;
          })
        ? "mixed"
        : "calendar-inferred";
  for (const i of issues) {
    const history = [...i.history].sort((a, b) => a.at.localeCompare(b.at));
    const start = history.find((h) => c.active.includes(h.to))?.at;
    const complete = c.done.includes(i.status)
      ? history.filter((h) => c.done.includes(h.to)).at(-1)?.at
      : undefined;
    const label = exposure(start, complete ?? i.coverageThrough);
    const omit =
      (input.excludeMixed && label === "mixed") ||
      c.exclusions.some(
        (w) =>
          complete &&
          complete >=
            DateTime.fromISO(w.start, { zone: c.timezone }).toUTC().toISO()! &&
          complete <
            DateTime.fromISO(w.end, { zone: c.timezone })
              .plus({ days: 1 })
              .toUTC()
              .toISO()!,
      );
    if (complete && inside(complete, p) && !c.canceled.includes(i.status)) {
      if (omit) {
        evidence(
          "throughput",
          i,
          null,
          "Excluded transition/mixed work",
          label,
        );
        continue;
      }
      completions++;
      evidence("throughput", i, 1, undefined, label);
      mix[i.type] = (mix[i.type] ?? 0) + 1;
      if (i.epic) {
        const key = i.sourceId + "::" + i.epic;
        const list = epics.get(key) ?? [];
        list.push(i);
        epics.set(key, list);
      }
      if (start && start <= complete && i.historyComplete) {
        const v = days(start, complete);
        durations.cycle.push(v);
        evidence("cycle", i, v, undefined, label);
        for (let h = 0; h < history.length; h++) {
          const e = history[h],
            next = history[h + 1]?.at ?? complete;
          const from = e.at < start ? start : e.at,
            to = next > complete ? complete : next;
          if (to > from) {
            const stage = c.stages[e.to] ?? "Unknown";
            stageSums[stage] = (stageSums[stage] ?? 0) + days(from, to);
          }
        }
      } else {
        excluded.cycle++;
        evidence(
          "cycle",
          i,
          null,
          "Missing or inconsistent start/history",
          label,
        );
      }
      const delivery = i.delivered ?? complete;
      const follow = DateTime.fromISO(delivery)
        .setZone(c.timezone)
        .plus({ days: c.followupDays })
        .toUTC()
        .toISO()!;
      if (
        c.productionLabels.length &&
        i.historyComplete &&
        i.coverageThrough >= follow
      ) {
        defectN++;
        const yes = allIssues.some(
          (d) =>
            d.sourceId === i.sourceId &&
            d.defectOf.includes(i.key) &&
            d.labels.some((l) => c.productionLabels.includes(l)) &&
            d.created >= delivery &&
            d.created <= follow,
        );
        if (yes) defectYes++;
        evidence("defects", i, yes ? 1 : 0);
      }
    }
    const anchor = history.find(
      (h) => c.done.includes(h.to) && inside(h.at, p),
    );
    if (anchor && !omit) {
      const until = DateTime.fromISO(anchor.at)
        .setZone(c.timezone)
        .plus({ days: c.followupDays })
        .toUTC()
        .toISO()!;
      if (!i.historyComplete || i.coverageThrough < until) {
        immature++;
        evidence("reopen", i, null, "Incomplete follow-up");
      } else {
        reopenN++;
        const yes = history.some(
          (h) =>
            h.at > anchor.at &&
            h.at <= until &&
            c.done.includes(h.from) &&
            !c.done.includes(h.to) &&
            !c.administrativeReopenIds.includes(h.id),
        );
        if (yes) reopenYes++;
        evidence("reopen", i, yes ? 1 : 0);
      }
    }
    const atEnd = history.filter((h) => h.at < p.end).at(-1)?.to;
    if (
      start &&
      start < p.end &&
      atEnd &&
      !c.done.includes(atEnd) &&
      !c.canceled.includes(atEnd)
    )
      result.aging.push({
        id: i.key,
        title: i.title,
        days: Math.max(
          0,
          days(start, p.end < i.coverageThrough ? p.end : i.coverageThrough),
        ),
      });
  }
  for (const pr of prs) {
    if (pr.merged && inside(pr.merged, p)) {
      if (pr.historyComplete && pr.merged >= pr.created) {
        const v = days(pr.created, pr.merged);
        durations.pr.push(v);
        evidence("pr", pr, v);
      } else {
        excluded.pr++;
        evidence("pr", pr, null, "Missing or inconsistent history");
      }
    }
    const ready = pr.ready ?? pr.created;
    if (inside(ready, p)) {
      const review = pr.reviews
        .filter(
          (r) =>
            r.at >= ready &&
            r.at <= pr.coverageThrough &&
            r.actor !== pr.author &&
            !c.bots.includes(r.actor),
        )
        .sort((a, b) => a.at.localeCompare(b.at))[0];
      if (review && pr.historyComplete) {
        const v = days(ready, review.at);
        durations.review.push(v);
        evidence("review", pr, v);
      } else {
        excluded.review++;
        evidence("review", pr, null, "Unreviewed or incomplete history");
      }
    }
    const reviewers =
      config.sources.find((s) => s.id === pr.sourceId)?.aiReviewers ?? [];
    const runs = [
      ...new Set(
        pr.reviews
          .filter(
            (r) =>
              inside(r.at, p) &&
              r.aiVerified &&
              r.aiRunId &&
              reviewers.includes(r.actor),
          )
          .map((r) => r.aiRunId!),
      ),
    ];
    if (runs.length)
      result.prs.push({
        id: pr.id,
        title: pr.title,
        url: pr.url,
        runs: runs.length,
        runIds: runs,
      });
    else if (pr.reviews.some((r) => inside(r.at, p))) result.unknownAI++;
  }
  const add = (m: Metric) => result.metrics.push(m);
  add({
    id: "throughput",
    label: "Completed work",
    unit: "issues",
    value: completions,
    n: completions,
    excluded: 0,
  });
  add({
    id: "weekly",
    label: "Throughput per week",
    unit: "issues/week",
    value: completions / (p.days / 7),
    n: completions,
    excluded: 0,
  });
  for (const [id, label] of [
    ["cycle", "Median cycle time"],
    ["pr", "PR turnaround"],
    ["review", "First human review"],
  ] as const)
    add({
      id,
      label,
      unit: "days",
      value: quantile(durations[id], 0.5),
      p75: quantile(durations[id], 0.75),
      n: durations[id].length,
      excluded: excluded[id],
      reason: durations[id].length
        ? undefined
        : "No eligible complete histories",
    });
  add({
    id: "reopen",
    label: `${c.followupDays}-day reopen rate`,
    unit: "%",
    value: reopenN ? (reopenYes / reopenN) * 100 : null,
    n: reopenN,
    numerator: reopenYes,
    excluded: immature,
    immature,
    reason: reopenN ? undefined : "No mature follow-up cohort",
  });
  add({
    id: "defects",
    label: "Linked escaped defects",
    unit: "%",
    value:
      c.productionLabels.length && defectN ? (defectYes / defectN) * 100 : null,
    n: defectN,
    numerator: defectYes,
    excluded: 0,
    reason: !c.productionLabels.length
      ? "Production-defect classification not configured"
      : defectN
        ? "Completion-date proxy where delivery is absent"
        : "No mature delivery cohort",
  });
  const capacity = c.capacity.find(
    (w) => w.start === p.startDate && w.end === p.endDate,
  );
  add({
    id: "capacity",
    label: "Capacity-normalized output",
    unit: "issues/developer-week",
    value: capacity ? completions / capacity.developerWeeks : null,
    n: completions,
    excluded: 0,
    reason: capacity
      ? undefined
      : "Historical capacity unavailable for this exact window",
  });
  result.stages = Object.entries(stageSums).map(([name, total]) => ({
    name,
    days: total / (durations.cycle.length || 1),
  }));
  result.workMix = Object.entries(mix).map(([type, count]) => ({
    type,
    count,
  }));
  result.epics = [...epics]
    .map(([_qualified, children]) => {
      const key = children[0].epic!;
      const epic = allIssues.find(
        (e) => e.key === key && e.sourceId === children[0].sourceId,
      );
      return {
        key,
        title: epic?.title ?? "Epic metadata unavailable",
        done: children.length,
        status: epic?.historyComplete
          ? (epic.history
              .filter((e) => e.at < p.end)
              .sort((a, b) => a.at.localeCompare(b.at))
              .at(-1)?.to ?? "Unknown")
          : "Unknown",
        children: children.map((c) => c.key),
      };
    })
    .sort((a, b) => b.done - a.done || a.key.localeCompare(b.key))
    .slice(0, 10);
  result.prs.sort((a, b) => b.runs - a.runs || a.id.localeCompare(b.id));
  result.prs = result.prs.slice(0, 10);
  result.aging.sort((a, b) => b.days - a.days);
  if (
    issues.some((i) => !i.historyComplete) ||
    prs.some((i) => !i.historyComplete)
  )
    result.warnings.push(
      "Partial source history: excluded records and coverage are shown.",
    );
  if (!issues.length)
    result.warnings.push(
      "No Jira records in selected scope; zero output is not evidence of a complete import.",
    );
  if (!prs.length) result.warnings.push("No PR records in selected scope.");
  if (
    c.adoptionEvents.some((e) => e.date >= p.startDate && e.date <= p.endDate)
  )
    result.warnings.push("This period crosses an AI adoption boundary.");
  return result;
}
