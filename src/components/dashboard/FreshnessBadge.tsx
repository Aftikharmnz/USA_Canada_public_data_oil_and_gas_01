import type { FreshnessStatus } from "../../types/energyAssets";

const labels: Record<FreshnessStatus, string> = {
  fresh: "Fresh",
  due: "Release due",
  late: "Release late",
  stale: "Using older asset",
  error: "Update error",
  unknown: "Schedule unknown",
};

export function FreshnessBadge({ status }: { status: FreshnessStatus }) {
  return (
    <span className={`freshness-badge freshness-${status}`}>
      <span className="freshness-dot" aria-hidden="true" />
      {labels[status]}
    </span>
  );
}
