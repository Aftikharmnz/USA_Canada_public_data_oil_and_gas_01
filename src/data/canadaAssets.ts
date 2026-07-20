import type {
  CanadaAssetManifest,
  CanadaChartAsset,
  RemoteState,
} from "../types/energyAssets";
import {
  fetchPublicChartAsset,
  fetchPublicManifest,
  parsePublicChartAsset,
  parsePublicManifest,
  publicDataUrl,
  resolveManifestAssetUrl,
} from "./usaAssets";

export function parseCanadaManifest(value: unknown): CanadaAssetManifest {
  return parsePublicManifest(value, "canada");
}

export function parseCanadaChartAsset(value: unknown): CanadaChartAsset {
  return parsePublicChartAsset(value, "Canada");
}

export function canadaManifestUrl(): string {
  return publicDataUrl("data/canada/manifest.json");
}

export function resolveCanadaAssetUrl(assetPath: string): string {
  return resolveManifestAssetUrl(assetPath, canadaManifestUrl());
}

export function fetchCanadaManifest(
  signal?: AbortSignal,
): Promise<RemoteState<CanadaAssetManifest>> {
  return fetchPublicManifest("canada", signal);
}

export function fetchCanadaChartAsset(
  assetPath: string,
  signal?: AbortSignal,
): Promise<RemoteState<CanadaChartAsset>> {
  return fetchPublicChartAsset("canada", assetPath, signal);
}
