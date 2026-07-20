import { describe, expect, it } from "vitest";
import { appRouteFromPath, countryFromPath } from "./routes";

describe("GitHub Pages country routes", () => {
  it("recognizes project-site country paths", () => {
    expect(countryFromPath("/energy-dashboard/usa/")).toBe("usa");
    expect(countryFromPath("/energy-dashboard/canada/index.html")).toBe("canada");
  });

  it("does not treat the repository name as a country route", () => {
    expect(countryFromPath("/energy-dashboard/")).toBeNull();
  });

  it("recognizes the reference route without treating it as a country", () => {
    expect(appRouteFromPath("/energy-dashboard/reference/")).toBe("reference");
    expect(appRouteFromPath("/energy-dashboard/reference/index.html")).toBe("reference");
    expect(countryFromPath("/energy-dashboard/reference/")).toBeNull();
  });

  it("keeps the legacy products route available as a USA Refined alias", () => {
    expect(appRouteFromPath("/energy-dashboard/products/")).toBe("products");
    expect(appRouteFromPath("/energy-dashboard/products/index.html")).toBe("products");
    expect(countryFromPath("/energy-dashboard/products/")).toBeNull();
  });
});
