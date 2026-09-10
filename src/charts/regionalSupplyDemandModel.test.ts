import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { regionalProfileMeasuresForFrequency, resolveRegionalProfile } from "../data/regionalProfile";
import { parsePublicChartAsset, parsePublicManifest } from "../data/usaAssets";
import { buildChartAssetFromHistory } from "../lib/customChartAnalytics";
import type { HistoricalObservation, UsaChartAsset } from "../types/energyAssets";
import { prepareRegionalSupplyDemand, regionalSupplyDemandSnapshot } from "./regionalSupplyDemandModel";

const GENERATED_AT = "2026-04-08T12:00:00Z";

function fixture(country: "usa" | "canada" = "canada", product = "finished-motor-gasoline") {
  const manifest = parsePublicManifest(JSON.parse(readFileSync(
    resolve(`public/data/${country}/manifest.json`), "utf8",
  )), country);
  const profile = resolveRegionalProfile(country, manifest, {
    geographyId: country === "canada" ? "ca.ab" : "us.padd.2", productId: product,
  });
  const assets = profile.productMeasures.filter((measure) => measure.availability === "available")
    .map((measure) => parsePublicChartAsset(JSON.parse(readFileSync(resolve(
      `public/data/${country}/${measure.geography!.asset_path}`,
    ), "utf8"))));
  return { manifest, profile, assets };
}

function monthly(period: string, value: number | null, status = value === null ? "missing" : "observed"): HistoricalObservation {
  return { period, year: Number(period.slice(0, 4)), slot: Number(period.slice(5)), value, status };
}

function withHistory(asset: UsaChartAsset, history: HistoricalObservation[]): UsaChartAsset {
  return buildChartAssetFromHistory({ seriesId: asset.series_id, geographyId: asset.geography_id,
    dimensions: asset.dimensions, frequency: asset.frequency, unit: asset.unit,
    generatedAt: GENERATED_AT, sourceChecksum: asset.source_checksum,
    methodologyVersion: asset.methodology_version, aggregationLineage: asset.aggregation_lineage, history });
}

function monthlyFixture(product = "finished-motor-gasoline") {
  const data = fixture("canada", product);
  return { ...data, assets: data.assets.map((asset) => withHistory(asset, [
    monthly("2026-01", 90), monthly("2026-02", 100), monthly("2026-03", 110),
  ])) };
}

