import { describe, expect, it } from "vitest";

import type { OriginDestinationCell } from "../../charts/originDestinationModel";
import {
  profileMovementRouteCoverage,
  profileMovementValueForDisplay,
  resolveProfileMovementPeriod,
} from "./ProfileMovementCard";

describe("profile movement display units", () => {
  it("normalizes a Canadian monthly route volume by the exact source-month days", () => {
    const cubicMetres = 4_928_606.142768;
    expect(profileMovementValueForDisplay(
      cubicMetres,
      "2024-02",
      "cubic_metres",
      true,
    )).toBeCloseTo(1_068.9655172414, 9);
    expect(profileMovementValueForDisplay(
      cubicMetres,
      "2024-03",
      "cubic_metres",
      true,
    )).toBeCloseTo(1_000, 9);
  });

  it("leaves canonical USA route volumes unchanged when rate display is not authorized", () => {
    expect(profileMovementValueForDisplay(
      123,
      "2024-03",
      "thousand_barrels",
      false,
    )).toBe(123);
  });

  it("reports numeric route coverage against declared inbound and outbound routes", () => {
    const node = (id: string) => ({ id, label: id.toUpperCase() });
    const cell = (
      originId: string,
      destinationId: string,
      value: number | null,
      declared = true,
    ): OriginDestinationCell => ({
      routeId: declared ? `${originId}-${destinationId}` : null,
      origin: node(originId),
      destination: node(destinationId),
      period: "2026-05",
      value,
      status: value === null ? (declared ? "missing" : "no_published_fact") : "observed",
      declared,
    });
    const cells = [
      cell("p1", "p2", 100),
      cell("p3", "p2", null),
      cell("p2", "p4", 80),
      cell("p2", "p5", null),
      cell("p6", "p2", null, false),
      cell("p7", "p8", 10),
    ];

    expect(profileMovementRouteCoverage(cells, "p2")).toEqual({
      declaredInbound: 2,
      declaredOutbound: 2,
      declaredWithin: 0,
      numericInbound: 1,
      numericOutbound: 1,
      numericWithin: 0,
    });
  });

  it("counts a same-region route once as within-region rather than as both inbound and outbound", () => {
    const node = { id: "ca.ab", label: "Alberta" };
    const diagonal: OriginDestinationCell = {
      routeId: "ca.ab-to-ca.ab",
      origin: node,
      destination: node,
      period: "2026-05",
      value: 250,
      status: "observed",
      declared: true,
    };

    expect(profileMovementRouteCoverage([diagonal], "ca.ab")).toEqual({
      declaredInbound: 0,
      declaredOutbound: 0,
      declaredWithin: 1,
      numericInbound: 0,
      numericOutbound: 0,
      numericWithin: 1,
    });
  });

  it("retains a requested historical period and falls back safely when it is unavailable", () => {
    const model = {
      periods: ["2026-03", "2026-04", "2026-05"],
      latestPeriod: "2026-05",
    };

    expect(resolveProfileMovementPeriod(model, "2026-03")).toBe("2026-03");
    expect(resolveProfileMovementPeriod(model, "2025-12")).toBe("2026-05");
    expect(resolveProfileMovementPeriod(model)).toBe("2026-05");
  });
});
