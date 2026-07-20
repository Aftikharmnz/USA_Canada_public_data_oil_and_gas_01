import registry from "../../config/display/monthly-average-rate.json";

interface MonthlyAverageRateRegistry {
  schema_version: string;
  methodology_version: string;
  country: string;
  source_unit: string;
  frequency: string;
  display_unit: string;
  normalization: string;
  series_ids: string[];
}

function loadRegistry(input: MonthlyAverageRateRegistry) {
  if (input.schema_version !== "1.0.0"
    || input.country !== "canada"
    || input.source_unit !== "cubic_metres"
    || input.frequency !== "monthly"
    || input.display_unit !== "thousand_barrels_per_day"
    || input.normalization !== "actual_calendar_days_in_source_period") {
    throw new Error("The monthly-average rate display registry is incompatible.");
  }
  if (!input.methodology_version || !Array.isArray(input.series_ids) || !input.series_ids.length) {
    throw new Error("The monthly-average rate display registry is incomplete.");
  }
  if (new Set(input.series_ids).size !== input.series_ids.length) {
    throw new Error("The monthly-average rate display registry contains duplicate series ids.");
  }
  if (input.series_ids.some((seriesId) => !seriesId.startsWith("can.statcan.") || !seriesId.endsWith(".monthly"))) {
    throw new Error("The monthly-average rate display registry contains an unsupported series id.");
  }
  return Object.freeze({
    ...input,
    series_ids: Object.freeze([...input.series_ids]),
  });
}

export const canadaMonthlyAverageRateRegistry = loadRegistry(registry);

const REGISTERED_SERIES = new Set(canadaMonthlyAverageRateRegistry.series_ids);

export function isRegisteredMonthlyAverageRateSeries(seriesId: string): boolean {
  return REGISTERED_SERIES.has(seriesId);
}