describe("exact regional supply/disposition component comparison", () => {
  it("preserves exact Canadian gasoline measures and exposes unavailable provincial demand/receipts", () => {
    const { profile, assets } = monthlyFixture();
    const original = JSON.stringify(assets);
    const model = prepareRegionalSupplyDemand(profile, assets, "monthly", GENERATED_AT);
    expect(model.periods).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(model.latestPeriod).toBe("2026-03");
    expect(model.measures.map((measure) => measure.measureId)).toEqual([
      "net-production", "imports", "stock-change", "exports", "ending-stocks",
    ]);
    expect(model.measures.filter((measure) => measure.isStock).map((measure) => measure.measureId))
      .toEqual(["ending-stocks"]);
    expect(model.unavailable).toEqual(expect.arrayContaining([
      expect.objectContaining({ measureId: "product-supplied", kind: "source-boundary" }),
      expect.objectContaining({ measureId: "net-receipts", kind: "source-boundary" }),
    ]));
    expect(model).not.toHaveProperty("demand");
    expect(model).not.toHaveProperty("balance");
    expect(model).not.toHaveProperty("total");
    expect(JSON.stringify(assets)).toBe(original);
  });

  it("never stale-fills a missing measure, suppressed latest point, or prior-period gap", () => {
    const { profile, assets } = monthlyFixture();
    assets[0] = withHistory(assets[0]!, [monthly("2026-01", 1), monthly("2026-03", 4)]);
    assets[1] = withHistory(assets[1]!, [monthly("2026-01", 1), monthly("2026-02", 2)]);
    assets[2] = withHistory(assets[2]!, [monthly("2026-02", 2), monthly("2026-03", null, "suppressed_or_withheld")]);
    const model = prepareRegionalSupplyDemand(profile, assets, "monthly", GENERATED_AT);
    const snapshot = regionalSupplyDemandSnapshot(model, "2026-03");
    expect(snapshot.previousPeriod).toBe("2026-02");
    expect(snapshot.rows[0]).toMatchObject({ value: 4, previousValue: null, delta: null });
    expect(snapshot.rows[1]).toMatchObject({ value: null, status: "missing", previousValue: 2, delta: null, latestPeriod: "2026-02" });
    expect(snapshot.rows[2]).toMatchObject({ value: null, status: "suppressed_or_withheld", delta: null, latestPeriod: "2026-03" });
    expect(() => regionalSupplyDemandSnapshot(model, "2025-01")).toThrow(/not available/);
  });

  it("keeps zeros and signed net inputs intact rather than calling them demand or production", () => {
    const { profile, assets } = monthlyFixture("motor-gasoline-blending-components");
    const index = profile.productMeasures.filter((measure) => measure.availability === "available")
      .findIndex((measure) => measure.measureId === "net-inputs");
    assets[index] = withHistory(assets[index]!, [monthly("2026-02", 0), monthly("2026-03", -50)]);
    const snapshot = regionalSupplyDemandSnapshot(prepareRegionalSupplyDemand(profile, assets, "monthly", GENERATED_AT), "2026-03");
    expect(snapshot.rows[index]).toMatchObject({ measureId: "net-inputs", value: -50, previousValue: 0, delta: -50 });
  });

  it.each([
    ["geography", (asset: UsaChartAsset) => { asset.geography_id = "ca"; }],
    ["series", (asset: UsaChartAsset) => { asset.series_id = "can.statcan.refined.gasoline.mgbc.imports.monthly"; }],
    ["unit", (asset: UsaChartAsset) => { asset.unit = "thousand_barrels"; }],
    ["frequency", (asset: UsaChartAsset) => { asset.frequency = "weekly"; }],
    ["vintage", (asset: UsaChartAsset) => { asset.generated_at = "2026-04-07T12:00:00Z"; }],
    ["checksum", (asset: UsaChartAsset) => { asset.source_checksum = ""; }],
  ])("rejects %s identity drift", (_name, mutate) => {
    const { profile, assets } = monthlyFixture();
    (mutate as (asset: UsaChartAsset) => void)(assets[0]!);
    expect(() => prepareRegionalSupplyDemand(profile, assets, "monthly", GENERATED_AT)).toThrow(/identity\/vintage/);
  });

  it("rejects wrong product/family metadata, unmatched count, and duplicate assets", () => {
    const { profile, assets } = monthlyFixture();
    expect(() => prepareRegionalSupplyDemand(profile, assets.slice(1), "monthly", GENERATED_AT)).toThrow(/coverage/);
    profile.product!.familyId = "crude-oil";
    expect(() => prepareRegionalSupplyDemand(profile, assets, "monthly", GENERATED_AT)).toThrow(/identity/);
    profile.product!.familyId = "gasoline";
    profile.productMeasures.push(profile.productMeasures[0]!);
    assets.push(assets[0]!);
    expect(() => prepareRegionalSupplyDemand(profile, assets, "monthly", GENERATED_AT)).toThrow(/duplicate asset/);
  });

  it.each([
    ["duplicate", (asset: UsaChartAsset) => { asset.history!.push(asset.history![0]!); }],
    ["numeric suppression", (asset: UsaChartAsset) => { asset.history![0]!.status = "suppressed_or_withheld"; }],
    ["nonnumeric observed", (asset: UsaChartAsset) => { asset.history![0]!.value = null; }],
    ["unknown status", (asset: UsaChartAsset) => { asset.history![0]!.status = "invented"; }],
    ["invalid period", (asset: UsaChartAsset) => { asset.history![0]!.period = "2026-13"; }],
    ["invalid slot", (asset: UsaChartAsset) => { asset.history![0]!.slot = 12; }],
    ["nonfinite", (asset: UsaChartAsset) => { asset.history![0]!.value = Number.NaN; }],
    ["lost latest source", (asset: UsaChartAsset) => { asset.latest_source = { period: "2026-04", value: null, status: "suppressed_or_withheld" }; }],
  ])("rejects %s history errors", (_name, mutate) => {
    const { profile, assets } = monthlyFixture();
    (mutate as (asset: UsaChartAsset) => void)(assets[0]!);
    expect(() => prepareRegionalSupplyDemand(profile, assets, "monthly", GENERATED_AT)).toThrow();
  });

  it("retains exact seven-day comparisons and uses registered monthly display without interpolating", () => {
    const { profile, assets } = fixture("usa");
    const weekly = prepareRegionalSupplyDemand(profile, assets, "weekly", assets[0]!.generated_at);
    const date = new Date(`${weekly.latestPeriod}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 7);
    expect(regionalSupplyDemandSnapshot(weekly, weekly.latestPeriod!).previousPeriod).toBe(date.toISOString().slice(0, 10));
    const monthlyModel = prepareRegionalSupplyDemand(profile, assets, "monthly", assets[0]!.generated_at);
    expect(monthlyModel.measures.length).toBe(weekly.measures.length);
    expect(monthlyModel.measures.every((measure) => measure.isDerived)).toBe(true);
    expect(monthlyModel.periods.every((period) => /^\d{4}-\d{2}$/.test(period))).toBe(true);
    expect(monthlyModel.unavailable.find((item) => item.measureId === "net-receipts")?.kind).toBe("not-registered");
    expect(monthlyModel.unavailable.find((item) => item.measureId === "product-supplied")?.kind).toBe("not-registered");
  });

  it("validates ISO week-years at January boundaries and compares the exact prior source date", () => {
    const { profile, assets } = fixture("usa", "cbob");
    const boundaryAssets = assets.map((asset) => withHistory(asset, [
      { period: "2020-12-25", year: 2020, slot: 52, value: 1, status: "observed" },
      { period: "2021-01-01", year: 2020, slot: 53, value: 2, status: "observed" },
      { period: "2021-01-08", year: 2021, slot: 1, value: 3, status: "observed" },
    ]));
    const model = prepareRegionalSupplyDemand(profile, boundaryAssets, "weekly", GENERATED_AT);
    expect(regionalSupplyDemandSnapshot(model, "2021-01-01").rows[0])
      .toMatchObject({ value: 2, previousPeriod: "2020-12-25", previousValue: 1, delta: 1 });
    boundaryAssets[0]!.history![1]!.year = 2021;
    expect(() => prepareRegionalSupplyDemand(profile, boundaryAssets, "weekly", GENERATED_AT)).toThrow(/seasonal coordinates/);
  });

  it("prefers an available source-monthly measure to its weekly-derived duplicate", () => {
    const { profile, assets } = fixture("usa", "cbob");
    const weekly = profile.productMeasures.find((measure) => measure.measureId === "stocks")!;
    const native = structuredClone(weekly);
    native.series.series_id = "usa.test.cbob.stocks.monthly";
    native.series.view_id = native.series.series_id;
    native.series.frequency = "monthly";
    native.frequency = "monthly";
    profile.productMeasures.push(native);
    const stockSource = assets.find((asset) => asset.series_id === weekly.series.series_id)!;
    const nativeAsset = withHistory({ ...stockSource, series_id: native.series.series_id, frequency: "monthly" }, [
      monthly("2026-01", 20), monthly("2026-02", 30),
    ]);
    const available = regionalProfileMeasuresForFrequency(profile.productMeasures, "monthly")
      .filter((measure) => measure.availability === "available");
    const expected = available.map((measure) => measure.series.series_id === native.series.series_id
      ? nativeAsset
      : { ...assets.find((asset) => asset.series_id === measure.series.series_id)!, generated_at: GENERATED_AT });
    // Use bounded source weekly history within this test generation.
    const prepared = expected.map((asset) => asset.frequency === "weekly"
      ? withHistory(asset, [
        { period: "2021-01-01", year: 2020, slot: 53, value: 1, status: "observed" },
        { period: "2021-01-08", year: 2021, slot: 1, value: 2, status: "observed" },
      ]) : asset);
    const model = prepareRegionalSupplyDemand(profile, prepared, "monthly", GENERATED_AT);
    expect(model.measures.filter((measure) => measure.measureId === "stocks"))
      .toEqual([expect.objectContaining({ seriesId: native.series.series_id, isDerived: false })]);
  });

  it("fails closed for an unregistered weekly-to-monthly view", () => {
    const { profile, assets } = fixture("usa");
    const measure = profile.productMeasures.find((item) => item.availability === "available")!;
    measure.series.series_id = "usa.test.unregistered.weekly";
    assets[0]!.series_id = measure.series.series_id;
    const model = prepareRegionalSupplyDemand(profile, assets, "monthly", assets[0]!.generated_at);
    expect(model.unavailable).toContainEqual(expect.objectContaining({
      measureId: measure.measureId, kind: "display-unavailable", reason: expect.stringContaining("not registered"),
    }));
    expect(model.measures.some((item) => item.seriesId === "usa.test.unregistered.weekly")).toBe(false);
  });

  it("accepts current promoted refined profiles, not just one retained fixture date", () => {
    for (const country of ["canada", "usa"] as const) {
      const { manifest } = fixture(country);
      const geographyId = country === "canada" ? "ca.ab" : "us.padd.2";
      const initial = resolveRegionalProfile(country, manifest, { geographyId });
      for (const product of initial.products.filter((item) => ["gasoline", "distillate", "jet-fuel"].includes(item.familyId))) {
        const profile = resolveRegionalProfile(country, manifest, { geographyId, productId: product.selectionId });
        for (const frequency of ["weekly", "monthly"] as const) {
          const available = regionalProfileMeasuresForFrequency(profile.productMeasures, frequency)
            .filter((measure) => measure.availability === "available");
          if (!available.length) continue;
          const assets = available.map((measure) => parsePublicChartAsset(JSON.parse(readFileSync(resolve(
            `public/data/${country}/${measure.geography!.asset_path}`,
          ), "utf8"))));
          const model = prepareRegionalSupplyDemand(profile, assets, frequency, manifest.generated_at);
          expect(model.measures.length).toBe(available.length);
          expect(regionalSupplyDemandSnapshot(model, model.latestPeriod!).rows).toHaveLength(available.length);
        }
      }
    }
  });
});
