import registry from "../../config/aggregation/custom-geography.json";

export type AggregationCountry = "usa" | "canada";
export type CustomAggregationRule = "sum";

export interface CustomAggregationPolicy {
  country: AggregationCountry;
  levelId: string;
  rule: CustomAggregationRule;
  membershipNamespace: string;
  membershipVersion: string;
  minimumMembers: number;
  maximumMembers: number;
  requiredCoverage: 1;
  seriesIds: readonly string[];
}

interface RawPolicy {
  country?: unknown;
  level_id?: unknown;
  rule?: unknown;
  membership_namespace?: unknown;
  minimum_members?: unknown;
  maximum_members?: unknown;
  required_coverage?: unknown;
  series_ids?: unknown;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Custom aggregation ${field} must be a non-empty string.`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`Custom aggregation ${field} must be a positive integer.`);
  }
  return value;
}

function parseRegistry(): CustomAggregationPolicy[] {
  if (registry.schema_version !== "1.0.0") {
    throw new Error(`Unsupported custom aggregation registry ${registry.schema_version}.`);
  }
  const membershipVersion = text(registry.membership_version, "membership_version");
  if (!Array.isArray(registry.policies)) {
    throw new Error("Custom aggregation registry policies must be an array.");
  }
  const seen = new Set<string>();
  return (registry.policies as RawPolicy[]).map((raw, index) => {
    const country = text(raw.country, `policies[${index}].country`);
    if (country !== "usa" && country !== "canada") {
      throw new Error(`Custom aggregation country is unsupported: ${country}.`);
    }
    const rule = text(raw.rule, `policies[${index}].rule`);
    if (rule !== "sum") {
      throw new Error(`Custom aggregation rule is unsupported: ${rule}.`);
    }
    if (raw.required_coverage !== 1) {
      throw new Error("Custom geographic sums require complete coverage (1.0)." );
    }
    if (!Array.isArray(raw.series_ids) || !raw.series_ids.length) {
      throw new Error(`Custom aggregation policies[${index}].series_ids must not be empty.`);
    }
    const seriesIds = raw.series_ids.map((value, seriesIndex) => (
      text(value, `policies[${index}].series_ids[${seriesIndex}]`)
    ));
    if (new Set(seriesIds).size !== seriesIds.length) {
      throw new Error(`Custom aggregation policies[${index}] contains duplicate series ids.`);
    }
    const policy: CustomAggregationPolicy = {
      country,
      levelId: text(raw.level_id, `policies[${index}].level_id`),
      rule,
      membershipNamespace: text(
        raw.membership_namespace,
        `policies[${index}].membership_namespace`,
      ),
      membershipVersion,
      minimumMembers: positiveInteger(raw.minimum_members, `policies[${index}].minimum_members`),
      maximumMembers: positiveInteger(raw.maximum_members, `policies[${index}].maximum_members`),
      requiredCoverage: 1,
      seriesIds,
    };
    if (policy.minimumMembers < 2 || policy.maximumMembers < policy.minimumMembers) {
      throw new Error(`Custom aggregation policies[${index}] has invalid member bounds.`);
    }
    for (const seriesId of seriesIds) {
      const key = `${country}\u0000${policy.levelId}\u0000${seriesId}`;
      if (seen.has(key)) throw new Error(`Duplicate custom aggregation policy for ${seriesId}.`);
      seen.add(key);
    }
    return policy;
  });
}

export const customAggregationPolicies: readonly CustomAggregationPolicy[] = parseRegistry();

export function customAggregationPolicy(
  country: AggregationCountry,
  seriesId: string,
  levelId: string,
): CustomAggregationPolicy | undefined {
  return customAggregationPolicies.find((policy) => (
    policy.country === country
    && policy.levelId === levelId
    && policy.seriesIds.includes(seriesId)
  ));
}

export function seriesAllowsCustomAggregation(
  country: AggregationCountry,
  seriesId: string,
  levelId: string,
  memberCount: number,
): boolean {
  const policy = customAggregationPolicy(country, seriesId, levelId);
  return Boolean(
    policy
    && memberCount >= policy.minimumMembers
    && memberCount <= policy.maximumMembers,
  );
}

export function levelAllowsCustomAggregation(
  country: AggregationCountry,
  levelId: string,
): boolean {
  return customAggregationPolicies.some(
    (policy) => policy.country === country && policy.levelId === levelId,
  );
}
