import type { HistoricalObservation } from "../types/energyAssets";

export const ORIGIN_DESTINATION_NUMERIC_STATUSES = [
  "observed",
  "preliminary",
  "revised",
  "computed",
  "use_with_caution",
] as const;

export const ORIGIN_DESTINATION_NONNUMERIC_STATUSES = [
  "missing",
  "not_available",
  "not_applicable",
  "suppressed_or_withheld",
  "no_published_fact",
] as const;

export type OriginDestinationNumericStatus =
  (typeof ORIGIN_DESTINATION_NUMERIC_STATUSES)[number];
export type OriginDestinationNonnumericStatus =
  (typeof ORIGIN_DESTINATION_NONNUMERIC_STATUSES)[number];
export type OriginDestinationStatus =
  | OriginDestinationNumericStatus
  | OriginDestinationNonnumericStatus;

export interface OriginDestinationNode {
  id: string;
  label: string;
  shortLabel?: string;
}

export interface OriginDestinationRouteInput {
  id: string;
  originId: string;
  destinationId: string;
  history: readonly HistoricalObservation[];
}

export interface OriginDestinationRoute {
  id: string;
  originId: string;
  originLabel: string;
  destinationId: string;
  destinationLabel: string;
  history: readonly HistoricalObservation[];
}

/**
 * Country adapters are responsible for source-specific lineage validation,
 * then hand this source-neutral shape to the presentation model.
 */
export interface OriginDestinationModelInput {
  id: string;
  title: string;
  description?: string;
  sourceUnit: string;
  frequency: string;
  productLabel: string;
  modeLabel: string;
  sourceNote?: string;
  origins: readonly OriginDestinationNode[];
  destinations: readonly OriginDestinationNode[];
  routes: readonly OriginDestinationRouteInput[];
  /**
   * Optional authoritative period domain. If omitted, periods are the union of
   * route observations. A declared route without an observation in one of
   * these periods is `missing`, while an undeclared origin/destination pair is
   * `no_published_fact`.
   */
  periods?: readonly string[];
  latestPeriod?: string;
}

export interface OriginDestinationCell {
  routeId: string | null;
  origin: OriginDestinationNode;
  destination: OriginDestinationNode;
  period: string;
  value: number | null;
  status: OriginDestinationStatus;
  declared: boolean;
}

export interface OriginDestinationSnapshot {
  period: string;
  origins: readonly OriginDestinationNode[];
  destinations: readonly OriginDestinationNode[];
  cells: readonly OriginDestinationCell[];
  declaredRouteCount: number;
  numericRouteCount: number;
  nonnumericRouteCount: number;
  maximumAbsoluteValue: number;
}

export interface OriginDestinationModel {
  id: string;
  title: string;
  description?: string;
  sourceUnit: string;
  frequency: string;
  productLabel: string;
  modeLabel: string;
  sourceNote?: string;
  origins: readonly OriginDestinationNode[];
  destinations: readonly OriginDestinationNode[];
  routes: readonly OriginDestinationRoute[];
  periods: readonly string[];
  latestPeriod: string;
  snapshots: readonly OriginDestinationSnapshot[];
}

export interface OriginDestinationFilter {
  originId?: string | null;
  destinationId?: string | null;
}

const NUMERIC_STATUSES = new Set<string>(ORIGIN_DESTINATION_NUMERIC_STATUSES);
const NONNUMERIC_STATUSES = new Set<string>(ORIGIN_DESTINATION_NONNUMERIC_STATUSES);

