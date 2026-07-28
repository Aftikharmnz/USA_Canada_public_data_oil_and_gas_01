import type { CountryCode } from "../types/catalog";
import type {
  ManifestGeography,
  UsaManifestSeries,
} from "../types/energyAssets";
import { customAggregationPolicy } from "./customAggregation";
import { overlappingSelection } from "./geographyContainment";

export interface RegionalContributionGeography {
  geographyId: string;
  label: string;
  assetPath: string;
}

export interface RegionalContributionSpec {
  country: CountryCode;
  componentLevelId: "province_territory" | "padd";
  componentLevelLabel: string;
  nationalGeographyId: "ca" | "us";
  nationalLabel: string;
  nationalAssetPath: string;
  components: RegionalContributionGeography[];
  title: string;
  description: string;
  geographyDisclosure: string;
}

function availableAsset(
  geography: ManifestGeography | undefined,
): geography is ManifestGeography & { asset_path: string } {
  return Boolean(
    geography
    && geography.status === "available"
    && geography.asset_path,
  );
}

function componentsAreMutuallyExclusive(
  country: CountryCode,
  geographies: readonly RegionalContributionGeography[],
): boolean {
  return geographies.every((geography, index) => (
    !overlappingSelection(
      country,
      geographies.slice(0, index).map((candidate) => candidate.geographyId),
      geography.geographyId,
    )
  ));
}

/**
 * Returns a contribution view only for source-published national imports whose
 * component level is positively authorized by the custom-geography registry.
 * The registry proves additivity and prevents movement matrices or overlapping
 * source regions from being treated as a national decomposition.
 */
export function regionalContributionSpec(
  country: CountryCode,
  series: UsaManifestSeries,
): RegionalContributionSpec | null {
  if (series.classification?.measure_id !== "imports") return null;

  const componentLevelId = country === "canada" ? "province_territory" : "padd";
  const nationalGeographyId = country === "canada" ? "ca" : "us";
  const policy = customAggregationPolicy(country, series.view_id, componentLevelId);
  if (!policy) return null;

  const national = series.geographies.find(
    (geography) => geography.geography_id === nationalGeographyId
      && geography.level_id === "national",
  );
  if (!availableAsset(national)) return null;

  const components = series.geographies.flatMap((geography) => (
    geography.level_id === componentLevelId
    && geography.origin === "source-published"
    && availableAsset(geography)
      ? [{
          geographyId: geography.geography_id,
          label: geography.label,
          assetPath: geography.asset_path,
        }]
      : []
  ));

  if (
    components.length < policy.minimumMembers
    || components.length > policy.maximumMembers
    || !componentsAreMutuallyExclusive(country, components)
  ) {
    return null;
  }

  if (country === "usa") {
    return {
      country,
      componentLevelId,
      componentLevelLabel: "PADD district of entry",
      nationalGeographyId,
      nationalLabel: national.label,
      nationalAssetPath: national.asset_path,
      components,
      title: "PADD contribution to official imports",
      description:
        "Colored bars are source-published PADD values; the dark line is the separately published U.S. total.",
      geographyDisclosure:
        "PADD identifies the district where imports enter the United States. It is not the cargo's foreign origin, final destination, or consumption region.",
    };
  }

  const crudeDestinationMethod = series.view_id === "can.statcan.crude.imports.monthly";
  return {
    country,
    componentLevelId,
    componentLevelLabel: "Province / territory",
    nationalGeographyId,
    nationalLabel: national.label,
    nationalAssetPath: national.asset_path,
    components,
    title: "Province contribution to official imports",
    description:
      "Colored bars are source-published provincial values; the dark line is the separately published Canada total.",
    geographyDisclosure: crudeDestinationMethod
      ? "For crude oil, January 2020 onward is allocated by province of destination under Statistics Canada's current method. Earlier observations remain historical context and are not used as a substitute for an incomplete current breakdown."
      : "For this Statistics Canada balance, the provincial breakdown reflects the reporting province or province of entry. It does not identify the foreign country of origin.",
  };
}
