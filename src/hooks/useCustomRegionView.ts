import { useEffect, useState } from "react";
import type { CustomAggregationPolicy } from "../data/customAggregation";
import {
  buildCustomRegionView,
  type CustomRegionViewResult,
} from "../lib/customRegionView";
import type {
  ForecastAsset,
  ManifestGeography,
  UsaChartAsset,
  UsaManifestSeries,
} from "../types/energyAssets";

interface UseCustomRegionViewInput {
  country: "usa" | "canada";
  enabled: boolean;
  series?: UsaManifestSeries;
  policy?: CustomAggregationPolicy;
  geographies: ManifestGeography[];
  assets?: UsaChartAsset[];
  forecasts?: ForecastAsset[];
}

export type CustomRegionViewState =
  | { status: "inactive" }
  | { status: "loading"; requestKey?: string }
  | { status: "ready"; requestKey: string; data: CustomRegionViewResult }
  | { status: "error"; requestKey: string; error: string };

export function useCustomRegionView(input: UseCustomRegionViewInput): CustomRegionViewState {
  const [state, setState] = useState<CustomRegionViewState>({ status: "inactive" });
  const geographyKey = input.geographies.map((geography) => geography.geography_id).join("|");
  const assetKey = input.assets?.map((asset) => asset.source_checksum).join("|") ?? "";
  const forecastKey = input.forecasts?.map((forecast) => (
    `${forecast.training_source_checksum}:${forecast.methodology_version}`
  )).join("|") ?? "";
  const requestKey = JSON.stringify([
    input.country,
    input.series?.view_id ?? "",
    input.policy?.membershipVersion ?? "",
    geographyKey,
    assetKey,
    forecastKey,
  ]);

  useEffect(() => {
    if (!input.enabled) {
      setState({ status: "inactive" });
      return;
    }
    if (!input.series || !input.policy || !input.assets) {
      setState({ status: "loading", requestKey });
      return;
    }
    let cancelled = false;
    setState({ status: "loading", requestKey });
    void buildCustomRegionView({
      country: input.country,
      series: input.series,
      registryPolicy: input.policy,
      geographies: input.geographies,
      assets: input.assets,
      forecasts: input.forecasts,
    }).then((data) => {
      if (!cancelled) setState({ status: "ready", requestKey, data });
    }).catch((error: unknown) => {
      if (!cancelled) setState({
        status: "error",
        requestKey,
        error: error instanceof Error ? error.message : "The selected regions could not be combined.",
      });
    });
    return () => { cancelled = true; };
  // The keys deliberately make this effect depend on immutable public asset identities.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.enabled, requestKey]);

  if (input.enabled && state.status !== "inactive" && state.requestKey !== requestKey) {
    return { status: "loading", requestKey };
  }
  return state;
}
