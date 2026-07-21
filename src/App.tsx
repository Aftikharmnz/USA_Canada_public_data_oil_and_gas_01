import { useEffect, useState } from "react";
import { CanadaPage } from "./pages/CanadaPage";
import { RefinedProductsPage } from "./pages/RefinedProductsPage";
import { ReferencePage } from "./pages/ReferencePage";
import { UsaPage } from "./pages/UsaPage";
import { UsaWeeklyPage } from "./pages/UsaWeeklyPage";
import { appPath, appRouteFromPath, type AppRoute } from "./lib/routes";

const primaryRoutes: Array<{ route: AppRoute; label: string }> = [
  { route: "usa", label: "USA" },
  { route: "canada", label: "Canada" },
  { route: "reference", label: "Reference" },
];

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() => appRouteFromPath() ?? "usa");

  useEffect(() => {
    if (!appRouteFromPath()) {
      window.history.replaceState({}, "", appPath(route));
    }

    const handlePopState = () => setRoute(appRouteFromPath() ?? "usa");
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [route]);

  const navigate = (nextRoute: AppRoute) => {
    if (nextRoute === route) return;
    window.history.pushState({}, "", appPath(nextRoute));
    setRoute(nextRoute);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  };

  const footerLead = route === "reference"
    ? "Petroleum terminology reference."
    : route === "usa-weekly"
      ? "USA weekly EIA trading desk."
    : route === "products"
      ? "U.S. refined-products dashboard."
      : route === "usa"
        ? "USA market dashboard."
        : "Canada market dashboard.";

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="site-header">
        <div className="header-shell">
          <a
            className="brand"
            href={appPath("usa")}
            onClick={(event) => {
              event.preventDefault();
              navigate("usa");
            }}
          >
            <span className="brand-mark" aria-hidden="true">EM</span>
            <span>
              <strong>Energy Market Monitor</strong>
              <small>North American public data</small>
            </span>
          </a>

          <nav className="country-nav" aria-label="Primary pages">
            {primaryRoutes.map((item) => (
              <a
                key={item.route}
                href={appPath(item.route)}
                aria-current={route === item.route ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(item.route);
                }}
              >
                {item.label}
              </a>
            ))}
          </nav>

          <span className="phase-badge">
            {route === "reference"
              ? "Definitions"
              : route === "usa-weekly"
                ? "USA · Weekly"
              : route === "products"
                ? "USA · Refined"
                : route === "usa"
                  ? "USA · Crude + Refined"
                  : "Canada · Crude + Refined"}
          </span>
        </div>
      </header>

      {route === "reference"
        ? <ReferencePage />
        : route === "usa-weekly"
          ? <UsaWeeklyPage />
        : route === "products"
          ? <RefinedProductsPage />
          : route === "canada"
            ? <CanadaPage />
            : <UsaPage />}

      <footer className="site-footer">
        <div className="footer-shell">
          <p>
            <strong>{footerLead}</strong>{" "}
            {route === "reference"
              ? "Definitions are educational and link to official source material."
              : "Values are served from validated static data assets."}
          </p>
          <p>An independent analytical project; not an official government publication.</p>
        </div>
      </footer>
    </>
  );
}
