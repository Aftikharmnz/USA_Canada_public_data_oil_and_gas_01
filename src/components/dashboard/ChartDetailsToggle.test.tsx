import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChartDetailsToggle } from "./ChartDetailsToggle";

function disclosureIds(html: string): { contentId: string; triggerId: string } {
  const contentId = html.match(/aria-controls="([^"]+)"/)?.[1];
  const triggerId = html.match(/<button id="([^"]+)"/)?.[1];
  if (!contentId || !triggerId) throw new Error("Disclosure ids were not rendered.");
  return { contentId, triggerId };
}

describe("ChartDetailsToggle", () => {
  it("is collapsed by default and exposes a labelled relationship to its hidden region", () => {
    const html = renderToStaticMarkup(
      <ChartDetailsToggle>
        <p>Distribution diagnostics</p>
      </ChartDetailsToggle>,
    );
    const { contentId, triggerId } = disclosureIds(html);

    expect(html).toContain('data-expanded="false"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Show details");
    expect(html).toContain(`aria-controls="${contentId}"`);
    expect(html).toContain(`id="${contentId}"`);
    expect(html).toContain('role="region"');
    expect(html).toContain(`aria-labelledby="${triggerId}"`);
    expect(html).toContain('hidden=""');
    expect(html).toContain("Distribution diagnostics");
  });

  it("supports an optional summary and caller class without replacing its base class", () => {
    const html = renderToStaticMarkup(
      <ChartDetailsToggle className="market-chart-details" summary="Statistics and methodology">
        <p>Supporting content</p>
      </ChartDetailsToggle>,
    );

    expect(html).toContain('class="chart-details-toggle market-chart-details"');
    expect(html).toContain('class="chart-details-toggle-summary"');
    expect(html).toContain("Statistics and methodology");
  });

  it("renders the expanded label and visible region when explicitly initialized open", () => {
    const html = renderToStaticMarkup(
      <ChartDetailsToggle defaultExpanded>
        <p>Supporting content</p>
      </ChartDetailsToggle>,
    );

    expect(html).toContain('data-expanded="true"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Hide details");
    expect(html).not.toContain('hidden=""');
  });

  it("generates distinct control and region ids for sibling instances", () => {
    const html = renderToStaticMarkup(
      <>
        <ChartDetailsToggle><p>First</p></ChartDetailsToggle>
        <ChartDetailsToggle><p>Second</p></ChartDetailsToggle>
      </>,
    );
    const controlIds = [...html.matchAll(/aria-controls="([^"]+)"/g)].map((match) => match[1]);

    expect(controlIds).toHaveLength(2);
    expect(new Set(controlIds).size).toBe(2);
  });
});
