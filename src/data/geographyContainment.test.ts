import { describe, expect, it } from "vitest";
import {
  atomicMembershipIds,
  overlappingSelection,
  regionsOverlap,
} from "./geographyContainment";

describe("geographyContainment", () => {
  it("treats a same-level sub-area as contained by its parent state", () => {
    // EIA publishes Alaska South at the same state_or_area level as Alaska.
    expect(atomicMembershipIds("usa", "us.ak")).toEqual(["us.ak", "us.ak.south"]);
    expect(atomicMembershipIds("usa", "us.ak.south")).toEqual(["us.ak.south"]);
    expect(regionsOverlap("usa", "us.ak", "us.ak.south")).toBe(true);
    expect(regionsOverlap("usa", "us.ak.south", "us.ak")).toBe(true);
  });

  it("keeps genuinely disjoint regions combinable", () => {
    expect(regionsOverlap("usa", "us.tx", "us.nd")).toBe(false);
    expect(regionsOverlap("usa", "us.ak.south", "us.tx")).toBe(false);
    expect(regionsOverlap("usa", "us.area.gulf_offshore", "us.tx")).toBe(false);
    expect(regionsOverlap("usa", "us.padd.1", "us.padd.2")).toBe(false);
    expect(regionsOverlap("canada", "ca.ab", "ca.bc")).toBe(false);
    expect(regionsOverlap("canada", "ca.cer.western", "ca.cer.ontario")).toBe(false);
  });

  it("detects containment across levels so a parent can never absorb its child", () => {
    expect(regionsOverlap("usa", "us.padd.1", "us.padd.1a")).toBe(true);
    expect(regionsOverlap("usa", "us", "us.tx")).toBe(true);
    expect(regionsOverlap("usa", "us.padd.3", "us.tx")).toBe(true);
    expect(regionsOverlap("canada", "ca.cer.western", "ca.ab")).toBe(true);
  });

  it("reports which selected region blocks a candidate", () => {
    expect(overlappingSelection("usa", ["us.tx", "us.ak"], "us.ak.south")).toBe("us.ak");
    expect(overlappingSelection("usa", ["us.tx", "us.nd"], "us.ak.south")).toBeUndefined();
    // An already-selected region must not report itself as a blocker.
    expect(overlappingSelection("usa", ["us.tx"], "us.tx")).toBeUndefined();
  });

  it("falls back to a self-atom for unregistered ids instead of throwing", () => {
    expect(atomicMembershipIds("usa", "us.zz.unknown")).toEqual(["us.zz.unknown"]);
    expect(regionsOverlap("usa", "us.zz.unknown", "us.tx")).toBe(false);
  });
});
