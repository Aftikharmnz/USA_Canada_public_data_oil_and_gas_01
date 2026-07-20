import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  filterReferenceGlossary,
  REFERENCE_CONCEPTS,
  REFERENCE_PRODUCT_FAMILIES,
  referenceGlossary,
} from "./referenceGlossary";

describe("petroleum reference glossary", () => {
  it("contains the required Phase 3 concepts with stable unique ids", () => {
    const ids = referenceGlossary.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);

    const searchableTerms = referenceGlossary
      .flatMap((entry) => [entry.term, ...entry.aliases])
      .join(" ")
      .toLowerCase();

    for (const expected of [
      "implied demand",
      "total motor gasoline",
      "finished motor gasoline",
      "conventional gasoline",
      "reformulated gasoline",
      "cbob",
      "rbob",
      "fuel ethanol",
      "distillate fuel oil",
      "ulsd",
      "low sulfur diesel",
      "high sulfur diesel",
      "kerosene-type jet fuel",
      "stocks",
      "refinery production",
      "imports",
      "exports",
      "unfinished oils",
      "unblended gasoline",
      "padd",
      "statistics canada",
      "total crude production",
      "net field crude oil",
      "light and medium crude oil",
      "heavy crude oil",
      "non-upgraded crude bitumen",
      "in-situ crude bitumen",
      "mined crude bitumen",
      "sent for further processing",
      "synthetic crude oil",
      "equivalent products",
      "lease condensate",
      "pentanes plus",
      "input to canadian refineries",
      "crude bitumen refinery input",
      "cer refinery crude runs",
      "percent of refinery capacity",
      "prediction interval",
      "walk-forward validation",
      "seasonal statistical projection",
    ]) {
      expect(searchableTerms).toContain(expected);
    }
  });

  it("keeps every entry complete, source-linked, and explicit about aggregation", () => {
    for (const entry of referenceGlossary) {
      expect(REFERENCE_PRODUCT_FAMILIES).toContain(entry.productFamily);
      expect(REFERENCE_CONCEPTS).toContain(entry.concept);
      expect(entry.plainLanguage.length).toBeGreaterThan(30);
      expect(entry.officialDefinition.length).toBeGreaterThan(40);
      expect(entry.traderInterpretation.length).toBeGreaterThan(40);
      expect(entry.inclusions.length).toBeGreaterThan(0);
      expect(entry.exclusions.length).toBeGreaterThan(0);
      expect(entry.typicalUnit.length).toBeGreaterThan(0);
      expect(entry.typicalFrequency.length).toBeGreaterThan(0);
      expect(entry.geography.length).toBeGreaterThan(0);
      expect(entry.aggregationWarning.length).toBeGreaterThan(30);
      expect(entry.source.url).toMatch(
        /^https:\/\/(?:www\.eia\.gov|www150\.statcan\.gc\.ca|www\.cer-rec\.gc\.ca|otexts\.com)\//,
      );
    }
  });

  it("searches aliases and combines family and concept filters", () => {
    expect(filterReferenceGlossary(referenceGlossary, "RBOB", "all", "all").map((entry) => entry.id))
      .toContain("reformulated-blendstock-for-oxygenate-blending");

    const distillateProducts = filterReferenceGlossary(
      referenceGlossary,
      "",
      "Distillate & diesel",
      "Finished product",
    );
    expect(distillateProducts.length).toBeGreaterThanOrEqual(4);
    expect(distillateProducts.every((entry) => entry.productFamily === "Distillate & diesel")).toBe(true);
  });

  it("resolves every glossary link declared by active USA and Canada series", () => {
    const glossaryIds = new Set(referenceGlossary.map((entry) => entry.id));

    for (const registryName of ["usa", "canada"]) {
      const registry = JSON.parse(
        readFileSync(new URL(`../../config/series/${registryName}.json`, import.meta.url), "utf8"),
      ) as {
      series: Array<{
        activation_status?: string;
        display?: { reference_term_ids?: string[] };
      }>;
    };
      const referencedIds = registry.series
        .filter((entry) => entry.activation_status === "active" && entry.display)
        .flatMap((entry) => entry.display?.reference_term_ids ?? []);

      expect(referencedIds.length).toBeGreaterThan(0);
      expect([...new Set(referencedIds)].filter((id) => !glossaryIds.has(id))).toEqual([]);
    }
  });
});
