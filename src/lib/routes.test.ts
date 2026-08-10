import { describe, expect, it } from "vitest";
import { appPath, appRouteFromPath, countryFromPath } from "./routes";

describe("GitHub Pages country routes", () => {
  it("recognizes project-site country paths", () => {
    expect(countryFromPath("/energy-dashboard/usa/")).toBe("usa");
    expect(countryFromPath("/energy-dashboard/canada/index.html")).toBe("canada");
  });

  it("recognizes nested regional-profile routes before their country parents", () => {
    expect(appRouteFromPath("/energy-dashboard/usa/profile/")).toBe("usa-profile");
    expect(appRouteFromPath("/energy-dashboard/usa/profile/index.html")).toBe("usa-profile");
    expect(countryFromPath("/energy-dashboard/usa/profile/")).toBe("usa");
    expect(appRouteFromPath("/energy-dashboard/canada/profile/")).toBe("canada-profile");
    expect(appRouteFromPath("/energy-dashboard/canada/profile/index.html")).toBe("canada-profile");
    expect(countryFromPath("/energy-dashboard/canada/profile/")).toBe("canada");
  });

  it("builds nested paths from the project root and every recognized route", () => {
    expect(appPath("usa-profile", "/energy-dashboard/")).toBe("/energy-dashboard/usa/profile/");
    expect(appPath("canada-profile", "/energy-dashboard/usa/")).toBe("/energy-dashboard/canada/profile/");
    expect(appPath("usa", "/energy-dashboard/canada/profile/index.html")).toBe("/energy-dashboard/usa/");
  });

  it("does not accept extra path segments after a registered nested route", () => {
    expect(appRouteFromPath("/energy-dashboard/usa/profile/extra/")).toBeNull();
  });

  it("does not treat the repository name as a country route", () => {
    expect(countryFromPath("/energy-dashboard/")).toBeNull();
  });

  it("recognizes the reference route without treating it as a country", () => {
    expect(appRouteFromPath("/energy-dashboard/reference/")).toBe("reference");
    expect(appRouteFromPath("/energy-dashboard/reference/index.html")).toBe("reference");
    expect(countryFromPath("/energy-dashboard/reference/")).toBeNull();
  });

  it("recognizes the dedicated USA weekly route", () => {
    expect(appRouteFromPath("/energy-dashboard/usa-weekly/")).toBe("usa-weekly");
    expect(appRouteFromPath("/energy-dashboard/usa-weekly/index.html")).toBe("usa-weekly");
    expect(countryFromPath("/energy-dashboard/usa-weekly/")).toBeNull();
  });

  it("keeps the legacy products route available as a USA Refined alias", () => {
    expect(appRouteFromPath("/energy-dashboard/products/")).toBe("products");
    expect(appRouteFromPath("/energy-dashboard/products/index.html")).toBe("products");
    expect(countryFromPath("/energy-dashboard/products/")).toBeNull();
  });
});
