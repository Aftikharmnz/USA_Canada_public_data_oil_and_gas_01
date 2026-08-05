import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DisplayUnitOption } from "../../lib/units";
import { DisplayUnitControl } from "./DisplayUnitControl";

const monthlyAverageOption: DisplayUnitOption = {
  id: "thousand_barrels_per_day",
  dimension: "flow_rate",
  compactLabel: "kb/d",
  longLabel: "Thousand barrels per day — monthly average",
  numberFormat: {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    useGrouping: true,
  },
  isSourceUnit: false,
};

describe("DisplayUnitControl", () => {
  it("renders a prevalidated monthly-average rate beside source-volume options", () => {
    const html = renderToStaticMarkup(
      <DisplayUnitControl
        sourceUnit="cubic_metres"
        value="cubic_metres"
        onChange={() => undefined}
        additionalOptions={[monthlyAverageOption]}
        helpText="Source monthly volumes remain unchanged."
      />,
    );

    expect(html).toContain("Cubic metres (m³, source)");
    expect(html).toContain("Thousand barrels per day — monthly average (kb/d)");
    expect(html).toContain("Source monthly volumes remain unchanged.");
  });

  it("shows trader abbreviations beside ordinary daily-rate options", () => {
    const html = renderToStaticMarkup(
      <DisplayUnitControl
        sourceUnit="thousand_barrels_per_day"
        value="thousand_barrels_per_day"
        onChange={() => undefined}
      />,
    );

    expect(html).toContain("Barrels per day (bbl/d)");
    expect(html).toContain("Thousand barrels per day (kb/d, source)");
    expect(html).toContain("Million barrels per day (MMbbl/d)");
  });
});
