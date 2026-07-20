import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ChartGeographyControl,
  firstAvailableGeography,
  geographyLevels,
} from "./ChartGeographyControl";
import type { UsaManifestSeries } from "../../types/energyAssets";

const series = {
  view_id: "test",
  series_id: "test",
  title: "Test series",
  category: "Test",
  unit: "percent",
  frequency: "weekly",
  source: { name: "Official source" },
  freshness: { status: "fresh" },
  geographies: [
    {
      geography_id: "usa",
      label: "United States",
      level_id: "national",
      level_label: "National",
      granularity_rank: 100,
      origin: "source-published",
      status: "available",
      asset_path: "usa.json",
    },
    {
      geography_id: "subdistrict-a",
      label: "Subdistrict A",
      level_id: "padd_subdistrict",
      level_label: "PADD subdistrict",
      granularity_rank: 30,
      origin: "source-published",
      status: "available",
      asset_path: "a.json",
    },
  ],
  unsupported_levels: [
    { level_id: "city", label: "City", reason: "No official city observations." },
  ],
} satisfies UsaManifestSeries;

describe("manifest-driven chart geography", () => {
  it("defaults to the finest ranked official geography regardless of manifest order", () => {
    expect(firstAvailableGeography(series)?.geography_id).toBe("subdistrict-a");
  });

  it("keeps unsupported levels visible but disabled with a reason", () => {
    const levels = geographyLevels(series);
    expect(levels.map((level) => level.id)).toEqual(["padd_subdistrict", "national", "city"]);
    expect(levels.at(-1)?.geographies).toHaveLength(0);
    expect(levels.at(-1)?.reason).toContain("No official city");
  });

  it("renders a same-level combined-region picker when multi-region props are supplied", () => {
    const combinedSeries = {
      ...series,
      geographies: [
        ...series.geographies,
        {
          ...series.geographies[1]!,
          geography_id: "subdistrict-b",
          label: "Subdistrict B",
          asset_path: "b.json",
        },
      ],
    } satisfies UsaManifestSeries;
    const html = renderToStaticMarkup(createElement(ChartGeographyControl, {
      series: combinedSeries,
      geographyId: "subdistrict-a",
      onGeographyChange: () => undefined,
      geographyIds: ["subdistrict-a", "subdistrict-b"],
      regionMode: "combined",
      onGeographiesChange: () => undefined,
      onRegionModeChange: () => undefined,
      chartLabel: "Test chart",
    }));

    expect(html).toContain("Combined");
    expect(html).toContain("2 regions");
    expect(html).toContain("Subdistrict A + Subdistrict B");
    expect((html.match(/checked=""/g) ?? [])).toHaveLength(2);
  });
});
