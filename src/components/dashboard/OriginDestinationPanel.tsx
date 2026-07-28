import {
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import {
  filterOriginDestinationSnapshot,
  originDestinationSnapshot,
  rankOriginDestinationRoutes,
  type OriginDestinationCell,
  type OriginDestinationModel,
  type OriginDestinationSnapshot,
  type OriginDestinationStatus,
} from "../../charts/originDestinationModel";
import {
  compactUnit,
  formatPeriod,
  formatPlainNumber,
  formatValue,
} from "../../lib/formatters";
import { monthlyVolumeToKbPerDay } from "../../lib/periodAverageRate";
import {
  convertUnitValue,
  type DisplayUnitId,
} from "../../lib/units";

echarts.use([
  BarChart,
  AriaComponent,
  GridComponent,
  TooltipComponent,
  CanvasRenderer,
]);

const ROUTE_COLORS = [
  "#0072B2",
  "#009E73",
  "#E69F00",
  "#CC79A7",
  "#D55E00",
  "#56B4E9",
  "#7A5195",
  "#00A6A6",
];

const STATUS_LABELS: Record<OriginDestinationStatus, string> = {
  observed: "Observed",
  preliminary: "Preliminary",
  revised: "Revised",
  computed: "Computed",
  use_with_caution: "Use with caution",
  missing: "Missing",
  not_available: "Not available",
  not_applicable: "Not applicable",
  suppressed_or_withheld: "Suppressed or withheld",
  no_published_fact: "No published fact",
};

const STATUS_CODES: Record<OriginDestinationStatus, string> = {
  observed: "",
  preliminary: "P",
  revised: "R",
  computed: "C",
  use_with_caution: "!",
  missing: "M",
  not_available: "N/A",
  not_applicable: "N/P",
  suppressed_or_withheld: "S",
  no_published_fact: "—",
};

export interface OriginDestinationPanelProps {
  model: OriginDestinationModel;
  displayUnit: DisplayUnitId;
  /**
   * Converts registered monthly volume flows to a calendar-normalized kb/d
   * display. Country adapters remain responsible for authorizing this view.
   */
  monthlyAverageRate?: boolean;
  initialPeriod?: string;
  initialOriginId?: string;
  initialDestinationId?: string;
  highlightedRouteId?: string | null;
  title?: string;
  description?: string;
  sourceDisclosure?: string;
  rankedRouteLimit?: number;
  onRouteSelect?: (cell: OriginDestinationCell) => void;
}

function displayNumber(
  value: number | null,
  period: string,
  sourceUnit: string,
  displayUnit: DisplayUnitId,
  monthlyAverageRate: boolean,
): number | null {
  if (monthlyAverageRate) {
    if (displayUnit !== "thousand_barrels_per_day") {
      throw new Error("Monthly-average origin-destination display requires kb/d.");
    }
    return monthlyVolumeToKbPerDay(value, period, sourceUnit);
  }
  return convertUnitValue(value, sourceUnit, displayUnit);
}

function displayValue(
  value: number | null,
  period: string,
  sourceUnit: string,
  displayUnit: DisplayUnitId,
  monthlyAverageRate: boolean,
): string {
  return formatValue(
    displayNumber(value, period, sourceUnit, displayUnit, monthlyAverageRate),
    displayUnit,
  );
}

function cellValueLabel(
  cell: OriginDestinationCell,
  sourceUnit: string,
  displayUnit: DisplayUnitId,
  monthlyAverageRate: boolean,
): string {
  if (cell.value === null) return STATUS_CODES[cell.status];
  return formatPlainNumber(
    displayNumber(
      cell.value,
      cell.period,
      sourceUnit,
      displayUnit,
      monthlyAverageRate,
    ),
    1,
  );
}

function cellAccessibleLabel(
  cell: OriginDestinationCell,
  sourceUnit: string,
  displayUnit: DisplayUnitId,
  monthlyAverageRate: boolean,
): string {
  const value = cell.value === null
    ? STATUS_LABELS[cell.status]
    : `${displayValue(
        cell.value,
        cell.period,
        sourceUnit,
        displayUnit,
        monthlyAverageRate,
      )}, ${STATUS_LABELS[cell.status]}`;
  return `${cell.origin.label} to ${cell.destination.label}: ${value}, ${formatPeriod(cell.period)}`;
}

function statusClass(status: OriginDestinationStatus): string {
  return `od-status-${status.replaceAll("_", "-")}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function routeColor(
  model: OriginDestinationModel,
  cell: OriginDestinationCell,
): string {
  const originIndex = model.origins.findIndex(
    (origin) => origin.id === cell.origin.id,
  );
  return ROUTE_COLORS[
    Math.max(0, originIndex) % ROUTE_COLORS.length
  ]!;
}

export function originDestinationRankedOption(
  model: OriginDestinationModel,
  snapshot: OriginDestinationSnapshot,
  displayUnit: DisplayUnitId,
  monthlyAverageRate = false,
  limit = 8,
): EChartsOption {
  const rows = rankOriginDestinationRoutes(snapshot, limit);
  return {
    animationDuration: 250,
    aria: {
      enabled: true,
      description:
        `Largest exact ${model.modeLabel.toLowerCase()} routes for ${model.productLabel} in ${formatPeriod(snapshot.period)}. Values are source-published routes, not net flows.`,
    },
    grid: { left: 168, right: 26, top: 12, bottom: 42 },
    tooltip: {
      trigger: "item",
      confine: true,
      backgroundColor: "rgba(11, 49, 59, 0.97)",
      borderWidth: 0,
      textStyle: { color: "#e9f1f2", fontSize: 11 },
      formatter: (params: unknown) => {
        if (
          typeof params !== "object"
          || params === null
          || !("dataIndex" in params)
        ) {
          return "";
        }
        const row = rows[(params as { dataIndex: number }).dataIndex];
        if (!row) return "";
        return `<div class="echarts-tooltip"><strong>${escapeHtml(row.origin.label)} → ${escapeHtml(row.destination.label)}</strong>`
          + `<div class="echarts-tooltip-row"><span>Published movement</span><b>${escapeHtml(displayValue(row.value, row.period, model.sourceUnit, displayUnit, monthlyAverageRate))}</b></div>`
          + `<small>${escapeHtml(STATUS_LABELS[row.status])} · ${escapeHtml(formatPeriod(row.period))}</small></div>`;
      },
    },
    xAxis: {
      type: "value",
      name: compactUnit(displayUnit),
      nameLocation: "middle",
      nameGap: 28,
      nameTextStyle: { color: "#71858a", fontSize: 10, fontWeight: 700 },
      axisLabel: {
        color: "#71858a",
        fontSize: 10,
        formatter: (value: number) => new Intl.NumberFormat("en-US", {
          notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
          maximumFractionDigits: 1,
        }).format(value),
      },
      splitLine: { lineStyle: { color: "#e3eae8" } },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: rows.map(
        (row) => `${row.origin.shortLabel ?? row.origin.label} → ${row.destination.shortLabel ?? row.destination.label}`,
      ),
      axisLine: { lineStyle: { color: "#b9cbc6" } },
      axisTick: { show: false },
      axisLabel: {
        color: "#526b71",
        fontSize: 10,
        width: 154,
        overflow: "truncate",
      },
    },
    series: [{
      name: "Published route",
      type: "bar",
      barMaxWidth: 28,
      data: rows.map((row) => ({
        value: displayNumber(
          row.value,
          row.period,
          model.sourceUnit,
          displayUnit,
          monthlyAverageRate,
        ),
        itemStyle: { color: routeColor(model, row) },
      })),
    }],
  };
}

function RankedRouteCanvas({
  option,
  routeCount,
  ariaLabel,
}: {
  option: EChartsOption;
  routeCount: number;
  ariaLabel: string;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!container) return;
    const chart = echarts.init(container, undefined, { renderer: "canvas" });
    chart.setOption(option);
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => chart.resize());
    observer?.observe(container);
    return () => {
      observer?.disconnect();
      chart.dispose();
    };
  }, [container, option]);
  return (
    <div
      ref={setContainer}
      className="od-ranked-chart"
      style={{ height: `${Math.max(230, routeCount * 34 + 58)}px` }}
      role="img"
      aria-label={ariaLabel}
    />
  );
}

function filterExists(
  value: string,
  choices: readonly { id: string }[],
): boolean {
  return value === "" || choices.some((choice) => choice.id === value);
}

export function OriginDestinationPanel({
  model,
  displayUnit,
  monthlyAverageRate = false,
  initialPeriod,
  initialOriginId,
  initialDestinationId,
  highlightedRouteId,
  title,
  description,
  sourceDisclosure,
  rankedRouteLimit = 8,
  onRouteSelect,
}: OriginDestinationPanelProps) {
  const headingId = useId();
  const [period, setPeriod] = useState(
    model.periods.includes(initialPeriod ?? "")
      ? initialPeriod!
      : model.latestPeriod,
  );
  const [originId, setOriginId] = useState(
    initialOriginId && model.origins.some((origin) => origin.id === initialOriginId)
      ? initialOriginId
      : "",
  );
  const [destinationId, setDestinationId] = useState(
    initialDestinationId
      && model.destinations.some(
        (destination) => destination.id === initialDestinationId,
      )
      ? initialDestinationId
      : "",
  );
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(
    highlightedRouteId ?? null,
  );

  useEffect(() => {
    if (!model.periods.includes(period)) setPeriod(model.latestPeriod);
  }, [model.latestPeriod, model.periods, period]);
  useEffect(() => {
    if (!filterExists(originId, model.origins)) setOriginId("");
  }, [model.origins, originId]);
  useEffect(() => {
    if (!filterExists(destinationId, model.destinations)) setDestinationId("");
  }, [destinationId, model.destinations]);
  useEffect(() => {
    setSelectedRouteId(highlightedRouteId ?? null);
  }, [highlightedRouteId]);

  const snapshot = useMemo(
    () => originDestinationSnapshot(
      model,
      model.periods.includes(period) ? period : model.latestPeriod,
    ),
    [model, period],
  );
  const filtered = useMemo(
    () => filterOriginDestinationSnapshot(snapshot, {
      originId: originId || null,
      destinationId: destinationId || null,
    }),
    [destinationId, originId, snapshot],
  );
  const ranked = useMemo(
    () => rankOriginDestinationRoutes(filtered, rankedRouteLimit),
    [filtered, rankedRouteLimit],
  );
  const rankedOption = useMemo(
    () => originDestinationRankedOption(
      model,
      filtered,
      displayUnit,
      monthlyAverageRate,
      rankedRouteLimit,
    ),
    [displayUnit, filtered, model, monthlyAverageRate, rankedRouteLimit],
  );
  const selectedCell = selectedRouteId
    ? snapshot.cells.find((cell) => cell.routeId === selectedRouteId)
    : undefined;
  const maximumDisplayedValue = displayNumber(
    filtered.maximumAbsoluteValue,
    filtered.period,
    model.sourceUnit,
    displayUnit,
    monthlyAverageRate,
  ) ?? 0;

  const chooseCell = (cell: OriginDestinationCell) => {
    if (!cell.routeId) return;
    setSelectedRouteId(cell.routeId);
    onRouteSelect?.(cell);
  };
  const panelTitle = title ?? model.title;
  const panelDescription = description ?? model.description
    ?? "Rows are shipping origins and columns are receiving destinations. Every cell is one exact source-published route.";

  return (
    <section
      className="analysis-panel od-panel"
      aria-labelledby={headingId}
    >
      <div className="analysis-panel-heading od-panel-heading">
        <div>
          <p className="section-kicker">Origin–destination flows</p>
          <h2 id={headingId}>{panelTitle}</h2>
          <p>{panelDescription}</p>
        </div>
        <div className="contribution-period-badge">
          <span>Displayed source period</span>
          <strong>{formatPeriod(snapshot.period)}</strong>
        </div>
      </div>

      <div className="od-controls" aria-label="Origin-destination view controls">
        <label>
          <span>Source period</span>
          <select value={snapshot.period} onChange={(event) => setPeriod(event.target.value)}>
            {[...model.periods].reverse().map((candidate) => (
              <option key={candidate} value={candidate}>
                {formatPeriod(candidate)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>From shipping origin</span>
          <select value={originId} onChange={(event) => setOriginId(event.target.value)}>
            <option value="">All published origins</option>
            {model.origins.map((origin) => (
              <option key={origin.id} value={origin.id}>{origin.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>To receiving destination</span>
          <select
            value={destinationId}
            onChange={(event) => setDestinationId(event.target.value)}
          >
            <option value="">All published destinations</option>
            {model.destinations.map((destination) => (
              <option key={destination.id} value={destination.id}>
                {destination.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="od-summary" role="status">
        <span>
          <strong>{filtered.numericRouteCount}</strong> numeric routes
        </span>
        <span>
          <strong>{filtered.nonnumericRouteCount}</strong> declared routes without a numeric value
        </span>
        <span>{model.productLabel} · {model.modeLabel} · {compactUnit(displayUnit)}</span>
      </div>

      <div className="od-matrix-scroll" tabIndex={0} aria-label="Scrollable origin-destination matrix">
        <table className="od-matrix">
          <caption>
            {model.productLabel}, {model.modeLabel}, {formatPeriod(snapshot.period)}.
            Rows are shipping origins; columns are receiving destinations.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="od-corner-cell">
                <span>From ↓</span>
                <span>To →</span>
              </th>
              {filtered.destinations.map((destination) => (
                <th scope="col" key={destination.id}>
                  {destination.shortLabel ?? destination.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.origins.map((origin) => (
              <tr key={origin.id}>
                <th scope="row">{origin.shortLabel ?? origin.label}</th>
                {filtered.destinations.map((destination) => {
                  const cell = filtered.cells.find(
                    (candidate) => (
                      candidate.origin.id === origin.id
                      && candidate.destination.id === destination.id
                    ),
                  )!;
                  const converted = displayNumber(
                    cell.value,
                    cell.period,
                    model.sourceUnit,
                    displayUnit,
                    monthlyAverageRate,
                  );
                  const intensity = converted === null || maximumDisplayedValue === 0
                    ? 0
                    : Math.min(1, Math.abs(converted) / Math.abs(maximumDisplayedValue));
                  const active = cell.routeId !== null
                    && cell.routeId === selectedRouteId;
                  const content = (
                    <>
                      <strong>{cellValueLabel(
                        cell,
                        model.sourceUnit,
                        displayUnit,
                        monthlyAverageRate,
                      )}</strong>
                      {cell.value !== null && STATUS_CODES[cell.status] ? (
                        <small>{STATUS_CODES[cell.status]}</small>
                      ) : null}
                    </>
                  );
                  return (
                    <td
                      key={destination.id}
                      className={[
                        "od-matrix-cell",
                        statusClass(cell.status),
                        cell.value !== null ? "od-numeric-cell" : "od-nonnumeric-cell",
                        intensity > 0.58 ? "od-high-intensity" : "",
                        active ? "od-selected-cell" : "",
                      ].filter(Boolean).join(" ")}
                      style={{ "--od-intensity": intensity } as CSSProperties}
                    >
                      {cell.routeId ? (
                        <button
                          type="button"
                          aria-label={cellAccessibleLabel(
                            cell,
                            model.sourceUnit,
                            displayUnit,
                            monthlyAverageRate,
                          )}
                          aria-pressed={active}
                          onClick={() => chooseCell(cell)}
                        >
                          {content}
                        </button>
                      ) : (
                        <span
                          role="img"
                          aria-label={cellAccessibleLabel(
                            cell,
                            model.sourceUnit,
                            displayUnit,
                            monthlyAverageRate,
                          )}
                        >
                          {content}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="od-status-legend" aria-label="Matrix publication status legend">
        <span><i className="od-legend-numeric" /> Numeric published value</span>
        <span><b>M</b> Missing</span>
        <span><b>S</b> Suppressed or withheld</span>
        <span><b>N/A</b> Not available</span>
        <span><b>N/P</b> Not applicable</span>
        <span><b>—</b> No published route fact</span>
      </div>

      {selectedCell ? (
        <div className="od-selected-route" aria-live="polite">
          <span>Selected exact route</span>
          <strong>{selectedCell.origin.label} → {selectedCell.destination.label}</strong>
          <small>
            {displayValue(
              selectedCell.value,
              selectedCell.period,
              model.sourceUnit,
              displayUnit,
              monthlyAverageRate,
            )} · {STATUS_LABELS[selectedCell.status]} · {formatPeriod(selectedCell.period)}
          </small>
        </div>
      ) : null}

      <div className="od-ranked-heading">
        <div>
          <p className="section-kicker">Ranked exact routes</p>
          <h3>Largest movements in this view</h3>
        </div>
        <small>Gross directions are not netted.</small>
      </div>
      {ranked.length ? (
        <RankedRouteCanvas
          option={rankedOption}
          routeCount={ranked.length}
          ariaLabel={`Largest ${model.modeLabel.toLowerCase()} routes for ${model.productLabel} in ${formatPeriod(snapshot.period)}.`}
        />
      ) : (
        <p className="od-empty-note" role="status">
          No numeric route value is published for these filters and this exact source period.
        </p>
      )}

      <details className="accessible-chart-summary od-detail-table">
        <summary>Exact route values and publication status</summary>
        <div className="forecast-table-wrap">
          <table>
            <caption>
              {formatPeriod(snapshot.period)} · {compactUnit(displayUnit)} · exact-period route observations
            </caption>
            <thead>
              <tr>
                <th scope="col">Shipping origin</th>
                <th scope="col">Receiving destination</th>
                <th scope="col">Published movement</th>
                <th scope="col">Publication status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.cells.map((cell) => (
                <tr key={`${cell.origin.id}-${cell.destination.id}`}>
                  <th scope="row">{cell.origin.label}</th>
                  <td>{cell.destination.label}</td>
                  <td>{displayValue(
                    cell.value,
                    cell.period,
                    model.sourceUnit,
                    displayUnit,
                    monthlyAverageRate,
                  )}</td>
                  <td>{STATUS_LABELS[cell.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <p className="chart-footnote">
        Each matrix cell is one directional source observation; opposite directions are not
        netted, and diagonal cells are same-region movements. Missing, suppressed, unavailable,
        and unpublished facts remain distinct from numeric zero. {model.sourceNote}
        {sourceDisclosure ? ` ${sourceDisclosure}` : ""}
        {monthlyAverageRate
          ? " The kb/d view divides each monthly volume by that period's exact calendar-day count; source observations remain unchanged."
          : ""}
      </p>
    </section>
  );
}
