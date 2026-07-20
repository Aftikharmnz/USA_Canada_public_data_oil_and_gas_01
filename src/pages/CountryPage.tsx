import { useState } from "react";
import { GeographyFilter } from "../components/GeographyFilter";
import { PhasePlaceholder } from "../components/PhasePlaceholder";
import type { CountryCatalog, GeographySelection } from "../types/catalog";

interface CountryPageProps {
  catalog: CountryCatalog;
}

export function CountryPage({ catalog }: CountryPageProps) {
  const [metricId, setMetricId] = useState(catalog.metrics[0]?.id ?? "");
  const [selection, setSelection] = useState<GeographySelection | null>(null);
  const metric = catalog.metrics.find((candidate) => candidate.id === metricId) ?? catalog.metrics[0];

  if (!metric) {
    return <p>Catalog metadata is not available.</p>;
  }

  return (
    <main id="main-content" className="page-shell">
      <section className="country-hero" aria-labelledby={`${catalog.code}-title`}>
        <div className="hero-copy">
          <p className="eyebrow">{catalog.eyebrow}</p>
          <h1 id={`${catalog.code}-title`}>{catalog.name} energy market monitor</h1>
          <p className="hero-summary">{catalog.overview}</p>
        </div>
        <aside className="source-card" aria-label="Planned source coverage">
          <span>Source architecture</span>
          <strong>{catalog.sourceSummary}</strong>
          <p>Automated ingestion, revision history, and freshness checks arrive after this foundation.</p>
        </aside>
      </section>

      <GeographyFilter
        catalog={catalog}
        metricId={metric.id}
        onMetricChange={setMetricId}
        onSelectionChange={setSelection}
      />

      <PhasePlaceholder metric={metric} selection={selection} />

      <section className="catalog-section" aria-labelledby={`${catalog.code}-catalog-title`}>
        <div className="section-heading">
          <div>
            <p className="section-kicker">Coverage contract</p>
            <h2 id={`${catalog.code}-catalog-title`}>Initial metric catalog</h2>
          </div>
          <p>Every metric declares its own smallest valid geography.</p>
        </div>
        <div className="metric-grid">
          {catalog.metrics.map((catalogMetric) => {
            const finest = catalog.geographyLevels.find(
              (level) => level.id === catalogMetric.geographyLevelIds[0],
            );
            return (
              <article className="metric-card" key={catalogMetric.id}>
                <div className="metric-meta">
                  <span>{catalogMetric.category}</span>
                  <span>{catalogMetric.frequency}</span>
                </div>
                <h3>{catalogMetric.title}</h3>
                <p>{catalogMetric.description}</p>
                <dl>
                  <div>
                    <dt>Smallest geography</dt>
                    <dd>{finest?.label ?? "Not specified"}</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{catalogMetric.sourceLabel}</dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
