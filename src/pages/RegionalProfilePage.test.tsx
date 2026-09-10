import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UsaAssetManifest, UsaManifestSeries } from "../types/energyAssets";

const state = vi.hoisted(() => ({ manifest: undefined as UsaAssetManifest | undefined }));

// Server rendering cannot click the segment button. Seed only its literal
// initial state to exercise the Refined page; all other React state is genuine.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => actual.useState(initial === "crude" ? "refined" : initial),
  };
});
vi.mock("../hooks/useCanadaAssets", () => ({
  useCanadaManifest: () => ({ state: { status: "ready", data: state.manifest }, retry: vi.fn() }),
}));
vi.mock("../hooks/useUsaAssets", () => ({
  useUsaManifest: () => ({ state: { status: "loading" }, retry: vi.fn() }),
}));
vi.mock("../components/dashboard/CountrySectionNav", () => ({
  CountrySectionNav: () => <nav aria-label="Country views" />,
}));
vi.mock("../components/dashboard/ProfileMetricCard", () => ({
  ProfileMetricCard: ({ series }: { series: UsaManifestSeries }) => <div>{series.title}</div>,
}));
vi.mock("../components/dashboard/ProfileMovementCard", () => ({
  ProfileMovementCard: () => <div data-testid="broad-pipeline-movements" />,
}));
vi.mock("../components/dashboard/RegionalSupplyDemandPanel", () => ({
  RegionalSupplyDemandPanel: () => <div data-testid="supply-demand-components" />,
}));

import { RegionalProfilePage } from "./RegionalProfilePage";

function manifestFor(familyId: string): UsaAssetManifest {
  const pipeline = familyId === "cer-pipeline-logistics";
  const cer = familyId.startsWith("cer-");
  const productId = pipeline ? "trans-northern-refined-products"
    : cer ? "cer-propane-exports" : "finished-motor-gasoline";
  return {
    schema_version: "1.0.0",
    generated_at: "2026-09-10T12:00:00Z",
    status: "unknown",
    series: [{
      view_id: "test.profile.series", series_id: "test.profile.series",
      title: pipeline ? "Throughput" : "Exports", category: "Refined",
      unit: pipeline ? "thousand_cubic_metres_per_day" : "cubic_metres",
      frequency: "monthly",
      source: { name: cer ? "Canada Energy Regulator" : "Statistics Canada" },
      freshness: { status: "unknown" },
      classification: {
        dashboard_group: "canada_refined_products", product_family_id: familyId,
        product_family_label: familyId, product_id: productId,
        product_label: productId, measure_id: pipeline ? "pipeline-throughput" : "exports-to-padd2",
        measure_label: pipeline ? "Pipeline throughput" : "Exports to PADD 2",
        component_role: "source-defined", parent_product_id: null,
        reference_term_ids: [], display_order: 1,
      },
      geographies: [{
        geography_id: pipeline ? "ca.cer.test-point" : "ca.ab",
        label: pipeline ? "Trans-Northern reporting point" : "Alberta",
        level_id: pipeline ? "pipeline_key_point" : "province_territory",
        level_label: pipeline ? "Pipeline reporting point" : "Province / territory",
        granularity_rank: pipeline ? 15 : 30,
        origin: "source-published", status: "available", asset_path: "test.json",
      }],
      unsupported_levels: [],
    }],
  };
}

describe("regional profile CER source boundaries", () => {
  it("shows CER export routes without an invented provincial supply-demand or broad pipeline balance", () => {
    state.manifest = manifestFor("cer-ngl-trade");
    const html = renderToStaticMarkup(<RegionalProfilePage country="canada" />);
    expect(html).toContain("CER export routes");
    expect(html).toContain("Export province (CER)");
    expect(html).toContain("not the province of production");
    expect(html).toContain("first reported destination");
    expect(html).not.toContain('data-testid="supply-demand-components"');
    expect(html).not.toContain('data-testid="broad-pipeline-movements"');
    expect(html).not.toContain('class="section-kicker">Product balance');
  });

  it("labels point throughput as pipeline context and preserves the broad-product and capacity caveats", () => {
    state.manifest = manifestFor("cer-pipeline-logistics");
    const html = renderToStaticMarkup(<RegionalProfilePage country="canada" />);
    expect(html).toContain("Pipeline throughput");
    expect(html).toContain("Pipeline reporting point");
    expect(html).toContain("not province totals or gasoline-specific flows");
    expect(html).toContain("capacity and utilization are not reported or derived");
    expect(html).not.toContain('data-testid="supply-demand-components"');
    expect(html).not.toContain('data-testid="broad-pipeline-movements"');
  });

  it("retains the component comparison and separate logistics context for Statistics Canada balances", () => {
    state.manifest = manifestFor("gasoline");
    const html = renderToStaticMarkup(<RegionalProfilePage country="canada" />);
    expect(html).toContain('class="section-kicker">Product balance');
    expect(html).toContain('data-testid="supply-demand-components"');
    expect(html).toContain('data-testid="broad-pipeline-movements"');
  });
});
