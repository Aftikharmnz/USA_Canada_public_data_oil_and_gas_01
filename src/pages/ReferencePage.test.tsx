import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReferencePage } from "./ReferencePage";

describe("ReferencePage", () => {
  it("renders compact searchable filters and source-rich definition cards", () => {
    const html = renderToStaticMarkup(<ReferencePage />);

    expect(html).not.toContain("Know what the number actually means.");
    expect(html).not.toContain("Educational reference—not trading advice.");
    expect(html).toContain("Petroleum market terminology reference");
    expect(html).toContain('type="search"');
    expect(html).toContain("All product families");
    expect(html).toContain("All concepts");
    expect(html).toContain("Product supplied (implied demand)");
    expect(html).toContain("Prediction interval");
    expect(html).toContain("Rolling-origin backtest");
    expect(html).toContain("Aggregation and double-counting caution");
    expect(html).toContain("Official definition, in plain language");
    expect(html).toContain("https://www.eia.gov/");
  });
});
