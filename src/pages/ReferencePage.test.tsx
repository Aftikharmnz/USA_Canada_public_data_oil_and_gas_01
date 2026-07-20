import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReferencePage } from "./ReferencePage";

describe("ReferencePage", () => {
  it("renders searchable filters, educational notice, and source-rich definition cards", () => {
    const html = renderToStaticMarkup(<ReferencePage />);

    expect(html).toContain("Know what the number actually means.");
    expect(html).toContain("Educational reference—not trading advice.");
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
