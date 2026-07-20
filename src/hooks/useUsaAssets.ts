import { useEffect, useState } from "react";
import { fetchUsaChartAsset, fetchUsaManifest } from "../data/usaAssets";
import type { RemoteState, UsaAssetManifest, UsaChartAsset } from "../types/energyAssets";

export function useUsaManifest() {
  const [requestVersion, setRequestVersion] = useState(0);
  const [state, setState] = useState<RemoteState<UsaAssetManifest>>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ status: "loading", data: current.status === "error" ? undefined : current.data }));
    void fetchUsaManifest(controller.signal).then(setState).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setState({ status: "error", error: error instanceof Error ? error.message : "Manifest load failed." });
    });
    return () => controller.abort();
  }, [requestVersion]);

  return { state, retry: () => setRequestVersion((version) => version + 1) };
}

export function useUsaChartAsset(assetPath: string | undefined) {
  const [requestVersion, setRequestVersion] = useState(0);
  const [state, setState] = useState<RemoteState<UsaChartAsset>>({ status: "loading" });

  useEffect(() => {
    if (!assetPath) {
      setState({ status: "error", error: "No validated chart asset is available for this geography." });
      return;
    }

    const controller = new AbortController();
    setState((current) => ({ status: "loading", data: current.status === "error" ? undefined : current.data }));
    void fetchUsaChartAsset(assetPath, controller.signal).then(setState).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setState({ status: "error", error: error instanceof Error ? error.message : "Chart load failed." });
    });
    return () => controller.abort();
  }, [assetPath, requestVersion]);

  return { state, retry: () => setRequestVersion((version) => version + 1) };
}
