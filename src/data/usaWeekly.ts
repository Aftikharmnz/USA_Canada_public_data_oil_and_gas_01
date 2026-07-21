import type { UsaManifestSeries } from "../types/energyAssets";

/**
 * The weekly desk is a curated route over the verified USA manifest, not a
 * second source registry. This keeps source identity, geography, forecasts,
 * and update lineage identical to the main USA dashboard.
 */
export function verifiedUsaWeeklySeries(
  series: readonly UsaManifestSeries[],
): UsaManifestSeries[] {
  return series.filter((item) => item.frequency.toLowerCase().startsWith("week"));
}

export function usaWeeklyFamilyCount(series: readonly UsaManifestSeries[]): number {
  return new Set(verifiedUsaWeeklySeries(series).map((item) => (
    item.classification?.product_family_id ?? item.view_id
  ))).size;
}
