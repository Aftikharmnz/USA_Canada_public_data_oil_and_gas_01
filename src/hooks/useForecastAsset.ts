import { useEffect, useState } from "react";
import { fetchForecastAsset } from "../data/forecastAssets";
import type { CountryCode } from "../types/catalog";
import type { ForecastAsset, RemoteState } from "../types/energyAssets";

export type ForecastLoadState = RemoteState<ForecastAsset> | { status: "not-configured" };

export function useForecastAsset(
  country: CountryCode,
  forecastPath: string | undefined,
) {
  const [requestVersion, setRequestVersion] = useState(0);
  const [state, setState] = useState<ForecastLoadState>({ status: "not-configured" });

  useEffect(() => {
    if (!forecastPath) {
      setState({ status: "not-configured" });
      return;
    }

    const controller = new AbortController();
    setState((current) => ({
      status: "loading",
      data: "data" in current ? current.data : undefined,
    }));
    void fetchForecastAsset(country, forecastPath, controller.signal)
      .then(setState)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          error: error instanceof Error ? error.message : "Forecast load failed.",
        });
      });
    return () => controller.abort();
  }, [country, forecastPath, requestVersion]);

  return { state, retry: () => setRequestVersion((version) => version + 1) };
}
