import { describe, expect, it } from "vitest";

import type { UsaChartAsset, UsaManifestSeries } from "../../types/energyAssets";
import { profileLatestSourceNotice } from "./ProfileMetricCard";

describe("profile metric latest-source disclosure", () => {
  it("does not present an old Canadian numeric value as the latest source period", () => {
    const asset = {
      latest: { period: "2017-12", value: 42 },
      latest_source: {
        period: "2026-05",
        value: null,
        status: "suppressed_or_withheld",
      },
      freshness: {
        status: "fresh",
        latest_period: "2026-05",
        latest_numeric_period: "2017-12",
        latest_observation_status: "suppressed_or_withheld",
      },
    } as UsaChartAsset;
    const series = { freshness: asset.freshness } as UsaManifestSeries;

    expect(profileLatestSourceNotice(asset, series)).toEqual({
      sourcePeriod: "2026-05",
      observationStatus: "suppressed or withheld",
      numericPeriod: "2017-12",
    });
  });

  it("stays quiet when the source and latest numeric periods agree", () => {
    const asset = {
      latest: { period: "2026-05", value: 42 },
      latest_source: { period: "2026-05", value: 42, status: "observed" },
      freshness: { status: "fresh", latest_period: "2026-05" },
    } as UsaChartAsset;
    const series = { freshness: asset.freshness } as UsaManifestSeries;
    expect(profileLatestSourceNotice(asset, series)).toBeNull();
  });
});
