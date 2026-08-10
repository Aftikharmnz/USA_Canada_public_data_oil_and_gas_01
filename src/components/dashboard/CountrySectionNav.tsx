import { appPath, type AppRoute } from "../../lib/routes";
import type { CountryCode } from "../../types/catalog";

export type CountryDashboardView = "explorer" | "profile";

interface CountrySectionNavProps {
  country: CountryCode;
  activeView: CountryDashboardView;
}

const PROFILE_ROUTES: Record<CountryCode, AppRoute> = {
  usa: "usa-profile",
  canada: "canada-profile",
};

export function CountrySectionNav({ country, activeView }: CountrySectionNavProps) {
  const countryLabel = country === "usa" ? "USA" : "Canada";
  const links: Array<{
    view: CountryDashboardView;
    label: string;
    route: AppRoute;
  }> = [
    { view: "explorer", label: "Explorer", route: country },
    { view: "profile", label: "Regional profile", route: PROFILE_ROUTES[country] },
  ];

  return (
    <nav className="country-section-nav" aria-label={`${countryLabel} dashboard views`}>
      {links.map((link) => (
        <a
          key={link.view}
          href={appPath(link.route)}
          aria-current={activeView === link.view ? "page" : undefined}
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}
