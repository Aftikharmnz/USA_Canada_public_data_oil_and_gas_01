import type { CountryCode } from "../types/catalog";

export const ROUTE_STORAGE_KEY = "energy-market-monitor:route";

export type AppRoute = CountryCode
  | "usa-profile"
  | "canada-profile"
  | "usa-weekly"
  | "products"
  | "reference";

const ROUTE_SEGMENTS: Record<AppRoute, readonly string[]> = {
  usa: ["usa"],
  "usa-profile": ["usa", "profile"],
  "usa-weekly": ["usa-weekly"],
  products: ["products"],
  canada: ["canada"],
  "canada-profile": ["canada", "profile"],
  reference: ["reference"],
};

const ROUTE_ENTRIES = (Object.entries(ROUTE_SEGMENTS) as Array<[
  AppRoute,
  readonly string[],
]>).sort((left, right) => right[1].length - left[1].length);
const APP_ROUTES = new Set<AppRoute>(ROUTE_ENTRIES.map(([route]) => route));

function pathnameSegments(pathname: string): string[] {
  return pathname
    .replace(/[?#].*$/, "")
    .replace(/\/index\.html\/?$/i, "/")
    .split("/")
    .filter(Boolean);
}

function routeEntryFromPath(pathname: string): [AppRoute, readonly string[]] | undefined {
  const segments = pathnameSegments(pathname);
  return ROUTE_ENTRIES.find(([, routeSegments]) => (
    routeSegments.length <= segments.length
    && routeSegments.every((routeSegment, index) => (
      segments[segments.length - routeSegments.length + index]?.toLowerCase() === routeSegment
    ))
  ));
}

export function appRouteFromPath(pathname = window.location.pathname): AppRoute | null {
  return routeEntryFromPath(pathname)?.[0] ?? null;
}

export function countryFromPath(pathname = window.location.pathname): CountryCode | null {
  const route = appRouteFromPath(pathname);
  if (route === "usa" || route === "usa-profile") return "usa";
  if (route === "canada" || route === "canada-profile") return "canada";
  return null;
}

function routeBase(pathname = window.location.pathname): string {
  const segments = pathnameSegments(pathname);
  const routeEntry = routeEntryFromPath(pathname);
  const baseSegments = routeEntry
    ? segments.slice(0, -routeEntry[1].length)
    : segments;
  return baseSegments.length ? `/${baseSegments.join("/")}/` : "/";
}

export function appPath(route: AppRoute, pathname = window.location.pathname): string {
  return `${routeBase(pathname)}${ROUTE_SEGMENTS[route].join("/")}/`.replace(/\/{2,}/g, "/");
}

export function countryPath(country: CountryCode): string {
  return appPath(country);
}

export function restoreGitHubPagesRoute(): void {
  try {
    const storedRoute = window.sessionStorage.getItem(ROUTE_STORAGE_KEY);
    if (storedRoute && APP_ROUTES.has(storedRoute as AppRoute)) {
      window.sessionStorage.removeItem(ROUTE_STORAGE_KEY);
      window.history.replaceState({}, "", appPath(storedRoute as AppRoute));
    }
  } catch {
    // Storage can be disabled; the root page remains a usable USA entry point.
  }
}
