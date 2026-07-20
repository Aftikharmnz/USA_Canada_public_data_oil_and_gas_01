"""Command-line entry points for planning, EIA refresh, and public promotion."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from .canada_registry import load_cer_registry
from .cer import (
    CERClient,
    normalize_cer_records,
    roll_up_cer_national_runs,
)
from .eia import EIAClient
from .promotion import promote_current_public_generation
from .rebuild import rebuild_current_analytics
from .refresh import PeriodWindow, run_eia_refresh
from .registry import load_eia_registry, load_provider_geographies
from .statcan import StatCanClient
from .statcan_refresh import AdditionalCanadaBatch, run_statcan_refresh
from .statcan_registry import load_statcan_registry
from .storage import SnapshotStore


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Energy dashboard pipeline foundation")
    subparsers = parser.add_subparsers(dest="command", required=True)
    plan = subparsers.add_parser("plan", help="Print a no-network refresh plan")
    plan.add_argument(
        "--provider",
        choices=("all", "eia", "statcan", "cer"),
        default="all",
    )
    refresh = subparsers.add_parser(
        "refresh-eia", help="Refresh verified EIA series into an immutable generation"
    )
    refresh.add_argument("--series-registry", type=Path, default=Path("config/series/usa.json"))
    refresh.add_argument(
        "--geography-registry", type=Path, default=Path("config/geographies/usa.json")
    )
    refresh.add_argument("--store", type=Path, default=Path("data/cache/eia"))
    refresh.add_argument("--run-id")
    refresh.add_argument("--series-id", action="append", default=[])
    refresh.add_argument("--period-start")
    refresh.add_argument("--period-end")
    refresh.add_argument("--expected-period")
    refresh.add_argument("--activation-status", default="active")
    refresh.add_argument("--promote-to", type=Path)
    unchanged = refresh.add_mutually_exclusive_group()
    unchanged.add_argument(
        "--skip-unchanged",
        dest="skip_unchanged",
        action="store_true",
        help="Keep CURRENT/public unchanged when no values or statuses changed (default)",
    )
    unchanged.add_argument(
        "--publish-unchanged",
        dest="skip_unchanged",
        action="store_false",
        help="Force a new generation even when canonical values are unchanged",
    )
    refresh.set_defaults(skip_unchanged=True)
    refresh.add_argument(
        "--retain-generations",
        type=int,
        default=2,
        help="After successful promotion retain CURRENT plus newest predecessors (default: 2 total)",
    )
    refresh.add_argument(
        "--dry-run", action="store_true", help="Validate and print query plans without network calls"
    )
    canada = subparsers.add_parser(
        "refresh-canada",
        help="Atomically refresh verified Statistics Canada and CER series",
    )
    canada.add_argument(
        "--series-registry", type=Path, default=Path("config/series/canada.json")
    )
    canada.add_argument(
        "--geography-registry", type=Path, default=Path("config/geographies/canada.json")
    )
    canada.add_argument("--store", type=Path, default=Path("data/cache/canada"))
    canada.add_argument("--run-id")
    canada.add_argument("--series-id", action="append", default=[])
    canada.add_argument("--period-start")
    canada.add_argument("--period-end")
    canada.add_argument("--expected-period")
    canada.add_argument("--expected-monthly-period")
    canada.add_argument("--expected-weekly-period")
    canada.add_argument("--activation-status", default="active")
    canada.add_argument("--promote-to", type=Path)
    canada_unchanged = canada.add_mutually_exclusive_group()
    canada_unchanged.add_argument(
        "--skip-unchanged", dest="skip_unchanged", action="store_true"
    )
    canada_unchanged.add_argument(
        "--publish-unchanged", dest="skip_unchanged", action="store_false"
    )
    canada.set_defaults(skip_unchanged=True)
    canada.add_argument("--retain-generations", type=int, default=2)
    canada.add_argument("--dry-run", action="store_true")
    promote = subparsers.add_parser(
        "promote", help="Verify and atomically promote the store's current public generation"
    )
    promote.add_argument("--store", type=Path, default=Path("data/cache/eia"))
    promote.add_argument("--destination", type=Path, default=Path("public/data/usa"))
    promote.add_argument("--expected-run-id")
    promote.add_argument("--retain-generations", type=int, default=2)
    rebuild = subparsers.add_parser(
        "rebuild-analytics",
        help="Rebuild observed statistics and forecast assets from CURRENT without network calls",
    )
    rebuild.add_argument("--store", type=Path, required=True)
    rebuild.add_argument("--destination", type=Path, required=True)
    rebuild.add_argument("--run-id")
    rebuild.add_argument("--retain-generations", type=int, default=2)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "plan":
        providers = ("eia", "statcan", "cer") if args.provider == "all" else (args.provider,)
        output = {
            "dry_run": True,
            "network_calls": False,
            "providers": providers,
            "planned_at": datetime.now(UTC).isoformat(),
            "message": (
                "Informational provider list only. Use refresh-eia --dry-run or "
                "refresh-canada --dry-run for the active registry-backed plans."
            ),
        }
        print(json.dumps(output, indent=2))
        return 0
    if args.command == "rebuild-analytics":
        if args.retain_generations < 1:
            raise ValueError("--retain-generations must be at least 1")
        generated_at = datetime.now(UTC)
        run_id = args.run_id or generated_at.strftime("analytics-%Y%m%dT%H%M%SZ")
        store = SnapshotStore(args.store)
        result = rebuild_current_analytics(
            store,
            run_id=run_id,
            generated_at=generated_at,
        )
        promoted = promote_current_public_generation(
            store,
            args.destination,
            expected_run_id=result.run_id,
        )
        pruned = store.prune_generations(retain=args.retain_generations)
        print(
            json.dumps(
                {
                    "run_id": result.run_id,
                    "previous_run_id": result.previous_run_id,
                    "generation_path": str(result.generation_path),
                    "public_manifest_path": str(result.public_manifest_path),
                    "promoted_manifest_path": str(promoted),
                    "asset_count": result.asset_count,
                    "forecast_count": result.forecast_count,
                    "provider_network_calls": 0,
                    "pruned_generations": list(pruned),
                },
                indent=2,
            )
        )
        return 0
    if args.command == "refresh-canada":
        if args.retain_generations < 1:
            raise ValueError("--retain-generations must be at least 1")
        all_statcan = load_statcan_registry(
            args.series_registry, activation_status=args.activation_status
        )
        all_cer = load_cer_registry(
            args.series_registry, activation_status=args.activation_status
        )
        all_ids = {spec.id for spec in (*all_statcan, *all_cer)}
        selected = set(args.series_id) if args.series_id else all_ids
        if unknown := selected - all_ids:
            raise ValueError(f"Unknown or inactive Canada series ids: {sorted(unknown)}")
        statcan_specs = tuple(spec for spec in all_statcan if spec.id in selected)
        cer_specs = tuple(spec for spec in all_cer if spec.id in selected)
        geographies = load_provider_geographies(
            args.geography_registry,
            provider_id="statcan",
            provider_code_field="statcan_dguid",
        )
        selected_frequencies = {spec.frequency.value for spec in (*statcan_specs, *cer_specs)}
        if args.expected_period and len(selected_frequencies) > 1:
            raise ValueError(
                "--expected-period requires a single selected frequency; use "
                "--expected-monthly-period and --expected-weekly-period for a combined refresh"
            )
        windows = {
            spec.id: PeriodWindow(
                args.period_start,
                args.period_end,
                args.expected_period
                or (
                    args.expected_monthly_period
                    if spec.frequency.value == "monthly"
                    else args.expected_weekly_period
                ),
            )
            for spec in (*statcan_specs, *cer_specs)
        }
        if args.dry_run:
            tables = {
                spec.table.pid: {
                    "pid": spec.table.pid,
                    "wds_url": spec.table.wds_url,
                    "credential_required": False,
                }
                for spec in statcan_specs
            }
            output = {
                "dry_run": True,
                "network_calls": False,
                "providers": ["statcan", "cer"],
                "tables": [tables[key] for key in sorted(tables)],
                "series": [
                    {
                        "series_id": spec.id,
                        "provider": "statcan",
                        "frequency": spec.frequency.value,
                        "table_pid": spec.table.pid,
                        "row_filters": dict(spec.row_filters),
                        "source_geography_ids": list(spec.source_geography_ids),
                        "bootstrap_period_start": spec.bootstrap_start,
                    }
                    for spec in statcan_specs
                ]
                + [
                    {
                        "series_id": spec.id,
                        "provider": "cer",
                        "frequency": spec.frequency.value,
                        "source_geography_ids": list(spec.source_geography_ids),
                        "bootstrap_period_start": spec.bootstrap_start,
                    }
                    for spec in cer_specs
                ],
                "mapped_statcan_geographies": len(geographies.code_to_geography_id),
                "skip_unchanged": args.skip_unchanged,
                "period_start": args.period_start,
                "period_end": args.period_end,
                "expected_period": args.expected_period,
                "expected_monthly_period": args.expected_monthly_period,
                "expected_weekly_period": args.expected_weekly_period,
                "automatic_overlap": {
                    "weekly": "13 weeks when canonical history exists",
                    "monthly": "10 years when canonical history exists",
                },
            }
            print(json.dumps(output, indent=2))
            return 0

        generated_at = datetime.now(UTC)
        additional: list[AdditionalCanadaBatch] = []
        if cer_specs:
            cer_by_id = {spec.id: spec for spec in all_cer}
            runs_id = "can.cer.refinery.crude_runs.weekly"
            utilization_id = "can.cer.refinery.utilization.weekly"
            if runs_id not in cer_by_id or utilization_id not in cer_by_id:
                raise ValueError("Active CER registry must define runs and utilization together")
            fetched = CERClient().fetch()
            regional = normalize_cer_records(
                fetched.records,
                region_geography_ids={
                    "Ontario": "ca.cer.ontario",
                    "Quebec & Eastern Canada": "ca.cer.quebec_eastern",
                    "Western Canada": "ca.cer.western",
                },
                retrieved_at=generated_at,
                runs_series_id=runs_id,
                utilization_series_id=utilization_id,
            )
            national = roll_up_cer_national_runs(
                regional.runs,
                region_geography_ids={
                    "Ontario": "ca.cer.ontario",
                    "Quebec & Eastern Canada": "ca.cer.quebec_eastern",
                    "Western Canada": "ca.cer.western",
                },
                national_geography_id="ca",
                membership_version="cer-confidentiality-regions-v1",
            )
            latest_lineage = national[-1].lineage
            lineage = {
                "aggregation_kind": latest_lineage.aggregation_rule.value,
                "aggregation_rule": latest_lineage.aggregation_rule.value,
                "membership_version": latest_lineage.membership_version,
                "member_geography_ids": list(latest_lineage.member_geography_ids),
                "coverage_ratio": float(latest_lineage.coverage),
                "coverage": float(latest_lineage.coverage),
                "expected_component_count": len(latest_lineage.member_geography_ids),
                "observed_component_count": len(latest_lineage.member_geography_ids),
                "source_observation_keys": list(latest_lineage.source_observation_keys),
            }
            if runs_id in selected:
                observations = (*regional.runs, *(result.observation for result in national))
                additional.append(
                    AdditionalCanadaBatch(
                        spec=cer_by_id[runs_id],
                        observations=tuple(observations),
                        payload_hash=fetched.payload_sha256,
                        source_summary={
                            "series_id": runs_id,
                            "source_url": fetched.source_url,
                            "rows": len(observations),
                            "payload_sha256": fetched.payload_sha256,
                            "request_count": fetched.request_count,
                        },
                        aggregation_lineage_by_geography={"ca": lineage},
                    )
                )
            if utilization_id in selected:
                additional.append(
                    AdditionalCanadaBatch(
                        spec=cer_by_id[utilization_id],
                        observations=regional.utilization,
                        payload_hash=fetched.payload_sha256,
                        source_summary={
                            "series_id": utilization_id,
                            "source_url": fetched.source_url,
                            "rows": len(regional.utilization),
                            "payload_sha256": fetched.payload_sha256,
                            "request_count": fetched.request_count,
                        },
                    )
                )
        run_id = args.run_id or generated_at.strftime("canada-%Y%m%dT%H%M%SZ")
        store = SnapshotStore(args.store)
        result = run_statcan_refresh(
            statcan_specs,
            geographies,
            StatCanClient(),
            store,
            run_id=run_id,
            generated_at=generated_at,
            period_windows=windows,
            skip_unchanged=args.skip_unchanged,
            manifest_series_specs=all_statcan,
            additional_batches=tuple(additional),
            additional_manifest_series_specs=all_cer,
        )
        promoted = None
        pruned: tuple[str, ...] = ()
        if args.promote_to is not None and result.changed:
            promoted = promote_current_public_generation(
                store, args.promote_to, expected_run_id=result.run_id
            )
            pruned = store.prune_generations(retain=args.retain_generations)
        print(
            json.dumps(
                {
                    "run_id": result.run_id,
                    "attempted_run_id": run_id,
                    "changed": result.changed,
                    "generation_path": str(result.generation_path),
                    "public_manifest_path": str(result.public_manifest_path),
                    "promoted_manifest_path": None if promoted is None else str(promoted),
                    "rows_inserted": result.inserted_rows,
                    "rows_revised": result.revised_rows,
                    "rows_unchanged": result.unchanged_rows,
                    "asset_count": result.asset_count,
                    "pruned_generations": list(pruned),
                },
                indent=2,
            )
        )
        return 0
    if args.command == "refresh-eia":
        if args.retain_generations < 1:
            raise ValueError("--retain-generations must be at least 1")
        all_specs = load_eia_registry(
            args.series_registry, activation_status=args.activation_status
        )
        specs = all_specs
        if args.series_id:
            selected = set(args.series_id)
            unknown = selected - {spec.id for spec in specs}
            if unknown:
                raise ValueError(f"Unknown or inactive EIA series ids: {sorted(unknown)}")
            specs = tuple(spec for spec in specs if spec.id in selected)
        geographies = load_provider_geographies(args.geography_registry)
        window = PeriodWindow(args.period_start, args.period_end, args.expected_period)
        windows = {spec.id: window for spec in specs}
        if args.dry_run:
            output = {
                "dry_run": True,
                "network_calls": False,
                "series": [
                    {
                        "series_id": spec.id,
                        "route": spec.route,
                        "frequency": spec.query.frequency,
                        "data_fields": list(spec.query.data_fields),
                        "facets": {name: list(values) for name, values in spec.query.facets},
                        "period_start": args.period_start,
                        "bootstrap_period_start": spec.bootstrap_start,
                        "period_end": args.period_end,
                        "expected_period": args.expected_period,
                        "credential_environment_variable": spec.credential_environment_variable,
                    }
                    for spec in specs
                ],
                "mapped_provider_geographies": len(geographies.code_to_geography_id),
                "skip_unchanged": args.skip_unchanged,
                "automatic_overlap": {
                    "weekly": "13 weeks when canonical history exists",
                    "monthly": "10 years when canonical history exists",
                },
                "empty_history": "Uses each registry-defined bootstrap_period_start",
            }
            print(json.dumps(output, indent=2))
            return 0
        generated_at = datetime.now(UTC)
        run_id = args.run_id or generated_at.strftime("eia-%Y%m%dT%H%M%SZ")
        clients = {
            environment_variable: EIAClient(
                api_key_environment_variable=environment_variable
            )
            for environment_variable in {
                spec.credential_environment_variable for spec in specs
            }
        }
        store = SnapshotStore(args.store)
        result = run_eia_refresh(
            specs,
            geographies,
            clients,
            store,
            run_id=run_id,
            generated_at=generated_at,
            period_windows=windows,
            skip_unchanged=args.skip_unchanged,
            manifest_series_specs=all_specs,
        )
        promoted = None
        pruned: tuple[str, ...] = ()
        if args.promote_to is not None and result.changed:
            promoted = promote_current_public_generation(
                store, args.promote_to, expected_run_id=result.run_id
            )
            pruned = store.prune_generations(retain=args.retain_generations)
        print(
            json.dumps(
                {
                    "run_id": result.run_id,
                    "attempted_run_id": run_id,
                    "changed": result.changed,
                    "generation_path": str(result.generation_path),
                    "public_manifest_path": str(result.public_manifest_path),
                    "promoted_manifest_path": None if promoted is None else str(promoted),
                    "rows_inserted": result.inserted_rows,
                    "rows_revised": result.revised_rows,
                    "rows_unchanged": result.unchanged_rows,
                    "asset_count": result.asset_count,
                    "pruned_generations": list(pruned),
                },
                indent=2,
            )
        )
        return 0
    if args.command == "promote":
        if args.retain_generations < 1:
            raise ValueError("--retain-generations must be at least 1")
        store = SnapshotStore(args.store)
        promoted = promote_current_public_generation(
            store,
            args.destination,
            expected_run_id=args.expected_run_id,
        )
        pruned = store.prune_generations(retain=args.retain_generations)
        print(
            json.dumps(
                {
                    "promoted_manifest_path": str(promoted),
                    "pruned_generations": list(pruned),
                },
                indent=2,
            )
        )
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
