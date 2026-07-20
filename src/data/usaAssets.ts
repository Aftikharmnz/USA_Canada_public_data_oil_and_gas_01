import {
  SUPPORTED_ASSET_SCHEMA,
  type AssetFreshness,
  type CandidateFit,
  type DistributionSample,
  type FreshnessStatus,
  type HistogramBin,
  type ManifestGeography,
  type RemoteState,
  type SeriesClassification,
  type UsaAssetManifest,
  type UsaChartAsset,
  type UsaManifestSeries,
} from "../types/energyAssets";
import type { CountryCode } from "../types/catalog";
import { catalogs } from "./catalog";

const lastKnownGood = new Map<string, unknown>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${context} must be an object.`);
  return value;
}

function array(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${context} must be an array.`);
  return value;
}

function string(value: unknown, context: string, fallback?: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${context} must be a non-empty string.`);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function number(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${context} must be a finite number.`);
  }
  return value;
}

function nullableNumber(value: unknown, context: string): number | null {
  if (value === null || value === undefined) return null;
  return number(value, context);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function parseClassification(value: unknown, context: string): SeriesClassification | undefined {
  if (value === undefined) return undefined;
  const input = record(value, context);
  const referenceTermIds = array(input.reference_term_ids, `${context}.reference_term_ids`).map(
    (item, index) => string(item, `${context}.reference_term_ids[${index}]`),
  );
  if (input.parent_product_id !== null && typeof input.parent_product_id !== "string") {
    throw new Error(`${context}.parent_product_id must be a non-empty string or null.`);
  }
  const parentProductId = input.parent_product_id === null
    ? null
    : string(input.parent_product_id, `${context}.parent_product_id`);

  return {
    dashboard_group: string(input.dashboard_group, `${context}.dashboard_group`),
    product_family_id: string(input.product_family_id, `${context}.product_family_id`),
    product_family_label: string(input.product_family_label, `${context}.product_family_label`),
    product_id: string(input.product_id, `${context}.product_id`),
    product_label: string(input.product_label, `${context}.product_label`),
    measure_id: string(input.measure_id, `${context}.measure_id`),
    measure_label: string(input.measure_label, `${context}.measure_label`),
    component_role: string(input.component_role, `${context}.component_role`),
    parent_product_id: parentProductId,
    reference_term_ids: referenceTermIds,
    display_order: number(input.display_order, `${context}.display_order`),
  };
}

function freshnessStatus(value: unknown): FreshnessStatus {
  return ["fresh", "due", "late", "stale", "error"].includes(String(value))
    ? (value as FreshnessStatus)
    : "unknown";
}

function parseFreshness(value: unknown, fallbackStatus: FreshnessStatus): AssetFreshness {
  const input = isRecord(value) ? value : {};
  const expectedPeriod = optionalString(input.expected_period);
  const hasExplicitStatus = input.status !== undefined && input.status !== null;
  const parsedStatus = freshnessStatus(hasExplicitStatus ? input.status : fallbackStatus);
  return {
    status: !hasExplicitStatus && parsedStatus === "fresh" && !expectedPeriod
      ? "unknown"
      : parsedStatus,
    latest_period: optionalString(input.latest_period),
    latest_numeric_period: optionalString(input.latest_numeric_period),
    latest_observation_status: optionalString(input.latest_observation_status),
    expected_period: expectedPeriod,
    checked_at: optionalString(input.checked_at),
    retrieved_at: optionalString(input.retrieved_at),
    source_release_at: optionalString(input.source_release_at),
    expected_next_release_at: optionalString(input.expected_next_release_at),
    last_success_at: optionalString(input.last_success_at),
    error: optionalString(input.error),
  };
}

function parseSource(value: unknown, input: Record<string, unknown>) {
  if (typeof value === "string") return { name: value };
  const source = isRecord(value) ? value : {};
  return {
    name: string(source.name ?? input.source_name, "series.source.name", "Official public source"),
    url: optionalString(source.url ?? input.source_url),
    notes: optionalString(source.notes ?? input.source_notes),
  };
}

function parseGeography(value: unknown, index: number): ManifestGeography {
  const input = record(value, `series.geographies[${index}]`);
  const assetPath = optionalString(input.asset_path);
  const rawStatus = input.status;
  const status = rawStatus === "unavailable" || (!assetPath && rawStatus !== "available")
    ? "unavailable"
    : "available";
  return {
    geography_id: string(input.geography_id, "geography.geography_id"),
    label: string(input.label ?? input.geography_label, "geography.label"),
    level_id: string(input.level_id, "geography.level_id"),
    level_label: string(input.level_label, "geography.level_label"),
    granularity_rank: input.granularity_rank === undefined
      ? undefined
      : number(input.granularity_rank, "geography.granularity_rank"),
    origin: input.origin === "computed-rollup" ? "computed-rollup" : "source-published",
    status,
    asset_path: assetPath,
    forecast_path: optionalString(input.forecast_path),
    reason: optionalString(input.reason),
  };
}

function parseManifestSeries(value: unknown, index: number, globalStatus: FreshnessStatus): UsaManifestSeries {
  const input = record(value, `manifest.series[${index}]`);
  const geographies = array(input.geographies, `manifest.series[${index}].geographies`).map(
    parseGeography,
  );
  const unsupportedRaw = Array.isArray(input.unsupported_levels) ? input.unsupported_levels : [];
  return {
    view_id: string(input.view_id, "series.view_id", string(input.series_id, "series.series_id")),
    series_id: string(input.series_id, "series.series_id"),
    metric_id: optionalString(input.metric_id),
    title: string(input.title ?? input.name, "series.title"),
    category: string(input.category, "series.category", "Energy market"),
    description: optionalString(input.description),
    unit: string(input.unit, "series.unit"),
    frequency: string(input.frequency, "series.frequency"),
    source: parseSource(input.source, input),
    freshness: parseFreshness(input.freshness, globalStatus),
    classification: parseClassification(
      input.classification,
      `manifest.series[${index}].classification`,
    ),
    geographies,
    unsupported_levels: unsupportedRaw.map((item, unsupportedIndex) => {
      const level = record(item, `series.unsupported_levels[${unsupportedIndex}]`);
      return {
        level_id: string(level.level_id, "unsupported level id"),
        label: string(level.label, "unsupported level label"),
        reason: string(level.reason, "unsupported level reason"),
      };
    }),
  };
}

function humanizeIdentifier(value: string): string {
  return value
    .split(/[._:-]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function parseAssetListManifest(
  input: Record<string, unknown>,
  status: FreshnessStatus,
  country: CountryCode,
): UsaManifestSeries[] {
  const assets = array(input.assets, "manifest.assets");
  const catalog = catalogs[country];
  const groups = new Map<string, { seriesId: string; dimensions: Record<string, string>; items: Record<string, unknown>[] }>();

  for (const [index, rawAsset] of assets.entries()) {
    const asset = record(rawAsset, `manifest.assets[${index}]`);
    const seriesId = string(asset.series_id, "manifest asset series_id");
    const dimensionsRecord = isRecord(asset.dimensions) ? asset.dimensions : {};
    const dimensions = Object.fromEntries(
      Object.entries(dimensionsRecord)
        .map(([key, value]) => [key, String(value)] as [string, string])
        .sort((left, right) => left[0].localeCompare(right[0])),
    );
    const groupKey = `${seriesId}:${JSON.stringify(dimensions)}`;
    const group: { seriesId: string; dimensions: Record<string, string>; items: Record<string, unknown>[] } =
      groups.get(groupKey) ?? { seriesId, dimensions, items: [] };
    group.items.push(asset);
    groups.set(groupKey, group);
  }

  return [...groups.entries()].map(([viewId, group]) => {
    const catalogMetric = catalog.metrics.find((metric) => metric.id === group.seriesId);
    const dimensionLabel = Object.entries(group.dimensions)
      .map(([key, value]) => `${humanizeIdentifier(key)}: ${humanizeIdentifier(value)}`)
      .join(" · ");
    const geographies = group.items.map((item): ManifestGeography => {
      const geographyId = string(item.geography_id, "manifest asset geography_id");
      const level = catalog.geographyLevels.find((candidate) =>
        candidate.regions.some((region) => region.id === geographyId),
      );
      const node = level?.regions.find((region) => region.id === geographyId);
      return {
        geography_id: geographyId,
        label: node?.label ?? humanizeIdentifier(geographyId),
        level_id: level?.id ?? "source_defined",
        level_label: level?.label ?? "Source-defined geography",
        origin: level && catalogMetric?.geographyLevelOrigins[level.id] === "computed-rollup"
          ? "computed-rollup"
          : "source-published",
        status: "available",
        asset_path: string(item.path, "manifest asset path"),
        forecast_path: optionalString(item.forecast_path),
      };
    }).sort((left, right) => {
      const leftRank = catalogMetric?.geographyLevelIds.indexOf(left.level_id) ?? -1;
      const rightRank = catalogMetric?.geographyLevelIds.indexOf(right.level_id) ?? -1;
      return (leftRank < 0 ? 999 : leftRank) - (rightRank < 0 ? 999 : rightRank)
        || left.label.localeCompare(right.label);
    });
    const latestPeriod = group.items
      .map((item) => optionalString(item.latest_period))
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);
    return {
      view_id: viewId,
      series_id: group.seriesId,
      metric_id: catalogMetric?.id,
      title: `${catalogMetric?.title ?? humanizeIdentifier(group.seriesId)}${dimensionLabel ? ` · ${dimensionLabel}` : ""}`,
      category: catalogMetric?.category ?? "Energy market",
      description: catalogMetric?.description,
      unit: catalogMetric?.unit ?? "Source unit",
      frequency: catalogMetric?.frequency ?? "Source frequency",
      source: { name: catalogMetric?.sourceLabel ?? "Official public source" },
      freshness: {
        status: status === "fresh" ? "unknown" : status,
        latest_period: latestPeriod,
      },
      geographies,
      unsupported_levels: catalogMetric?.unavailableGeographyLevels.map((level) => ({
        level_id: level.id,
        label: level.label,
        reason: level.reason,
      })) ?? [],
    };
  });
}

export function parsePublicManifest(value: unknown, country: CountryCode): UsaAssetManifest {
  const countryLabel = country === "usa" ? "USA" : "Canada";
  const input = record(value, `${countryLabel} manifest`);
  if (input.schema_version !== SUPPORTED_ASSET_SCHEMA) {
    throw new Error(
      `Unsupported ${countryLabel} manifest schema: ${String(input.schema_version)}. Expected ${SUPPORTED_ASSET_SCHEMA}.`,
    );
  }
  const status = freshnessStatus(input.status);
  const series = Array.isArray(input.series)
    ? input.series.map((item, index) => parseManifestSeries(item, index, status))
    : Array.isArray(input.assets)
      ? parseAssetListManifest(input, status, country)
      : [];
  if (!series.length) throw new Error(`${countryLabel} manifest does not contain any series.`);
  return {
    schema_version: SUPPORTED_ASSET_SCHEMA,
    generated_at: string(input.generated_at, "manifest.generated_at"),
    last_success_at: optionalString(input.last_success_at),
    status,
    series,
  };
}

export function parseUsaManifest(value: unknown): UsaAssetManifest {
  return parsePublicManifest(value, "usa");
}

function parseFit(value: unknown): CandidateFit | null {
  if (value === null || value === undefined) return null;
  const input = record(value, "distribution.fit");
  const rawCandidates = Array.isArray(input.tested_candidates) ? input.tested_candidates : [];
  return {
    status: optionalString(input.status),
    label: optionalString(input.label),
    best_candidate_among_tested: input.best_candidate_among_tested === null || input.best_candidate === null
      ? null
      : optionalString(input.best_candidate_among_tested ?? input.best_candidate),
    selection_note: optionalString(input.selection_note ?? input.criterion),
    minimum_sample: input.minimum_sample === undefined
      ? undefined
      : number(input.minimum_sample, "distribution.fit.minimum_sample"),
    tested_candidates: rawCandidates.map((candidate, index) => {
      if (typeof candidate === "string") return { name: candidate };
      const detail = record(candidate, `distribution.fit.tested_candidates[${index}]`);
      return {
        name: string(detail.name, "candidate name"),
        aic: detail.aic === undefined ? undefined : nullableNumber(detail.aic, "candidate aic"),
      };
    }),
    reason: optionalString(input.reason ?? input.selection_note),
  };
}

function parseHistogram(value: unknown): HistogramBin[] {
  if (isRecord(value)) {
    const edges = Array.isArray(value.bin_edges)
      ? value.bin_edges.map((edge, index) => number(edge, `histogram.bin_edges[${index}]`))
      : [];
    const counts = Array.isArray(value.counts)
      ? value.counts.map((count, index) => number(count, `histogram.counts[${index}]`))
      : [];
    if (edges.length !== counts.length + 1) {
      throw new Error("histogram.bin_edges must contain exactly one more value than histogram.counts.");
    }
    return counts.map((count, index) => ({
      lower: edges[index] as number,
      upper: edges[index + 1] as number,
      count,
    }));
  }
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const input = record(item, `histogram[${index}]`);
    return {
      lower: number(input.lower ?? input.bin_start, `histogram[${index}].lower`),
      upper: number(input.upper ?? input.bin_end, `histogram[${index}].upper`),
      count: number(input.count, `histogram[${index}].count`),
      density: input.density === undefined ? undefined : number(input.density, "histogram.density"),
    };
  });
}

