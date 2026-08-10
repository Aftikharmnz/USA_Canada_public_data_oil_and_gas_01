import registry from "../../config/display/weekly-to-monthly.json";

export type WeeklyToMonthlyStrategy =
  | "rate_day_weighted"
  | "final_weekly_snapshot";

export interface WeeklyToMonthlySeriesRule {
  seriesId: string;
  country: "usa" | "canada";
  strategy: WeeklyToMonthlyStrategy;
  sourceUnit: string;
  sourcePeriodSemantics: string;
}

interface RegistryRule {
  country: string;
  strategy: string;
  source_unit: string;
  source_period_semantics: string;
  series_ids: string[];
}

interface WeeklyToMonthlyRegistryDocument {
  schema_version: string;
  methodology_version: string;
  source_frequency: string;
  target_frequency: string;
  week_period_role: string;
  rate_coverage_window: string;
  coverage_requirement: number;
  rules: RegistryRule[];
}

const RATE_UNITS = new Set([
  "thousand_barrels_per_day",
  "thousand_cubic_metres_per_day",
]);

const SNAPSHOT_SEMANTICS_BY_UNIT: Readonly<Record<string, string>> = {
  thousand_barrels: "end_of_week_stock",
  days: "end_of_week_days_of_supply",
  percent: "week_ending",
};

function loadRegistry(input: WeeklyToMonthlyRegistryDocument) {
  if (input.schema_version !== "1.0.0"
      || input.source_frequency !== "weekly"
      || input.target_frequency !== "monthly"
      || input.week_period_role !== "week_end"
      || input.rate_coverage_window !== "trailing_7_calendar_days_inclusive"
      || input.coverage_requirement !== 1) {
    throw new Error("The weekly-to-monthly display registry is incompatible.");
  }
  if (!input.methodology_version || !Array.isArray(input.rules) || !input.rules.length) {
    throw new Error("The weekly-to-monthly display registry is incomplete.");
  }

  const seen = new Set<string>();
  const series: WeeklyToMonthlySeriesRule[] = [];
  for (const rule of input.rules) {
    if (rule.country !== "usa" && rule.country !== "canada") {
      throw new Error(`Weekly-to-monthly rule has unsupported country ${String(rule.country)}.`);
    }
    if (rule.strategy !== "rate_day_weighted" && rule.strategy !== "final_weekly_snapshot") {
      throw new Error(`Weekly-to-monthly rule has unsupported strategy ${String(rule.strategy)}.`);
    }
    if (!rule.source_unit || !rule.source_period_semantics
        || !Array.isArray(rule.series_ids) || !rule.series_ids.length) {
      throw new Error("Weekly-to-monthly rule is incomplete.");
    }
    if (rule.strategy === "rate_day_weighted") {
      if (!RATE_UNITS.has(rule.source_unit)
          || rule.source_period_semantics !== "weekly_average_rate") {
        throw new Error("A day-weighted rule must describe a supported weekly average rate.");
      }
    } else if (SNAPSHOT_SEMANTICS_BY_UNIT[rule.source_unit] !== rule.source_period_semantics) {
      throw new Error("A snapshot rule must preserve stock, days-supply, or utilization semantics.");
    }

    for (const seriesId of rule.series_ids) {
      const expectedPrefix = rule.country === "usa" ? "usa." : "can.";
      if (!seriesId.startsWith(expectedPrefix) || !seriesId.endsWith(".weekly")) {
        throw new Error(`Weekly-to-monthly registry contains invalid series id ${seriesId}.`);
      }
      if (seen.has(seriesId)) {
        throw new Error(`Weekly-to-monthly registry contains duplicate series id ${seriesId}.`);
      }
      seen.add(seriesId);
      series.push(Object.freeze({
        seriesId,
        country: rule.country,
        strategy: rule.strategy,
        sourceUnit: rule.source_unit,
        sourcePeriodSemantics: rule.source_period_semantics,
      }) as WeeklyToMonthlySeriesRule);
    }
  }

  return Object.freeze({
    schemaVersion: input.schema_version,
    methodologyVersion: input.methodology_version,
    sourceFrequency: input.source_frequency,
    targetFrequency: input.target_frequency,
    weekPeriodRole: input.week_period_role,
    rateCoverageWindow: input.rate_coverage_window,
    coverageRequirement: input.coverage_requirement,
    series: Object.freeze(series),
  });
}

export const weeklyToMonthlyRegistry = loadRegistry(
  registry as WeeklyToMonthlyRegistryDocument,
);

const RULES_BY_SERIES_ID = new Map(
  weeklyToMonthlyRegistry.series.map((rule) => [rule.seriesId, rule]),
);

export function weeklyToMonthlyRuleForSeries(
  seriesId: string,
): WeeklyToMonthlySeriesRule | null {
  return RULES_BY_SERIES_ID.get(seriesId) ?? null;
}

export function supportsWeeklyToMonthlySeries(seriesId: string): boolean {
  return RULES_BY_SERIES_ID.has(seriesId);
}
