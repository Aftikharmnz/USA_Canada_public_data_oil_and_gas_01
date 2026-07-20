"""Geography graph validation and source-aware filter options."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from .contracts import GeographyAvailability, GeographyLevel, GeographyNode


class GeographyOrigin(StrEnum):
    SOURCE = "source"
    DERIVED = "derived"


@dataclass(frozen=True, slots=True)
class GeographyOption:
    level_id: str
    geography_id: str
    label: str
    origin: GeographyOrigin
    is_finest_available: bool


@dataclass(frozen=True, slots=True)
class GeographyLevelDecision:
    level_id: str
    label: str
    supported: bool
    options: tuple[GeographyOption, ...]
    reason: str | None = None


class GeographyCatalog:
    """Versioned DAG; unlike a simple ladder, nodes may have multiple parents."""

    def __init__(
        self,
        levels: tuple[GeographyLevel, ...],
        nodes: tuple[GeographyNode, ...],
    ) -> None:
        self.levels = {level.id: level for level in levels}
        self.nodes = {node.id: node for node in nodes}
        if len(self.levels) != len(levels) or len(self.nodes) != len(nodes):
            raise ValueError("Geography level and node ids must be unique")
        self._validate()

    def _validate(self) -> None:
        for node in self.nodes.values():
            level = self.levels.get(node.level_id)
            if level is None:
                raise ValueError(f"Unknown geography level {node.level_id!r} for {node.id!r}")
            if level.country is not node.country:
                raise ValueError(f"Country mismatch for geography node {node.id!r}")
            for parent_id in node.parent_ids:
                parent = self.nodes.get(parent_id)
                if parent is None:
                    raise ValueError(f"Unknown parent {parent_id!r} for {node.id!r}")
                if parent.country is not node.country:
                    raise ValueError("A geography parent cannot cross countries")

        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(node_id: str) -> None:
            if node_id in visiting:
                raise ValueError(f"Geography membership contains a cycle at {node_id!r}")
            if node_id in visited:
                return
            visiting.add(node_id)
            for parent_id in self.nodes[node_id].parent_ids:
                visit(parent_id)
            visiting.remove(node_id)
            visited.add(node_id)

        for node_id in self.nodes:
            visit(node_id)

    def level_decisions(
        self,
        availability: GeographyAvailability,
    ) -> tuple[GeographyLevelDecision, ...]:
        source_ids = set(availability.source_geography_ids)
        rollup_ids = {rollup.target_geography_id for rollup in availability.rollups}
        unknown = (source_ids | rollup_ids) - self.nodes.keys()
        if unknown:
            raise ValueError(f"Availability references unknown geographies: {sorted(unknown)}")

        available_nodes = [self.nodes[node_id] for node_id in source_ids | rollup_ids]
        finest_rank = min(self.levels[node.level_id].granularity_rank for node in available_nodes)
        decisions: list[GeographyLevelDecision] = []

        for level in sorted(self.levels.values(), key=lambda candidate: candidate.granularity_rank):
            level_nodes = sorted(
                (node for node in available_nodes if node.level_id == level.id),
                key=lambda node: node.label,
            )
            options = tuple(
                GeographyOption(
                    level_id=level.id,
                    geography_id=node.id,
                    label=node.label,
                    origin=(
                        GeographyOrigin.SOURCE if node.id in source_ids else GeographyOrigin.DERIVED
                    ),
                    is_finest_available=level.granularity_rank == finest_rank,
                )
                for node in level_nodes
            )
            reason = None
            if not options:
                reason = availability.reason_for_level(level.id) or (
                    f"This series is not published or safely derivable at the {level.label} level."
                )
            decisions.append(
                GeographyLevelDecision(
                    level_id=level.id,
                    label=level.label,
                    supported=bool(options),
                    options=options,
                    reason=reason,
                )
            )
        return tuple(decisions)

    def options(self, availability: GeographyAvailability) -> tuple[GeographyOption, ...]:
        return tuple(
            option
            for decision in self.level_decisions(availability)
            for option in decision.options
        )

    def decision_for_level(
        self,
        availability: GeographyAvailability,
        level_id: str,
    ) -> GeographyLevelDecision:
        for decision in self.level_decisions(availability):
            if decision.level_id == level_id:
                return decision
        raise KeyError(f"Unknown geography level: {level_id}")

