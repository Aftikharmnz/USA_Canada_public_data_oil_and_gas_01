import seriesRegistry from "../../config/series/usa.json";
import geographyRegistry from "../../config/geographies/usa.json";
import type { UsaManifestSeries } from "../types/energyAssets";

interface MonthlyBalanceDefinition {
  id: string;
  unit: string;
  frequency: string;
  dimensions: string[];
  source: {
    api_query: {
      expected_series_geographies: Record<string, string | undefined>;
      expected_facets: Record<string, string | undefined>;
    };
  };
  geography_availability: { source_geography_ids: string[] };
}

const monthlyBalances = new Map<string, MonthlyBalanceDefinition>(
  seriesRegistry.series
    .filter((definition) => definition.provider_id === "eia"
      && definition.activation_status === "active"
      && definition.source.route_template === "/v2/petroleum/sum/snd/data")
    .map((definition) => [definition.id, definition as MonthlyBalanceDefinition]),
);

/**
 * A PSM source key includes its geography. Validate both registered identities
 * before excluding them from a cross-region semantic comparison. Source assets
 * retain these lineage fields; every other dimension remains comparable.
 */
export function eiaRegionalDimensions(
  series: Pick<UsaManifestSeries, "series_id" | "frequency" | "unit">,
  geographyId: string,
  dimensions: Record<string, string>,
): Record<string, string> {
  const definition = monthlyBalances.get(series.series_id);
  if (!definition) return { ...dimensions };

  const geography = geographyRegistry.nodes.find((node) => node.id === geographyId);
  const providerCodes = geography && [
    geography.provider_codes.eia_duoarea,
    ...("provider_code_aliases" in geography
      ? geography.provider_code_aliases?.eia_duoarea ?? []
      : []),
  ];
  const query = definition.source.api_query;
  if (
    series.frequency !== definition.frequency
    || series.unit !== definition.unit
    || !definition.geography_availability.source_geography_ids.includes(geographyId)
    || !providerCodes?.includes(dimensions.duoarea)
    || !dimensions.series
    || query.expected_series_geographies[dimensions.series] !== dimensions.duoarea
    || definition.dimensions.some((name) => !dimensions[name])
    || Object.entries(query.expected_facets).some(([name, value]) => !value || dimensions[name] !== value)
  ) {
    throw new Error(`EIA regional source dimensions do not match the registered identity for ${series.series_id}/${geographyId}.`);
  }

  const { duoarea: _duoarea, series: _sourceSeries, ...semanticDimensions } = dimensions;
  return semanticDimensions;
}
