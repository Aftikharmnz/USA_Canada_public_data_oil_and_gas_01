import { describe, expect, it } from "vitest";

import type { OriginDestinationCell } from "../../charts/originDestinationModel";
import {
  profileMovementRouteCoverage,
  profileMovementValueForDisplay,
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
      numericInbound: 1,
      numericOutbound: 1,
    });
  });
});
