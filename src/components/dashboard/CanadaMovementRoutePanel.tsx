import { useMemo } from "react";
import {
  buildCanadaOriginDestinationModel,
  canadaOriginDestinationAssetPlan,
  type LoadedCanadaOriginDestinationAsset,
} from "../../charts/canadaOriginDestinationModel";
import { useCountryChartAssets } from "../../hooks/useCountryAssets";
import type { DisplayUnitId } from "../../lib/units";
import type { UsaManifestSeries } from "../../types/energyAssets";
import { OriginDestinationPanel } from "./OriginDestinationPanel";

interface CanadaMovementRoutePanelProps {
  allSeries: readonly UsaManifestSeries[];
  series: UsaManifestSeries;
  displayUnit: DisplayUnitId;
  monthlyAverageRate?: boolean;
}

/**
 * Loads every available exact route for the active Statistics Canada movement
 * product. The country adapter validates the complete sibling set before the
 * generic explorer receives it, so a partial request can never look like a
 * complete origin-destination matrix.
 */
export function CanadaMovementRoutePanel({
  allSeries,
  series,
  displayUnit,
  monthlyAverageRate = false,
}: CanadaMovementRoutePanelProps) {
  const plan = useMemo(
    () => canadaOriginDestinationAssetPlan(allSeries, series),
    [allSeries, series],
  );
  const paths = useMemo(
    () => plan.map((item) => item.assetPath),
    [plan],
  );
  const { state, retry } = useCountryChartAssets("canada", paths);
  const built = useMemo(() => {
    if (!("data" in state) || !state.data || state.data.length !== plan.length) {
      return {} as {
        model?: ReturnType<typeof buildCanadaOriginDestinationModel>;
        error?: string;
      };
    }
    try {
      const loadedAssets: LoadedCanadaOriginDestinationAsset[] = plan.map(
        (item, index) => ({
          ...item,
          asset: state.data![index]!,
        }),
      );
      return {
        model: buildCanadaOriginDestinationModel(
          allSeries,
          series,
          loadedAssets,
        ),
      };
    } catch (error) {
      return {
        error: error instanceof Error
          ? error.message
          : "The complete Canada origin-destination matrix could not be validated.",
      };
    }
  }, [allSeries, plan, series, state]);

  if (state.status === "loading" && !built.model) {
    return (
      <section className="analysis-panel od-panel-state" aria-live="polite">
        <p className="section-kicker">Origin–destination flows</p>
        <h2>Loading exact province-to-province routes</h2>
        <p className="forecast-notice" role="status">
          Loading the complete set of published Statistics Canada pipeline coordinates…
        </p>
      </section>
    );
  }

  if (state.status === "error" || built.error) {
    return (
      <section className="analysis-panel od-panel-state" aria-live="polite">
        <p className="section-kicker">Origin–destination flows</p>
        <h2>The route matrix is unavailable</h2>
        <div className="contribution-error" role="status">
          <p>{state.status === "error" ? state.error : built.error}</p>
          <button type="button" className="retry-button" onClick={retry}>
            Try again
          </button>
        </div>
        <p className="chart-footnote">
          The selected observed route remains available above. A partial sibling
          load is never presented as a complete matrix.
        </p>
      </section>
    );
  }

  if (!built.model) return null;

  return (
    <>
      {state.status === "stale" ? (
        <p className="contribution-warning od-stale-warning" role="status">
          Using the last validated complete route matrix at its displayed source
          period because the newest asset request failed: {state.error}
        </p>
      ) : null}
      <OriginDestinationPanel
        model={built.model}
        displayUnit={displayUnit}
        monthlyAverageRate={monthlyAverageRate}
        title="Where Canadian pipeline movements start and end"
        description="Rows are exact shipping origins and columns are exact receiving destinations. Use the period, From, and To controls to inspect one corridor or the complete source-published matrix."
        sourceDisclosure="This view is pipeline only. Canada aggregate rows are excluded because they overlap provincial routes; unavailable route-periods are never filled from an older month or treated as zero."
        rankedRouteLimit={10}
      />
    </>
  );
}
