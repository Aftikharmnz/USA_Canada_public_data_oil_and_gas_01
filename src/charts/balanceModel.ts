import type { UsaChartAsset } from "../types/energyAssets";

/**
 * National weekly product balance for the waterfall view.
 *
 * The identity mirrors the pipeline's registered fundamental driver sets
 * (`pipeline/energy_dashboard/fundamentals.py`):
 *
 *   stocks[t] - stocks[t-1] = 7 x (production + imports - exports - product supplied)
 *                             + unaccounted
 *
 * Only families whose every flow term is an active registered series are
 * offered. Gasoline is deliberately absent because weekly motor-gasoline
 * exports are inactive (EIA's June 2023 definition break), so its balance
 * cannot be presented without silently absorbing a large export term.
 * The identity closes only nationally; PADD balances omit inter-district
 * movements and are never computed here.
 */

export const DAYS_PER_WEEK = 7;

export interface BalanceFamilyRegistration {
  familyId: string;
  familyLabel: string;
  sourceProduct: string;
  stocks: string;
  production: string;
  imports: string;
  exports: string;
  productSupplied: string;
}

export const REGISTERED_BALANCE_FAMILIES: BalanceFamilyRegistration[] = [
  {
    familyId: "distillate",
    familyLabel: "Total distillate",
    sourceProduct: "EPD0",
    stocks: "usa.eia.refined.distillate.total.stocks.weekly",
    production: "usa.eia.refined.distillate.total.production.weekly",
    imports: "usa.eia.refined.distillate.total.imports.weekly",
    exports: "usa.eia.refined.distillate.total.exports.weekly",
    productSupplied: "usa.eia.refined.distillate.total.product_supplied.weekly",
  },
  {
    familyId: "jet-fuel",
    familyLabel: "Kerosene-type jet fuel",
    sourceProduct: "EPJK",
    stocks: "usa.eia.refined.jet.kerosene_type.stocks.weekly",
    production: "usa.eia.refined.jet.kerosene_type.production.weekly",
    imports: "usa.eia.refined.jet.kerosene_type.imports.weekly",
    exports: "usa.eia.refined.jet.kerosene_type.exports.weekly",
    productSupplied: "usa.eia.refined.jet.kerosene_type.product_supplied.weekly",
  },
];

export const EXCLUDED_BALANCE_FAMILIES: Record<string, string> = {
  gasoline:
    "Weekly motor-gasoline exports are inactive because of EIA's June 2023 definition "
    + "break, so the gasoline balance identity is incomplete and is not computed.",
};

export function balanceFamilyRegistration(
  familyId: string | undefined,
): BalanceFamilyRegistration | undefined {
  return REGISTERED_BALANCE_FAMILIES.find((item) => item.familyId === familyId);
}

export interface BalanceComponent {
  role: "production" | "imports" | "exports" | "product_supplied";
  label: string;
  sign: 1 | -1;
  ratePerDay: number;
  weeklyVolume: number;
}

export interface WeeklyBalanceModel {
  familyLabel: string;
  week: string;
  previousWeek: string;
  windowWeeks: number;
  components: BalanceComponent[];
  impliedChange: number;
  actualChange: number;
  unaccounted: number;
  stocksLevel: number;
  /** Newer incomplete source periods must never masquerade as a current balance. */
  latestSourceWeek: string;
  usesOlderCompleteWeek: boolean;
  sourceStatuses: string[];
}

interface BalanceAssets {
  stocks: UsaChartAsset;
  production: UsaChartAsset;
  imports: UsaChartAsset;
  exports: UsaChartAsset;
  productSupplied: UsaChartAsset;
}

const NUMERIC_STATUSES = new Set([
  "observed", "preliminary", "revised", "computed", "use_with_caution",
]);
const NONNUMERIC_STATUSES = new Set([
  "missing", "not_available", "not_applicable", "suppressed_or_withheld",
]);
const SOURCE_PROCESSES: Record<keyof BalanceAssets, string> = {
  stocks: "SAE", production: "YPR", imports: "IM0", exports: "EEX", productSupplied: "VPP",
};

