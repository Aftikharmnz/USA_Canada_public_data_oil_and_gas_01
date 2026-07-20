import { useEffect, useState } from "react";
import { fetchCanadaChartAsset, fetchCanadaManifest } from "../data/canadaAssets";
import type {
  CanadaAssetManifest,
  CanadaChartAsset,
  RemoteState,
} from "../types/energyAssets";

export function useCanadaManifest() {
  const [requestVersion, setRequestVersion] = useState(0);
  const [state, setState] = useState<RemoteState<CanadaAssetManifest>>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({
      status: "loading",
      data: current.status === "error" ? undefined : current.data,
    }));
    void fetchCanadaManifest(controller.signal).then(setState).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setState({
        status: "error",
        error: error instanceof Error ? error.message : "Canada manifest load failed.",
      });
    });
    return () => controller.abort();
  }, [requestVersion]);

  return { state, retry: () => setRequestVersion((version) => version + 1) };
}

export function useCanadaChartAsset(assetPath: string | undefined) {
  const [requestVersion, setRequestVersion] = useState(0);
  const [state, setState] = useState<RemoteState<CanadaChartAsset>>({ status: "loading" });

  useEffect(() => {
    if (!assetPath) {
      setState({
        status: "error",
        error: "No validated Canada chart asset is available for this geography.",
      });
      return;
    }

    const controller = new AbortController();
    setState((current) => ({
      status: "loading",
      data: current.status === "error" ? undefined : current.data,
    }));
    void fetchCanadaChartAsset(assetPath, controller.signal).then(setState).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setState({
        status: "error",
        error: error instanceof Error ? error.message : "Canada chart load failed.",
      });
    });
    return () => controller.abort();
  }, [assetPath, requestVersion]);

  return { state, retry: () => setRequestVersion((version) => version + 1) };
}
