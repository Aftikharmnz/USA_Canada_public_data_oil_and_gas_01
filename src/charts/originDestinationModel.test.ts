import { describe, expect, it } from "vitest";
import {
  buildOriginDestinationModel,
  filterOriginDestinationSnapshot,
  originDestinationSnapshot,
  rankOriginDestinationRoutes,
  type OriginDestinationModelInput,
} from "./originDestinationModel";

const input: OriginDestinationModelInput = {
  id: "test.flows",
  title: "Test flows",
  sourceUnit: "cubic_metres",
  frequency: "monthly",
  productLabel: "Test product",
  modeLabel: "Pipeline",
  origins: [
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
  ],
  destinations: [
    { id: "b", label: "Beta" },
    { id: "c", label: "Charlie" },
  ],
  periods: ["2026-01", "2026-02"],
  latestPeriod: "2026-02",
  routes: [
    {
      id: "a-b",
      originId: "a",
      destinationId: "b",
      history: [
        { period: "2026-01", year: 2026, slot: 1, value: 10, status: "observed" },
        { period: "2026-02", year: 2026, slot: 2, value: 0, status: "observed" },
      ],
    },
    {
      id: "a-c",
      originId: "a",
      destinationId: "c",
      history: [
        { period: "2026-01", year: 2026, slot: 1, value: 8, status: "preliminary" },
        { period: "2026-02", year: 2026, slot: 2, value: null, status: "suppressed_or_withheld" },
      ],
    },
    {
      id: "b-c",
      originId: "b",
      destinationId: "c",
      history: [
        { period: "2026-01", year: 2026, slot: 1, value: 20, status: "observed" },
      ],
    },
  ],
};

describe("origin-destination model", () => {
  it("builds a complete matrix while preserving zero, missing, and unpublished pairs", () => {
    const model = buildOriginDestinationModel(input);
    const latest = originDestinationSnapshot(model);

    expect(latest).toMatchObject({
      period: "2026-02",
      declaredRouteCount: 3,
      numericRouteCount: 1,
      nonnumericRouteCount: 2,
      maximumAbsoluteValue: 0,
    });
    expect(latest.cells.find(
      (cell) => cell.origin.id === "a" && cell.destination.id === "b",
    )).toMatchObject({
      routeId: "a-b",
      value: 0,
      status: "observed",
      declared: true,
    });
    expect(latest.cells.find(
      (cell) => cell.origin.id === "a" && cell.destination.id === "c",
    )).toMatchObject({
      value: null,
      status: "suppressed_or_withheld",
      declared: true,
    });
    expect(latest.cells.find(
      (cell) => cell.origin.id === "b" && cell.destination.id === "c",
    )).toMatchObject({
      value: null,
      status: "missing",
      declared: true,
    });
    expect(latest.cells.find(
      (cell) => cell.origin.id === "b" && cell.destination.id === "b",
    )).toMatchObject({
      routeId: null,
      value: null,
      status: "no_published_fact",
      declared: false,
    });
  });

  it("filters exact endpoints and ranks numeric routes without treating null as zero", () => {
    const model = buildOriginDestinationModel(input);
    const january = originDestinationSnapshot(model, "2026-01");
    const filtered = filterOriginDestinationSnapshot(january, { originId: "a" });

    expect(filtered.origins.map((node) => node.id)).toEqual(["a"]);
    expect(filtered.cells).toHaveLength(2);
    expect(rankOriginDestinationRoutes(filtered, 2).map((cell) => cell.routeId))
      .toEqual(["a-b", "a-c"]);
    expect(rankOriginDestinationRoutes(january, 2).map((cell) => cell.routeId))
      .toEqual(["b-c", "a-b"]);
  });

  it("refuses duplicate pairs, unknown endpoints, and incompatible statuses", () => {
    expect(() => buildOriginDestinationModel({
      ...input,
      routes: [...input.routes, { ...input.routes[0]!, id: "duplicate" }],
    })).toThrow(/repeats route a to b/i);

    expect(() => buildOriginDestinationModel({
      ...input,
      routes: [{
        id: "unknown",
        originId: "unknown",
        destinationId: "b",
        history: [],
      }],
    })).toThrow(/unknown origin/i);

    expect(() => buildOriginDestinationModel({
      ...input,
      routes: [{
        id: "bad-status",
        originId: "a",
        destinationId: "b",
        history: [{
          period: "2026-01",
          year: 2026,
          slot: 1,
          value: null,
          status: "observed",
        }],
      }],
    })).toThrow(/incompatible value\/status pair/i);
  });

  it("refuses observations outside an authoritative period domain", () => {
    expect(() => buildOriginDestinationModel({
      ...input,
      periods: ["2026-02"],
    })).toThrow(/outside the declared period domain/i);
  });
});