function parseDistribution(value: unknown, context: string): DistributionSample {
  const input = record(value, context);
  return {
    status: optionalString(input.status),
    period_start: optionalString(input.period_start),
    period_end: optionalString(input.period_end),
    count: number(input.count, `${context}.count`),
    mean: nullableNumber(input.mean, `${context}.mean`),
    median: nullableNumber(input.median, `${context}.median`),
    stddev: nullableNumber(input.stddev, `${context}.stddev`),
    min: nullableNumber(input.min, `${context}.min`),
    q1: nullableNumber(input.q1, `${context}.q1`),
    q3: nullableNumber(input.q3, `${context}.q3`),
    max: nullableNumber(input.max, `${context}.max`),
    iqr: nullableNumber(input.iqr, `${context}.iqr`),
    skewness: nullableNumber(input.skewness, `${context}.skewness`),
    excess_kurtosis: nullableNumber(input.excess_kurtosis, `${context}.excess_kurtosis`),
    histogram: parseHistogram(input.histogram),
    fit: parseFit(input.fit),
    window: optionalString(input.window),
    exclusions: Array.isArray(input.exclusions)
      ? input.exclusions.filter((item): item is string => typeof item === "string")
      : undefined,
  };
}

export function parsePublicChartAsset(
  value: unknown,
  countryLabel = "Public-data",
): UsaChartAsset {
  const input = record(value, `${countryLabel} chart asset`);
  if (input.schema_version !== SUPPORTED_ASSET_SCHEMA) {
    throw new Error(
      `Unsupported chart asset schema: ${String(input.schema_version)}. Expected ${SUPPORTED_ASSET_SCHEMA}.`,
    );
  }
  const baseline = record(input.baseline, "asset.baseline");
  const eligibleYearValues = Array.isArray(baseline.eligible_year_values)
    ? baseline.eligible_year_values
    : Array.isArray(baseline.eligible_years)
      ? baseline.eligible_years
      : [];
  const latest = record(input.latest, "asset.latest");
  const latestSource = input.latest_source === null || input.latest_source === undefined
    ? undefined
    : record(input.latest_source, "asset.latest_source");
  const distribution = record(input.distribution, "asset.distribution");
  const dimensionsInput = isRecord(input.dimensions) ? input.dimensions : {};
  const dimensions = Object.fromEntries(
    Object.entries(dimensionsInput)
      .map(([name, value]) => [name, string(value, `asset.dimensions.${name}`)] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const history = Array.isArray(input.history)
    ? input.history.map((item, index) => {
      const point = record(item, `asset.history[${index}]`);
      return {
        period: string(point.period, `asset.history[${index}].period`),
        year: number(point.year, `asset.history[${index}].year`),
        slot: number(point.slot, `asset.history[${index}].slot`),
        value: nullableNumber(point.value, `asset.history[${index}].value`),
        status: string(point.status, `asset.history[${index}].status`),
      };
    })
    : undefined;
  if (history && new Set(history.map((point) => point.period)).size !== history.length) {
    throw new Error("asset.history periods must be unique.");
  }
  return {
    schema_version: SUPPORTED_ASSET_SCHEMA,
    series_id: string(input.series_id, "asset.series_id"),
    geography_id: string(input.geography_id, "asset.geography_id"),
    dimensions,
    frequency: string(input.frequency, "asset.frequency"),
    unit: string(input.unit, "asset.unit"),
    generated_at: string(input.generated_at, "asset.generated_at"),
    source_checksum: string(input.source_checksum, "asset.source_checksum"),
    freshness: input.freshness === null || input.freshness === undefined
      ? undefined
      : parseFreshness(input.freshness, "unknown"),
    history,
    recent_years: array(input.recent_years, "asset.recent_years").map((yearValue, yearIndex) => {
      const year = record(yearValue, `asset.recent_years[${yearIndex}]`);
      return {
        year: number(year.year, `asset.recent_years[${yearIndex}].year`),
        points: array(year.points, "recent year points").map((pointValue, pointIndex) => {
          const point = record(pointValue, `recent point[${pointIndex}]`);
          return {
            period: string(point.period, "recent point period"),
            slot: number(point.slot, "recent point slot"),
            value: nullableNumber(point.value, "recent point value"),
            status: string(point.status, "recent point status", "observed"),
          };
        }),
      };
    }),
    baseline: {
      status: string(baseline.status, "baseline.status"),
      baseline_start_year: nullableNumber(
        baseline.baseline_start_year ?? baseline.start_year,
        "baseline.baseline_start_year",
      ),
      baseline_end_year: nullableNumber(
        baseline.baseline_end_year ?? baseline.end_year,
        "baseline.baseline_end_year",
      ),
      eligible_years: eligibleYearValues.map((item) =>
        number(item, "baseline.eligible_year"),
      ),
      eligible_year_count: Array.isArray(baseline.eligible_years)
        ? baseline.eligible_years.length
        : typeof baseline.eligible_years === "number"
          ? number(baseline.eligible_years, "baseline.eligible_years")
          : eligibleYearValues.length,
      excluded_years: Array.isArray(baseline.excluded_years)
        ? baseline.excluded_years.map((item) => number(item, "baseline.excluded_year"))
        : [],
      slots: array(baseline.slots, "baseline.slots").map((slotValue, index) => {
        const slot = record(slotValue, `baseline.slots[${index}]`);
        return {
          slot: number(slot.slot, "baseline slot"),
          min: number(slot.min, "baseline min"),
          q1: number(slot.q1, "baseline q1"),
          median: number(slot.median, "baseline median"),
          mean: number(slot.mean, "baseline mean"),
          q3: number(slot.q3, "baseline q3"),
          max: number(slot.max, "baseline max"),
          count: number(slot.count, "baseline count"),
        };
      }),
    },
    latest: {
      period: string(latest.period, "latest.period"),
      value: nullableNumber(latest.value, "latest.value"),
      previous_period: nullableString(latest.previous_period),
      absolute_change: nullableNumber(latest.absolute_change, "latest.absolute_change"),
      percent_change: nullableNumber(latest.percent_change, "latest.percent_change"),
      year_ago_period: nullableString(latest.year_ago_period),
      yoy_absolute_change: nullableNumber(latest.yoy_absolute_change, "latest.yoy_absolute_change"),
      yoy_percent_change: nullableNumber(latest.yoy_percent_change, "latest.yoy_percent_change"),
      seasonal_median: nullableNumber(latest.seasonal_median, "latest.seasonal_median"),
      distance_from_seasonal_median: nullableNumber(
        latest.distance_from_seasonal_median,
        "latest.distance_from_seasonal_median",
      ),
      seasonal_percentile: nullableNumber(latest.seasonal_percentile, "latest.seasonal_percentile"),
    },
    latest_source: latestSource ? {
      period: string(latestSource.period, "latest_source.period"),
      value: nullableNumber(latestSource.value, "latest_source.value"),
      status: string(latestSource.status, "latest_source.status"),
    } : undefined,
    distribution: {
      levels: parseDistribution(distribution.levels, "distribution.levels"),
      changes: parseDistribution(distribution.changes, "distribution.changes"),
    },
    methodology_version: string(input.methodology_version, "asset.methodology_version"),
    aggregation_lineage: input.aggregation_lineage === null || input.aggregation_lineage === undefined
      ? null
      : record(input.aggregation_lineage, "asset.aggregation_lineage"),
  };
}

export function parseUsaChartAsset(value: unknown): UsaChartAsset {
  return parsePublicChartAsset(value, "USA");
}

export function publicDataUrl(path: string, base = import.meta.env.BASE_URL): string {
  const normalizedBase = `/${base.replace(/^\/+|\/+$/g, "")}/`.replace(/\/{2,}/g, "/");
  const normalizedPath = path.replace(/^\/+/, "");
  return `${normalizedBase}${normalizedPath}`.replace(/\/{2,}/g, "/");
}

export function resolveManifestAssetUrl(
  assetPath: string,
  manifestUrl = publicDataUrl("data/usa/manifest.json"),
): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(assetPath) || assetPath.startsWith("//")) {
    throw new Error("Manifest asset paths must reference local public files.");
  }
  if (assetPath.replace(/^\/+/, "").startsWith("data/")) {
    return publicDataUrl(assetPath);
  }
  const origin = typeof window === "undefined" ? "https://local.invalid" : window.location.origin;
  return new URL(assetPath, new URL(manifestUrl, origin)).pathname;
}