function numeric(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function requireUniqueNodes(
  role: "origin" | "destination",
  nodes: readonly OriginDestinationNode[],
): Map<string, OriginDestinationNode> {
  if (!nodes.length) {
    throw new Error(`Origin-destination model requires at least one ${role}.`);
  }
  const result = new Map<string, OriginDestinationNode>();
  for (const node of nodes) {
    if (!node.id.trim() || !node.label.trim()) {
      throw new Error(`Every ${role} requires a non-empty id and label.`);
    }
    if (result.has(node.id)) {
      throw new Error(`Origin-destination model repeats ${role} ${node.id}.`);
    }
    result.set(node.id, { ...node });
  }
  return result;
}

function validateObservation(
  routeId: string,
  observation: HistoricalObservation,
): void {
  if (!observation.period.trim()) {
    throw new Error(`Origin-destination route ${routeId} has an empty period.`);
  }
  const hasNumericValue = numeric(observation.value);
  if (
    (!hasNumericValue && observation.value !== null)
    || (!NUMERIC_STATUSES.has(observation.status)
      && !NONNUMERIC_STATUSES.has(observation.status))
    || NUMERIC_STATUSES.has(observation.status) !== hasNumericValue
  ) {
    throw new Error(
      `Origin-destination route ${routeId} has an incompatible value/status pair at ${observation.period}.`,
    );
  }
}

function uniquePeriods(periods: readonly string[]): string[] {
  const result = [...new Set(periods)];
  if (result.some((period) => !period.trim())) {
    throw new Error("Origin-destination periods cannot be empty.");
  }
  return result.sort();
}

function pairKey(originId: string, destinationId: string): string {
  return `${originId}\u0000${destinationId}`;
}

/**
 * Builds exact-period origin/destination snapshots without summing, netting,
 * stale-filling, or converting any source observation.
 */
export function buildOriginDestinationModel(
  input: OriginDestinationModelInput,
): OriginDestinationModel {
  if (!input.id.trim() || !input.title.trim()) {
    throw new Error("Origin-destination model requires a non-empty id and title.");
  }
  if (!input.sourceUnit.trim() || !input.frequency.trim()) {
    throw new Error("Origin-destination model requires source units and frequency.");
  }
  if (!input.productLabel.trim() || !input.modeLabel.trim()) {
    throw new Error("Origin-destination model requires product and mode labels.");
  }
  const originsById = requireUniqueNodes("origin", input.origins);
  const destinationsById = requireUniqueNodes("destination", input.destinations);
  const routesByPair = new Map<string, {
    route: OriginDestinationRouteInput;
    observations: Map<string, HistoricalObservation>;
  }>();
  const routeIds = new Set<string>();
  const observedPeriods: string[] = [];

  for (const route of input.routes) {
    if (!route.id.trim()) {
      throw new Error("Every origin-destination route requires a non-empty id.");
    }
    if (routeIds.has(route.id)) {
      throw new Error(`Origin-destination model repeats route id ${route.id}.`);
    }
    routeIds.add(route.id);
    if (!originsById.has(route.originId)) {
      throw new Error(`Route ${route.id} refers to unknown origin ${route.originId}.`);
    }
    if (!destinationsById.has(route.destinationId)) {
      throw new Error(`Route ${route.id} refers to unknown destination ${route.destinationId}.`);
    }
    const key = pairKey(route.originId, route.destinationId);
    if (routesByPair.has(key)) {
      throw new Error(
        `Origin-destination model repeats route ${route.originId} to ${route.destinationId}.`,
      );
    }
    const observations = new Map<string, HistoricalObservation>();
    for (const observation of route.history) {
      validateObservation(route.id, observation);
      if (observations.has(observation.period)) {
        throw new Error(`Route ${route.id} repeats period ${observation.period}.`);
      }
      observations.set(observation.period, { ...observation });
      observedPeriods.push(observation.period);
    }
    routesByPair.set(key, { route, observations });
  }

  const periods = uniquePeriods(input.periods ?? observedPeriods);
  if (!periods.length) {
    throw new Error("Origin-destination model has no source periods.");
  }
  if (input.periods) {
    const domain = new Set(periods);
    const outsideDomain = observedPeriods.find((period) => !domain.has(period));
    if (outsideDomain) {
      throw new Error(
        `Origin-destination observation ${outsideDomain} is outside the declared period domain.`,
      );
    }
  }
  const latestPeriod = input.latestPeriod ?? periods.at(-1)!;
  if (!periods.includes(latestPeriod)) {
    throw new Error(`Latest origin-destination period ${latestPeriod} is not declared.`);
  }

  const origins = [...originsById.values()];
  const destinations = [...destinationsById.values()];
  const routes: OriginDestinationRoute[] = input.routes.map((route) => ({
    id: route.id,
    originId: route.originId,
    originLabel: originsById.get(route.originId)!.label,
    destinationId: route.destinationId,
    destinationLabel: destinationsById.get(route.destinationId)!.label,
    history: route.history.map((observation) => ({ ...observation })),
  }));
  const snapshots = periods.map((period): OriginDestinationSnapshot => {
    const cells = origins.flatMap((origin) => destinations.map(
      (destination): OriginDestinationCell => {
        const entry = routesByPair.get(pairKey(origin.id, destination.id));
        if (!entry) {
          return {
            routeId: null,
            origin,
            destination,
            period,
            value: null,
            status: "no_published_fact",
            declared: false,
          };
        }
        const observation = entry.observations.get(period);
        return {
          routeId: entry.route.id,
          origin,
          destination,
          period,
          value: observation?.value ?? null,
          status: (observation?.status as OriginDestinationStatus | undefined) ?? "missing",
          declared: true,
        };
      },
    ));
    const declaredCells = cells.filter((cell) => cell.declared);
    const numericCells = declaredCells.filter((cell) => numeric(cell.value));
    return {
      period,
      origins,
      destinations,
      cells,
      declaredRouteCount: declaredCells.length,
      numericRouteCount: numericCells.length,
      nonnumericRouteCount: declaredCells.length - numericCells.length,
      maximumAbsoluteValue: numericCells.reduce(
        (maximum, cell) => Math.max(maximum, Math.abs(cell.value!)),
        0,
      ),
    };
  });

  return {
    id: input.id,
    title: input.title,
    description: input.description,
    sourceUnit: input.sourceUnit,
    frequency: input.frequency,
    productLabel: input.productLabel,
    modeLabel: input.modeLabel,
    sourceNote: input.sourceNote,
    origins,
    destinations,
    routes,
    periods,
    latestPeriod,
    snapshots,
  };
}

export function originDestinationSnapshot(
  model: OriginDestinationModel,
  period = model.latestPeriod,
): OriginDestinationSnapshot {
  const snapshot = model.snapshots.find((candidate) => candidate.period === period);
  if (!snapshot) {
    throw new Error(`Origin-destination period ${period} is unavailable.`);
  }
  return snapshot;
}

export function filterOriginDestinationSnapshot(
  snapshot: OriginDestinationSnapshot,
  filter: OriginDestinationFilter,
): OriginDestinationSnapshot {
  if (
    filter.originId
    && !snapshot.origins.some((origin) => origin.id === filter.originId)
  ) {
    throw new Error(`Unknown origin filter ${filter.originId}.`);
  }
  if (
    filter.destinationId
    && !snapshot.destinations.some(
      (destination) => destination.id === filter.destinationId,
    )
  ) {
    throw new Error(`Unknown destination filter ${filter.destinationId}.`);
  }
  const origins = filter.originId
    ? snapshot.origins.filter((origin) => origin.id === filter.originId)
    : snapshot.origins;
  const destinations = filter.destinationId
    ? snapshot.destinations.filter(
        (destination) => destination.id === filter.destinationId,
      )
    : snapshot.destinations;
  const cells = snapshot.cells.filter(
    (cell) => (
      (!filter.originId || cell.origin.id === filter.originId)
      && (!filter.destinationId || cell.destination.id === filter.destinationId)
    ),
  );
  const declaredCells = cells.filter((cell) => cell.declared);
  const numericCells = declaredCells.filter((cell) => numeric(cell.value));
  return {
    period: snapshot.period,
    origins,
    destinations,
    cells,
    declaredRouteCount: declaredCells.length,
    numericRouteCount: numericCells.length,
    nonnumericRouteCount: declaredCells.length - numericCells.length,
    maximumAbsoluteValue: numericCells.reduce(
      (maximum, cell) => Math.max(maximum, Math.abs(cell.value!)),
      0,
    ),
  };
}

export function rankOriginDestinationRoutes(
  snapshot: OriginDestinationSnapshot,
  limit = 8,
): OriginDestinationCell[] {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Origin-destination rank limit must be a positive integer.");
  }
  return snapshot.cells
    .filter(
      (cell): cell is OriginDestinationCell & { value: number } => numeric(cell.value),
    )
    .sort((left, right) => (
      Math.abs(right.value) - Math.abs(left.value)
      || left.origin.label.localeCompare(right.origin.label)
      || left.destination.label.localeCompare(right.destination.label)
    ))
    .slice(0, limit);
}
