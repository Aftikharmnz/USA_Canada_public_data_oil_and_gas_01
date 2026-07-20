import { useEffect, useMemo, useState } from "react";
import { fetchForecastAsset } from "../data/forecastAssets";
import { fetchPublicChartAsset } from "../data/usaAssets";
import type { CountryCode } from "../types/catalog";
import type { ForecastAsset, RemoteState, UsaChartAsset } from "../types/energyAssets";

function combineRemoteStates<T>(states: readonly RemoteState<T>[]): RemoteState<T[]> {
  const error = states.find((state) => state.status === "error");
  if (error?.status === "error") return { status: "error", error: error.error };
  const data: T[] = [];
  for (const state of states) {
    if ("data" in state && state.data !== undefined) data.push(state.data);
  }
  if (data.length !== states.length) return { status: "loading" };
  const stale = states.filter((state) => state.status === "stale");
  return stale.length
    ? {
        status: "stale",
        data,
        usingLastKnownGood: true,
        error: stale.map((state) => state.status === "stale" ? state.error : "").filter(Boolean).join(" "),
      }
    : { status: "ready", data, usingLastKnownGood: false };
}

export function useCountryChartAssets(country: CountryCode, assetPaths: readonly string[]) {
  const [requestVersion, setRequestVersion] = useState(0);
  const [state, setState] = useState<RemoteState<UsaChartAsset[]>>({ status: "loading" });
  const requestKey = useMemo(() => JSON.stringify(assetPaths), [assetPaths]);

  useEffect(() => {
    const paths = JSON.parse(requestKey) as string[];
    if (!paths.length) {
      setState({ status: "error", error: "No validated chart assets are available for this selection." });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    void Promise.all(paths.map((path) => fetchPublicChartAsset(country, path, controller.signal)))
      .then((results) => {
        if (!controller.signal.aborted) setState(combineRemoteStates(results));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          error: error instanceof Error ? error.message : "Combined chart assets could not be loaded.",
        });
      });
    return () => controller.abort();
  }, [country, requestKey, requestVersion]);

  return { state, retry: () => setRequestVersion((version) => version + 1) };
}

export type ForecastAssetsLoadState = RemoteState<ForecastAsset[]> | { status: "not-configured" };

export function useCountryForecastAssets(country: CountryCode, forecastPaths: readonly string[]) {
  const [requestVersion, setRequestVersion] = useState(0);
  const [state, setState] = useState<ForecastAssetsLoadState>({ status: "not-configured" });
  const requestKey = useMemo(() => JSON.stringify(forecastPaths), [forecastPaths]);

  useEffect(() => {
    const paths = JSON.parse(requestKey) as string[];
    if (!paths.length) {
      setState({ status: "not-configured" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    void Promise.all(paths.map((path) => fetchForecastAsset(country, path, controller.signal)))
      .then((results) => {
        if (!controller.signal.aborted) setState(combineRemoteStates(results));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          error: error instanceof Error ? error.message : "Combined forecast assets could not be loaded.",
        });
      });
    return () => controller.abort();
  }, [country, requestKey, requestVersion]);

  return { state, retry: () => setRequestVersion((version) => version + 1) };
}
