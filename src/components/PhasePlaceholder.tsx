import type { GeographySelection, MetricDefinition } from "../types/catalog";

interface PhasePlaceholderProps {
  metric: MetricDefinition;
  selection: GeographySelection | null;
}

export function PhasePlaceholder({ metric, selection }: PhasePlaceholderProps) {
  return (
    <section className="workspace-card" aria-labelledby="workspace-title">
      <div className="workspace-heading">
        <div>
          <p className="section-kicker">Phase 1 foundation</p>
          <h2 id="workspace-title">Analysis workspace</h2>
        </div>
        <span className="catalog-badge">Illustrative catalog · no live values</span>
      </div>

      <div className="selection-summary" aria-live="polite">
        <span>Selected view</span>
        <strong>
          {selection
            ? `${selection.metricTitle} · ${selection.regionLabel} · ${selection.levelLabel} · ${selection.origin === "computed-rollup" ? "computed rollup" : "source-published"}`
            : metric.title}
        </strong>
      </div>

      <div className="placeholder-grid">
        <article className="placeholder-panel placeholder-panel-wide">
          <div className="placeholder-copy">
            <p className="placeholder-label">Seasonal history</p>
            <h3>Interactive chart surface reserved</h3>
            <p>
              The data phase will add three recent years, a historical range, median and percentile
              bands, hover values, and explicit release freshness here.
            </p>
          </div>
          <div className="chart-skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        </article>

        <article className="placeholder-panel">
          <p className="placeholder-label">Latest release</p>
          <h3>Freshness and deltas</h3>
          <p>Observation date, retrieval time, prior-period change, and revision status will live here.</p>
        </article>

        <article className="placeholder-panel">
          <p className="placeholder-label">Distribution</p>
          <h3>Statistical diagnostics</h3>
          <p>Levels, changes, percentiles, volatility, and candidate distribution fit will live here.</p>
        </article>
      </div>
    </section>
  );
}
