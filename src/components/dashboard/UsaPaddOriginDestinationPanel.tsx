import { useMemo } from "react";
import {
  buildUsaPaddOriginDestinationModel,
  isUsaPaddMovementSeries,
  usaPaddOriginDestinationAssetPlan,
} from "../../charts/usaPaddOriginDestinationModel";
import { useCountryChartAssets } from "../../hooks/useCountryAssets";
import type { DisplayUnitId } from "../../lib/units";
import type { UsaManifestSeries } from "../../types/energyAssets";
import {
  DashboardError,
  DashboardLoading,
  LastKnownGoodNotice,
} from "./DashboardStates";
import { OriginDestinationPanel } from "./OriginDestinationPanel";

interface UsaPaddOriginDestinationPanelProps {
  series: UsaManifestSeries;
  activeGeographyId: string;
  displayUnit: DisplayUnitId;
  onDisplayUnitChange?: (unit: DisplayUnitId) => void;
  onGeographyChange: (geographyId: string) => void;
}

export function UsaPaddOriginDestinationPanel({
  series,
  activeGeographyId,
  displayUnit,
  onDisplayUnitChange,
  onGeographyChange,
}: UsaPaddOriginDestinationPanelProps) {
  const plan = useMemo(
    () => usaPaddOriginDestinationAssetPlan(series),
    [series],
  );
  const paths = useMemo(
    () => plan.map((item) => item.assetPath),
    [plan],
  );
  const { state, retry } = useCountryChartAssets("usa", paths);
  const built = useMemo(() => {
    const assets = "data" in state ? state.data : undefined;
    if (!assets || assets.length !== plan.length) return {};
    try {
      return {
        model: buildUsaPaddOriginDestinationModel(
          series,
          plan.map((item, index) => ({
            ...item,
            asset: assets[index]!,
          })),
        ),
      };
    } catch (error) {
      return {
        error: error instanceof Error
          ? error.message
          : "The USA PADD movement matrix could not be validated.",
      };
    }
  }, [plan, series, state]);

  if (!isUsaPaddMovementSeries(series)) return null;
  if (!built.model && state.status === "loading") {
    return <DashboardLoading label="Loading exact PADD-to-PADD movement routes" />;
  }
  if (state.status === "error" || built.error) {
    return (
      <DashboardError
        title="The PADD movement matrix is unavailable"
        message={state.status === "error" ? state.error : built.error!}
        onRetry={retry}
      />
    );
  }

  return (
    <>
      {state.status === "stale" ? <LastKnownGoodNotice error={state.error} /> : null}
      {built.model ? (
        <OriginDestinationPanel
          model={built.model}
          displayUnit={displayUnit}
          onDisplayUnitChange={onDisplayUnitChange}
          highlightedRouteId={activeGeographyId}
          title="Where PADD movements start and end"
          description="Read across from a shipping PADD to a receiving PADD. Use the period, origin, and destination controls to isolate exact corridors."
          sourceDisclosure="Monthly domestic logistics from EIA Petroleum Supply Monthly; this is not the weekly imports-by-district-of-entry series."
          rankedRouteLimit={10}
          onRouteSelect={(cell) => {
            if (cell.routeId) onGeographyChange(cell.routeId);
          }}
        />
      ) : null}
    </>
  );
}
