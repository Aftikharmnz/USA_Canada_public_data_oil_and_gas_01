import canadaGeographiesJson from "../../config/geographies/canada.json";
import usaGeographiesJson from "../../config/geographies/usa.json";
import canadaSeriesJson from "../../config/series/canada.json";
import usaSeriesJson from "../../config/series/usa.json";
import type { CountryCatalog, CountryCode, GeographyLevel, MetricDefinition } from "../types/catalog";

interface GeographyRegistry {
  levels: Array<{ id: string; label: string; granularity_rank: number }>;
  nodes: Array<{ id: string; name: string; level_id: string }>;
}

interface GeographyAvailability {
  source_geography_level_ids: string[];
  allowed_rollup_geography_level_ids?: string[];
  unsupported_levels: Array<{ level_id: string; reason: string }>;
}

interface SeriesDefinition {
  id: string;
  provider_id: string;
  metric_id: string;
  name: string;
  unit: string;
  frequency: string;
  geography_availability?: GeographyAvailability;
  geography_profile_id?: string;
}

interface SeriesRegistry {
  providers: Array<{ id: string; name: string }>;
  geography_profiles?: Record<string, GeographyAvailability>;
  series: SeriesDefinition[];
}

const levelLabels: Record<string, string> = {
  national: "Country",
  padd: "Petroleum district",
  padd_subdistrict: "PADD subdistrict",
  state_or_area: "State or producing area",
  province_territory: "Province or territory",
  source_region: "Source-defined region",
};

function titleCaseToken(value: string): string {
  return value
    .split("_")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function formatFrequency(value: string): MetricDefinition["frequency"] {
  if (value === "weekly") return "Weekly";
  if (value === "monthly") return "Monthly";
  throw new Error(`Unsupported illustrative frequency: ${value}`);
}

function categoryFor(metricId: string): string {
  if (metricId.includes("refinery")) return "Refining";
  if (metricId.includes("stocks")) return "Inventories";
  if (metricId.includes("imports") || metricId.includes("exports")) return "Trade";
  if (metricId.includes("product_supplied")) return "Implied demand";
  if (metricId.includes("production")) return "Supply";
  return "Supply and disposition";
}

function buildGeographyLevels(registry: GeographyRegistry): GeographyLevel[] {
  return registry.levels
    .map((level) => {
      const regions = registry.nodes
        .filter((node) => node.level_id === level.id)
        .map((node) => ({ id: node.id, label: node.name }))
        .sort((left, right) => left.label.localeCompare(right.label));
      return {
        id: level.id,
        label: level.label,
        regionLabel: levelLabels[level.id] ?? level.label,
        description: `${level.label} values are shown only when the active series registry permits this level.`,
        regions,
        rank: level.granularity_rank,
      };
    })
    .filter((level) => level.regions.length > 0)
    .sort((left, right) => left.rank - right.rank)
    .map(({ rank: _rank, ...level }) => level);
}

export function resolveSeriesGeographyAvailability(
  seriesRegistry: Pick<SeriesRegistry, "geography_profiles">,
  definition: Pick<
    SeriesDefinition,
    "id" | "geography_availability" | "geography_profile_id"
  >,
): GeographyAvailability {
  if (definition.geography_availability) return definition.geography_availability;

  const profileId = definition.geography_profile_id?.trim();
  if (profileId) {
    const profile = seriesRegistry.geography_profiles?.[profileId];
    if (profile) return profile;
    throw new Error(
      `Series ${definition.id} references missing geography profile "${profileId}".`,
    );
  }

  throw new Error(
    `Series ${definition.id} must define geography_availability or geography_profile_id.`,
  );
}

function buildMetrics(
  seriesRegistry: SeriesRegistry,
  geographies: GeographyLevel[],
): MetricDefinition[] {
  const rankByLevel = new Map(geographies.map((level, index) => [level.id, index]));
  const providers = new Map(seriesRegistry.providers.map((provider) => [provider.id, provider.name]));

  return seriesRegistry.series.map((definition) => {
    const availability = resolveSeriesGeographyAvailability(seriesRegistry, definition);
    const sourceLevels = new Set(availability.source_geography_level_ids);
    const allLevels = [
      ...availability.source_geography_level_ids,
      ...(availability.allowed_rollup_geography_level_ids ?? []),
    ];
    const geographyLevelIds = [...new Set(allLevels)]
      .filter((levelId) => rankByLevel.has(levelId))
      .sort((left, right) => (rankByLevel.get(left) ?? 999) - (rankByLevel.get(right) ?? 999));
    const geographyLevelOrigins = Object.fromEntries(
      geographyLevelIds.map((levelId) => [
        levelId,
        sourceLevels.has(levelId) ? "source-published" : "computed-rollup",
      ]),
    ) as MetricDefinition["geographyLevelOrigins"];

    return {
      id: definition.id,
      title: definition.name,
      category: categoryFor(definition.metric_id),
      frequency: formatFrequency(definition.frequency),
      unit: titleCaseToken(definition.unit),
      sourceLabel: providers.get(definition.provider_id) ?? definition.provider_id,
      description: `${definition.name}, using only geography levels declared by its Phase 1 registry.`,
      geographyLevelIds,
      geographyLevelOrigins,
      unavailableGeographyLevels: availability.unsupported_levels.map((level) => ({
        id: level.level_id,
        label: titleCaseToken(level.level_id),
        reason: level.reason,
      })),
    };
  });
}

function buildCatalog(
  code: CountryCode,
  geographyRegistry: GeographyRegistry,
  seriesRegistry: SeriesRegistry,
): CountryCatalog {
  const geographyLevels = buildGeographyLevels(geographyRegistry);
  const isUsa = code === "usa";
  return {
    code,
    name: isUsa ? "United States" : "Canada",
    shortName: isUsa ? "USA" : "Canada",
    eyebrow: isUsa ? "United States market view" : "Canadian market view",
    overview: isUsa
      ? "Explore petroleum supply, refinery activity, trade, and implied demand at the smallest geography each public series actually publishes."
      : "Explore Canadian production, refinery activity, and product disposition with geography choices constrained to each source's real coverage.",
    sourceSummary: isUsa
      ? "Planned primary source: U.S. Energy Information Administration"
      : "Planned primary sources: Statistics Canada and Canada Energy Regulator",
    geographyLevels,
    metrics: buildMetrics(seriesRegistry, geographyLevels),
  };
}

export const catalogs: Record<CountryCode, CountryCatalog> = {
  usa: buildCatalog(
    "usa",
    usaGeographiesJson as GeographyRegistry,
    usaSeriesJson as SeriesRegistry,
  ),
  canada: buildCatalog(
    "canada",
    canadaGeographiesJson as GeographyRegistry,
    canadaSeriesJson as SeriesRegistry,
  ),
};
