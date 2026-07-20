import canadaGeographies from "../../config/geographies/canada.json";
import usaGeographies from "../../config/geographies/usa.json";
import type { AggregationCountry } from "./customAggregation";

/**
 * Containment closure over the registered geography DAG.
 *
 * A custom combination is only valid when its members describe mutually
 * exclusive territory. Sharing one `level_id` is *not* sufficient evidence of
 * that: EIA publishes "Alaska South" (`us.ak.south`) at the same
 * `state_or_area` level as its declared parent "Alaska" (`us.ak`), so a naive
 * same-level sum would double-count Alaska South. The registry already records
 * the containment through `parent_ids`, so this module turns each node into the
 * set of atomic territories it covers — itself plus every descendant — and lets
 * the aggregation engine reject an overlapping pair through its existing
 * `overlapping_members` rule.
 *
 * Two nodes are therefore treated as overlapping when either contains the
 * other, whatever level they are labelled with.
 *
 * Known registry limitation: the Statistics Canada Atlantic aggregate
 * (`ca.statcan.atlantic`) genuinely contains NB/NL/NS/PE but the registry does
 * not declare those edges, because Atlantic sits at `source_region` while the
 * provinces sit at `province_territory`. Mixing levels in one combination is
 * already refused upstream, so that overlap is unreachable; do not "fix" it by
 * inventing parent edges the source does not publish.
 */

interface RawGeographyNode {
  id?: unknown;
  parent_ids?: unknown;
}

function readNodes(registry: { nodes?: unknown }, country: AggregationCountry): Map<string, string[]> {
  if (!Array.isArray(registry.nodes)) {
    throw new Error(`Geography registry for ${country} must contain a nodes array.`);
  }
  const parents = new Map<string, string[]>();
  for (const raw of registry.nodes as RawGeographyNode[]) {
    if (typeof raw.id !== "string" || !raw.id.trim()) {
      throw new Error(`Geography registry for ${country} contains a node without an id.`);
    }
    if (parents.has(raw.id)) {
      throw new Error(`Geography registry for ${country} repeats node ${raw.id}.`);
    }
    const parentIds = raw.parent_ids === undefined || raw.parent_ids === null ? [] : raw.parent_ids;
    if (!Array.isArray(parentIds) || parentIds.some((value) => typeof value !== "string" || !value.trim())) {
      throw new Error(`Geography node ${raw.id} has invalid parent_ids.`);
    }
    parents.set(raw.id, parentIds as string[]);
  }
  return parents;
}

/** Ancestors of a node, following declared parent edges and tolerating shared parents. */
function ancestorsOf(nodeId: string, parents: Map<string, string[]>): Set<string> {
  const ancestors = new Set<string>();
  const queue = [...(parents.get(nodeId) ?? [])];
  while (queue.length) {
    const current = queue.shift()!;
    if (ancestors.has(current)) continue;
    ancestors.add(current);
    for (const parent of parents.get(current) ?? []) {
      if (!ancestors.has(parent)) queue.push(parent);
    }
  }
  if (ancestors.has(nodeId)) {
    throw new Error(`Geography node ${nodeId} participates in a parent cycle.`);
  }
  return ancestors;
}

function buildAtomIndex(parents: Map<string, string[]>): Map<string, ReadonlySet<string>> {
  const atoms = new Map<string, Set<string>>();
  for (const nodeId of parents.keys()) atoms.set(nodeId, new Set([nodeId]));
  for (const nodeId of parents.keys()) {
    // Every ancestor covers this node's territory, so record the descendant atom.
    for (const ancestor of ancestorsOf(nodeId, parents)) {
      atoms.get(ancestor)?.add(nodeId);
    }
  }
  return atoms as Map<string, ReadonlySet<string>>;
}

const ATOM_INDEX: Record<AggregationCountry, Map<string, ReadonlySet<string>>> = {
  usa: buildAtomIndex(readNodes(usaGeographies, "usa")),
  canada: buildAtomIndex(readNodes(canadaGeographies, "canada")),
};

/**
 * Atomic territories covered by one registered node.
 *
 * An unregistered id falls back to itself. That keeps the combination
 * conservative rather than crashing: an unknown node can only ever collide with
 * an identically named one, and the aggregation engine separately rejects
 * members that are not authorized by the policy.
 */
export function atomicMembershipIds(
  country: AggregationCountry,
  geographyId: string,
): string[] {
  const atoms = ATOM_INDEX[country].get(geographyId);
  return atoms ? [...atoms].sort() : [geographyId];
}

/** True when either region contains the other, so they must not be summed together. */
export function regionsOverlap(
  country: AggregationCountry,
  left: string,
  right: string,
): boolean {
  if (left === right) return true;
  const leftAtoms = ATOM_INDEX[country].get(left);
  const rightAtoms = ATOM_INDEX[country].get(right);
  if (!leftAtoms || !rightAtoms) return false;
  for (const atom of leftAtoms) {
    if (rightAtoms.has(atom)) return true;
  }
  return false;
}

/**
 * The already-selected region that blocks adding `candidateId`, if any.
 * Used to disable the checkbox and explain why.
 */
export function overlappingSelection(
  country: AggregationCountry,
  selectedIds: readonly string[],
  candidateId: string,
): string | undefined {
  return selectedIds.find(
    (selectedId) => selectedId !== candidateId && regionsOverlap(country, selectedId, candidateId),
  );
}
