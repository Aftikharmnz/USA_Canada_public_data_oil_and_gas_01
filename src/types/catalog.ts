export type CountryCode = "usa" | "canada";

export interface GeographyRegion {
  id: string;
  label: string;
}

export interface GeographyLevel {
  id: string;
  label: string;
  regionLabel: string;
  description: string;
  regions: GeographyRegion[];
}

export interface MetricDefinition {
  id: string;
  title: string;
  category: string;
  frequency: "Weekly" | "Monthly";
  unit: string;
  sourceLabel: string;
  description: string;
  /** Ordered from the finest published geography to the broadest. */
  geographyLevelIds: string[];
  geographyLevelOrigins: Record<string, "source-published" | "computed-rollup">;
  unavailableGeographyLevels: Array<{
    id: string;
    label: string;
    reason: string;
  }>;
}

export type GeographyControlStatus = "ready" | "loading" | "stale" | "unavailable";

export interface CountryCatalog {
  code: CountryCode;
  name: string;
  shortName: string;
  eyebrow: string;
  overview: string;
  sourceSummary: string;
  geographyLevels: GeographyLevel[];
  metrics: MetricDefinition[];
}

export interface GeographySelection {
  metricId: string;
  metricTitle: string;
  levelId: string;
  levelLabel: string;
  regionId: string;
  regionLabel: string;
  origin: "source-published" | "computed-rollup";
}