async function fetchParsed<T>(
  url: string,
  parser: (value: unknown) => T,
  signal?: AbortSignal,
): Promise<RemoteState<T>> {
  try {
    const response = await fetch(url, { signal, cache: "no-cache", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}.`);
    const parsed = parser(await response.json());
    lastKnownGood.set(url, parsed);
    return { status: "ready", data: parsed, usingLastKnownGood: false };
  } catch (error) {
    if (signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : "The data asset could not be loaded.";
    const cached = lastKnownGood.get(url) as T | undefined;
    return cached
      ? { status: "stale", data: cached, usingLastKnownGood: true, error: message }
      : { status: "error", error: message };
  }
}

export function fetchPublicManifest(
  country: CountryCode,
  signal?: AbortSignal,
): Promise<RemoteState<UsaAssetManifest>> {
  return fetchParsed(
    publicDataUrl(`data/${country}/manifest.json`),
    (value) => parsePublicManifest(value, country),
    signal,
  );
}

export function fetchPublicChartAsset(
  country: CountryCode,
  assetPath: string,
  signal?: AbortSignal,
): Promise<RemoteState<UsaChartAsset>> {
  const manifestUrl = publicDataUrl(`data/${country}/manifest.json`);
  return fetchParsed(
    resolveManifestAssetUrl(assetPath, manifestUrl),
    (value) => parsePublicChartAsset(value, country === "usa" ? "USA" : "Canada"),
    signal,
  );
}

export function fetchUsaManifest(signal?: AbortSignal): Promise<RemoteState<UsaAssetManifest>> {
  return fetchPublicManifest("usa", signal);
}

export function fetchUsaChartAsset(
  assetPath: string,
  signal?: AbortSignal,
): Promise<RemoteState<UsaChartAsset>> {
  return fetchPublicChartAsset("usa", assetPath, signal);
}

export function clearAssetMemoryCache(): void {
  lastKnownGood.clear();
}
