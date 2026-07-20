import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CollapsibleToolbar } from "./CollapsibleToolbar";

describe("CollapsibleToolbar", () => {
  it("keeps the reveal control and selection summary available while content is collapsed", () => {
    const html = renderToStaticMarkup(
      <CollapsibleToolbar
        ariaLabel="USA market filters"
        collapsed
        contentId="usa-market-filter-content"
        onCollapsedChange={vi.fn()}
        summary="USA · Crude · Alabama · Production"
      >
        <label>
          Geography
          <select aria-label="Geography" />
        </label>
      </CollapsibleToolbar>,
    );

    expect(html).toContain('aria-label="USA market filters"');
    expect(html).toContain('data-collapsed="true"');
    expect(html).toContain('aria-controls="usa-market-filter-content"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Show filters");
    expect(html).toContain("Current selection");
    expect(html).toContain("USA · Crude · Alabama · Production");
    expect(html).toContain('id="usa-market-filter-content"');
    expect(html).toContain('hidden=""');
  });

  it("exposes the full filter content and hide label while expanded", () => {
    const html = renderToStaticMarkup(
      <CollapsibleToolbar
        ariaLabel="Canada market filters"
        collapsed={false}
        contentId="canada-market-filter-content"
        onCollapsedChange={vi.fn()}
        summary="Canada · Refined · Alberta · Closing inventory"
      >
        <p>Full filter controls</p>
      </CollapsibleToolbar>,
    );

    expect(html).toContain('data-collapsed="false"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Hide filters");
    expect(html).toContain("Full filter controls");
    expect(html).not.toContain('hidden=""');
  });
});
