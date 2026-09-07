import { DateTime } from "luxon";
import {
  type Config,
  type AnalysisInput,
  type Period,
} from "../shared/contracts.js";
export function resolvePeriods(
  input: AnalysisInput,
  config: Config,
): { current: Period; baseline: Period | null } {
  const zone = config.reporting.timezone,
    d = (s: string) => DateTime.fromISO(s, { zone }).startOf("day"),
    anchor = d(input.anchor);
  let start = anchor,
    end = anchor,
    bs: DateTime | undefined,
    be: DateTime | undefined;
  const quarter = (a: DateTime) => {
    const first = config.reporting.fiscalStartMonth;
    let year = a.year;
    if (a.month < first) year--;
    const origin = DateTime.fromObject(
      { year, month: first, day: 1 },
      { zone },
    );
    return origin.plus({
      months: 3 * Math.floor((a.year * 12 + a.month - (year * 12 + first)) / 3),
    });
  };
  switch (input.preset) {
    case "mom":
      end = anchor.startOf("month");
      start = end.minus({ months: 1 });
      bs = start.minus({ months: 1 });
      be = start;
      break;
    case "mtd":
      start = anchor.startOf("month");
      end = anchor;
      bs = start.minus({ months: 1 });
      be = bs.plus({ days: end.diff(start, "days").days });
      if (be > start) {
        be = start;
        end = start.plus({ days: be.diff(bs, "days").days });
      }
      break;
    case "qoq":
      end = quarter(anchor);
      start = end.minus({ months: 3 });
      bs = start.minus({ months: 3 });
      be = start;
      break;
    case "qtd":
      start = quarter(anchor);
      end = anchor;
      bs = start.minus({ months: 3 });
      be = bs.plus({ days: end.diff(start, "days").days });
      if (be > start) {
        be = start;
        end = start.plus({ days: be.diff(bs, "days").days });
      }
      break;
    case "adoption": {
      const events = [...config.reporting.adoptionEvents].sort((a, b) =>
        a.date.localeCompare(b.date),
      );
      const e = events.find((e) => e.name === input.adoptionName);
      if (!e) throw new Error("Choose a configured adoption event");
      start = d(e.date);
      end = anchor;
      break;
    }
    default:
      if (!input.start || !input.end)
        throw new Error("Start and end dates are required");
      start = d(input.start);
      end = d(input.end).plus({ days: 1 });
      if (input.preset === "yoy") {
        bs = start.minus({ years: 1 });
        be = end.minus({ years: 1 });
      }
  }
  if (end <= start)
    throw new Error("Analysis window must contain a complete day");
  if (input.comparison === "custom") {
    if (!input.baselineStart || !input.baselineEnd)
      throw new Error("Baseline dates required");
    bs = d(input.baselineStart);
    be = d(input.baselineEnd).plus({ days: 1 });
  }
  if (!bs || !be) {
    be = start;
    bs = start.minus({ days: end.diff(start, "days").days });
  }
  if (be <= bs) throw new Error("Invalid baseline window");
  const p = (a: DateTime, b: DateTime): Period => ({
    start: a.toUTC().toISO()!,
    end: b.toUTC().toISO()!,
    startDate: a.toISODate()!,
    endDate: b.minus({ days: 1 }).toISODate()!,
    days: Math.round(b.diff(a, "days").days),
    label: `${a.toFormat("LLL d, yyyy")} – ${b.minus({ days: 1 }).toFormat("LLL d, yyyy")}`,
  });
  return {
    current: p(start, end),
    baseline: input.comparison === "none" ? null : p(bs, be),
  };
}
