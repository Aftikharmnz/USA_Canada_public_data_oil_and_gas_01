import type { CountryCode } from "../types/catalog";

export const ROUTE_STORAGE_KEY = "energy-market-monitor:route";

const COUNTRY_ROUTES = new Set<CountryCode>(["usa", "canada"]);
export type AppRoute = CountryCode | "products" | "reference";

const APP_ROUTES = new Set<AppRoute>(["usa", "products", "canada", "reference"]);

export function appRouteFromPath(pathname = window.location.pathname): AppRoute | null {
  const normalizedPath = pathname.replace(/\/index\.html$/i, "/");
  const segments = normalizedPath.split("/").filter(Boolean);
  const candidate = segments.at(-1)?.toLowerCase();
  return candidate && APP_ROUTES.has(candidate as AppRoute)
    ? (candidate as AppRoute)
    : null;
}

export function countryFromPath(pathname = window.location.pathname): CountryCode | null {
  const route = appRouteFromPath(pathname);
  return route && COUNTRY_ROUTES.has(route as CountryCode)
    ? (route as CountryCode)
    : null;
}

function routeBase(pathname = window.location.pathname): string {
  let cleanPath = pathname.replace(/\/index\.html$/i, "/");
  const activeRoute = appRouteFromPath(cleanPath);

  if (activeRoute) {
    cleanPath = cleanPath.replace(new RegExp(`/${activeRoute}/?$`, "i"), "/");
  }

  return cleanPath.endsWith("/") ? cleanPath : `${cleanPath}/`;
}

export function appPath(route: AppRoute): string {
  return `${routeBase()}${route}/`.replace(/\/{2,}/g, "/");
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
