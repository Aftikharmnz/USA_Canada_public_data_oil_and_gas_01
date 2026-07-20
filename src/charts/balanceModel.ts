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
    stocks: "usa.eia.refined.distillate.total.stocks.weekly",
    production: "usa.eia.refined.distillate.total.production.weekly",
    imports: "usa.eia.refined.distillate.total.imports.weekly",
    exports: "usa.eia.refined.distillate.total.exports.weekly",
    productSupplied: "usa.eia.refined.distillate.total.product_supplied.weekly",
  },
  {
    familyId: "jet-fuel",
    familyLabel: "Kerosene-type jet fuel",
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
}

interface BalanceAssets {
  stocks: UsaChartAsset;
  production: UsaChartAsset;
  imports: UsaChartAsset;
  exports: UsaChartAsset;
  productSupplied: UsaChartAsset;
}

function numericByPeriod(asset: UsaChartAsset): Map<string, number> {
  const output = new Map<string, number>();
  for (const year of asset.recent_years) {
    for (const point of year.points) {
      if (point.value !== null && Number.isFinite(point.value)) {
        output.set(point.period, point.value);
      }
    }
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
  const stocks = numericByPeriod(assets.stocks);
  const flows: Record<BalanceComponent["role"], Map<string, number>> = {
    production: numericByPeriod(assets.production),
    imports: numericByPeriod(assets.imports),
    exports: numericByPeriod(assets.exports),
    product_supplied: numericByPeriod(assets.productSupplied),
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
    };
  }
  return null;
}