function validateWeeklyPeriod(period: string): void {
  const timestamp = Date.parse(`${period}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period) || !Number.isFinite(timestamp)
      || new Date(timestamp).toISOString().slice(0, 10) !== period
      || new Date(timestamp).getUTCDay() !== 5) {
    throw new Error(`National weekly balance requires exact Friday week-ending periods: ${period}.`);
  }
}

function validatedPoints(asset: UsaChartAsset) {
  // Use the same visible seasonal sample as the existing balance. Do not allow
  // malformed duplicate rows to overwrite one another through Map.set.
  const points = asset.recent_years.flatMap((year) => year.points);
  const periods = new Set<string>();
  for (const point of points) {
    validateWeeklyPeriod(point.period);
    if (periods.has(point.period)) {
      throw new Error(`National weekly balance has duplicate period ${point.period}.`);
    }
    periods.add(point.period);
    const numeric = point.value !== null;
    if ((!NUMERIC_STATUSES.has(point.status) && !NONNUMERIC_STATUSES.has(point.status))
        || numeric !== NUMERIC_STATUSES.has(point.status)
        || (numeric && !Number.isFinite(point.value))) {
      throw new Error(`National weekly balance has incompatible value/status at ${point.period}.`);
    }
  }
  if (!points.length) throw new Error("National weekly balance requires period-level observations.");
  const latestPoint = [...points].sort((left, right) => left.period.localeCompare(right.period)).at(-1)!;
  if (asset.latest_source && (asset.latest_source.period !== latestPoint.period
      || asset.latest_source.value !== latestPoint.value
      || asset.latest_source.status !== latestPoint.status)) {
    throw new Error("National weekly balance latest-source metadata does not match the observations.");
  }
  return points;
}

function validateBalanceAssets(familyLabel: string, assets: BalanceAssets): void {
  const registration = REGISTERED_BALANCE_FAMILIES.find((family) => family.familyLabel === familyLabel);
  if (!registration) throw new Error(`National weekly balance is not registered for ${familyLabel}.`);
  for (const [key, asset] of Object.entries(assets) as Array<[keyof BalanceAssets, UsaChartAsset]>) {
    if (asset.series_id !== registration[key] || asset.geography_id !== "us"
        || asset.frequency !== "weekly"
        || asset.unit !== (key === "stocks" ? "thousand_barrels" : "thousand_barrels_per_day")) {
      throw new Error(`National weekly balance ${key} has incompatible series, geography, frequency, or unit.`);
    }
    if (asset.schema_version !== "1.0.0"
        || !asset.source_checksum || !asset.methodology_version
        || asset.methodology_version !== assets.stocks.methodology_version
        || !Number.isFinite(Date.parse(asset.generated_at))
        || asset.generated_at !== assets.stocks.generated_at) {
      throw new Error(`National weekly balance ${key} has incompatible schema or data vintage.`);
    }
    if (Object.keys(asset.dimensions).length !== 2
        || asset.dimensions.product !== registration.sourceProduct
        || asset.dimensions.process !== SOURCE_PROCESSES[key]) {
      throw new Error(`National weekly balance ${key} has incompatible source dimensions.`);
    }
  }
}

function numericByPeriod(points: ReturnType<typeof validatedPoints>): Map<string, number> {
  const output = new Map<string, number>();
  for (const point of points) {
    if (point.value !== null) output.set(point.period, point.value);
  }
  return output;
}

function previousWeek(period: string): string {
  const parsed = new Date(`${period}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 7);
  return parsed.toISOString().slice(0, 10);
}

const COMPONENT_LABELS: Record<BalanceComponent["role"], string> = {
  production: "Refinery & blender net production",
  imports: "Imports",
  exports: "Exports",
  product_supplied: "Product supplied (implied demand)",
};

/**
 * Build the latest complete national balance, averaging over `windowWeeks`
 * consecutive weeks (1 = latest week). Returns null instead of an incomplete
 * or gap-spanning balance: every flow and both stock endpoints must be
 * numeric on exactly consecutive week-ending dates.
 */
export function buildWeeklyBalanceModel(
  familyLabel: string,
  assets: BalanceAssets,
  windowWeeks: 1 | 4 = 1,
): WeeklyBalanceModel | null {
  if (windowWeeks !== 1 && windowWeeks !== 4) {
    throw new Error("National weekly balance supports only one or four consecutive weeks.");
  }
  validateBalanceAssets(familyLabel, assets);
  const points = {
    stocks: validatedPoints(assets.stocks),
    production: validatedPoints(assets.production),
    imports: validatedPoints(assets.imports),
    exports: validatedPoints(assets.exports),
    productSupplied: validatedPoints(assets.productSupplied),
  };
  const latestSourceWeek = Object.values(points).flat().map((point) => point.period).sort().at(-1)!;
  const stocks = numericByPeriod(points.stocks);
  const flows: Record<BalanceComponent["role"], Map<string, number>> = {
    production: numericByPeriod(points.production),
    imports: numericByPeriod(points.imports),
    exports: numericByPeriod(points.exports),
    product_supplied: numericByPeriod(points.productSupplied),
  };
  const candidateWeeks = [...stocks.keys()].sort().reverse();
  for (const week of candidateWeeks) {
    const weeks: string[] = [];
    let cursor = week;
    let complete = true;
    for (let step = 0; step < windowWeeks; step += 1) {
      const hasAllFlows = Object.values(flows).every((map) => map.has(cursor));
      if (!stocks.has(cursor) || !hasAllFlows) {
        complete = false;
        break;
      }
      weeks.push(cursor);
      cursor = previousWeek(cursor);
    }
    const startWeek = cursor;
    if (!complete || !stocks.has(startWeek)) continue;
    const components: BalanceComponent[] = (
      Object.keys(COMPONENT_LABELS) as BalanceComponent["role"][]
    ).map((role) => {
      const ratePerDay = weeks.reduce((total, item) => total + flows[role].get(item)!, 0)
        / weeks.length;
      const sign: 1 | -1 = role === "exports" || role === "product_supplied" ? -1 : 1;
      return {
        role,
        label: COMPONENT_LABELS[role],
        sign,
        ratePerDay,
        weeklyVolume: ratePerDay * DAYS_PER_WEEK,
      };
    });
    const impliedChange = components.reduce(
      (total, item) => total + item.sign * item.weeklyVolume,
      0,
    );
    const actualChange = (stocks.get(week)! - stocks.get(startWeek)!) / windowWeeks;
    return {
      familyLabel,
      week,
      previousWeek: startWeek,
      windowWeeks,
      components,
      impliedChange,
      actualChange,
      unaccounted: actualChange - impliedChange,
      stocksLevel: stocks.get(week)!,
      latestSourceWeek,
      usesOlderCompleteWeek: week !== latestSourceWeek,
      sourceStatuses: [...new Set(Object.entries(points).flatMap(([role, values]) => values
        .filter((point) => weeks.includes(point.period) || (role === "stocks" && point.period === startWeek))
        .map((point) => point.status)))].filter((status) => status !== "observed"),
    };
  }
  return null;
}
