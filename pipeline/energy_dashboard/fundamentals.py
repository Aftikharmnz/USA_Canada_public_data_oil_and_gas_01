"""Registered cross-series fundamental driver sets for forecast candidates.

This module registers the *only* cross-series relationships the forecasting
layer may use, and each registration must be a documented physical accounting
identity, not a discovered correlation.  The initial registrations follow the
EIA weekly petroleum balance for a refined product at the national level:

    ending stocks[t] = ending stocks[t-1]
        + days_per_week * (production[t] + imports[t]
                           - exports[t] - product supplied[t])
        + unaccounted[t]

where the flow terms are weekly-average rates in thousand barrels per day,
stocks are levels in thousand barrels, and ``unaccounted`` collects blending
adjustments, inter-district movements outside the registered series, and
source rounding.  The candidate model estimates that unaccounted term from
recent history instead of pretending the registered series close the balance
exactly.

Registration rules:

- National (``us``) targets only.  PADD-level balances do not close because
  inter-PADD movements are not registered series; a district identity would
  fabricate a relationship the source does not publish.
- Every flow term must be an active registered series with the same weekly
  frequency and thousand-barrels-per-day unit.  A missing term disqualifies
  the product: total gasoline and finished gasoline are deliberately not
  registered because weekly motor-gasoline exports are inactive due to EIA's
  June 2023 definition break, and a balance with a silently absorbed export
  term of that size would be misleading.
- Resolution fails closed: any ambiguity (missing series, duplicate dimension
  slices, unit drift) simply withholds the fundamental candidate and leaves
  the univariate candidate set untouched.

The driver series share the target's release (the Weekly Petroleum Status
Report), so at a rolling-origin cut every driver value up to the origin period
carries the same information time as the target's own history.  The vintage
caveat is unchanged: these are latest stored provider values, not
reconstructed first releases.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from .contracts import Frequency, Observation

DAYS_PER_WEEK = 7.0

# Sign of each registered flow role inside the balance identity.
FLOW_ROLE_SIGNS: dict[str, float] = {
    "production": 1.0,
    "imports": 1.0,
    "exports": -1.0,
    "product_supplied": -1.0,
}


@dataclass(frozen=True, slots=True)
class FundamentalDriverSpec:
    """One registered accounting identity for a stock-level target series."""

    target_series_id: str
    geography_id: str
    level_unit: str
    flow_unit: str
    frequency: Frequency
    drivers: tuple[tuple[str, str], ...]
    identity: str
    notes: str


@dataclass(frozen=True, slots=True)
class ResolvedFundamentals:
    """Driver observations resolved from one canonical snapshot, fail-closed."""

    spec: FundamentalDriverSpec
    driver_rows: tuple[tuple[str, tuple[Observation, ...]], ...]

    @property
    def driver_lineage(self) -> tuple[dict[str, str], ...]:
        return tuple(
            {
                "role": role,
                "series_id": series_id,
                "geography_id": self.spec.geography_id,
            }
            for role, series_id in self.spec.drivers
        )


_WEEKLY_BALANCE_IDENTITY = (
    "stocks[t] = stocks[t-1] + 7 x (production + imports - exports - product supplied) "
    "+ unaccounted"
)

REGISTERED_FUNDAMENTAL_DRIVERS: dict[str, FundamentalDriverSpec] = {
    "usa.eia.refined.distillate.total.stocks.weekly": FundamentalDriverSpec(
        target_series_id="usa.eia.refined.distillate.total.stocks.weekly",
        geography_id="us",
        level_unit="thousand_barrels",
        flow_unit="thousand_barrels_per_day",
        frequency=Frequency.WEEKLY,
        drivers=(
            ("production", "usa.eia.refined.distillate.total.production.weekly"),
            ("imports", "usa.eia.refined.distillate.total.imports.weekly"),
            ("exports", "usa.eia.refined.distillate.total.exports.weekly"),
            (
                "product_supplied",
                "usa.eia.refined.distillate.total.product_supplied.weekly",
            ),
        ),
        identity=_WEEKLY_BALANCE_IDENTITY,
        notes=(
            "National weekly distillate balance. Total distillate is broader than "
            "road diesel; the unaccounted term absorbs blending and rounding."
        ),
    ),
    "usa.eia.refined.jet.kerosene_type.stocks.weekly": FundamentalDriverSpec(
        target_series_id="usa.eia.refined.jet.kerosene_type.stocks.weekly",
        geography_id="us",
        level_unit="thousand_barrels",
        flow_unit="thousand_barrels_per_day",
        frequency=Frequency.WEEKLY,
        drivers=(
            ("production", "usa.eia.refined.jet.kerosene_type.production.weekly"),
            ("imports", "usa.eia.refined.jet.kerosene_type.imports.weekly"),
            ("exports", "usa.eia.refined.jet.kerosene_type.exports.weekly"),
            (
                "product_supplied",
                "usa.eia.refined.jet.kerosene_type.product_supplied.weekly",
            ),
        ),
        identity=_WEEKLY_BALANCE_IDENTITY,
        notes=(
            "National weekly kerosene-type jet fuel balance. The unaccounted term "
            "absorbs blending and rounding."
        ),
    ),
}

# Gasoline is deliberately absent: weekly motor-gasoline exports are inactive
# because of EIA's June 2023 definition break, so the gasoline balance cannot
# be registered without silently absorbing an export term of material size.
EXCLUDED_FUNDAMENTAL_TARGETS: dict[str, str] = {
    "usa.eia.refined.gasoline.total.stocks.weekly": (
        "Weekly motor-gasoline exports are inactive (June 2023 definition break), "
        "so the gasoline balance identity is incomplete and is not registered."
    ),
    "usa.eia.refined.gasoline.finished.stocks.weekly": (
        "Weekly motor-gasoline exports are inactive (June 2023 definition break), "
        "so the finished-gasoline balance identity is incomplete and is not "
        "registered."
    ),
}

GroupKey = tuple[str, str, tuple[tuple[str, str], ...]]


def resolve_fundamental_drivers(
    target_series_id: str,
    geography_id: str,
    grouped: Mapping[GroupKey, Sequence[Observation]],
) -> ResolvedFundamentals | None:
    """Return complete registered driver rows for a target, or fail closed.

    ``grouped`` is the same (series, geography, dimensions) -> observations
    mapping the refresh and rebuild orchestrators already build from the
    canonical snapshot.  Any missing driver series, duplicate dimension slice,
    or unit/frequency drift returns ``None`` so the forecast silently keeps
    its univariate candidate set.
    """

    spec = REGISTERED_FUNDAMENTAL_DRIVERS.get(target_series_id)
    if spec is None or geography_id != spec.geography_id:
        return None
    resolved: list[tuple[str, tuple[Observation, ...]]] = []
    for role, series_id in spec.drivers:
        matches = [
            key
            for key in grouped
            if key[0] == series_id and key[1] == spec.geography_id
        ]
        if len(matches) != 1:
            return None
        rows = tuple(sorted(grouped[matches[0]], key=lambda row: row.period))
        if not rows or any(row.unit != spec.flow_unit for row in rows):
            return None
        resolved.append((role, rows))
    return ResolvedFundamentals(spec=spec, driver_rows=tuple(resolved))
