import { useMemo, useState } from "react";
import {
  filterReferenceGlossary,
  REFERENCE_CONCEPTS,
  REFERENCE_PRODUCT_FAMILIES,
  referenceGlossary,
  type ReferenceConcept,
  type ReferenceFilterValue,
  type ReferenceGlossaryEntry,
  type ReferenceProductFamily,
} from "../data/referenceGlossary";

function familyHeadingId(family: ReferenceProductFamily): string {
  return `family-${family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function DefinitionCard({ entry }: { entry: ReferenceGlossaryEntry }) {
  return (
    <article className="definition-card" id={entry.id}>
      <header className="definition-card-header">
        <div>
          <div className="definition-tags" aria-label={`Classification for ${entry.term}`}>
            <span>{entry.productFamily}</span>
            <span>{entry.concept}</span>
          </div>
          <h3>{entry.term}</h3>
          <p className="definition-aliases">
            <span>Also seen as:</span> {entry.aliases.join(" · ")}
          </p>
        </div>
      </header>

      <p className="definition-plain-language">{entry.plainLanguage}</p>

      <div className="definition-explanations">
        <section aria-labelledby={`${entry.id}-source-definition`}>
          <h4 id={`${entry.id}-source-definition`}>Official definition, in plain language</h4>
          <p>{entry.officialDefinition}</p>
        </section>
        <section aria-labelledby={`${entry.id}-trader-read`}>
          <h4 id={`${entry.id}-trader-read`}>How to read it</h4>
          <p>{entry.traderInterpretation}</p>
        </section>
      </div>

      <dl className="definition-facts">
        <div>
          <dt>Typical unit</dt>
          <dd>{entry.typicalUnit}</dd>
        </div>
        <div>
          <dt>Typical frequency</dt>
          <dd>{entry.typicalFrequency}</dd>
        </div>
        <div>
          <dt>Geography</dt>
          <dd>{entry.geography}</dd>
        </div>
      </dl>

      <div className="definition-boundaries">
        <section aria-labelledby={`${entry.id}-includes`}>
          <h4 id={`${entry.id}-includes`}>Usually includes</h4>
          <ul>
            {entry.inclusions.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
        <section aria-labelledby={`${entry.id}-excludes`}>
          <h4 id={`${entry.id}-excludes`}>Does not mean</h4>
          <ul>
            {entry.exclusions.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      </div>

      <aside className="definition-warning" aria-label={`Aggregation caution for ${entry.term}`}>
        <strong>Aggregation and double-counting caution</strong>
        <p>{entry.aggregationWarning}</p>
      </aside>

      <a
        className="definition-source-link"
        href={entry.source.url}
        target="_blank"
        rel="noreferrer"
      >
        {entry.source.label} <span aria-hidden="true">↗</span>
        <span className="visually-hidden"> (opens in a new tab)</span>
      </a>
    </article>
  );
}

export function ReferencePage() {
  const [query, setQuery] = useState("");
  const [productFamily, setProductFamily] = useState<ReferenceFilterValue<ReferenceProductFamily>>("all");
  const [concept, setConcept] = useState<ReferenceFilterValue<ReferenceConcept>>("all");

  const results = useMemo(
    () => filterReferenceGlossary(referenceGlossary, query, productFamily, concept),
    [concept, productFamily, query],
  );

  const groupedResults = useMemo(
    () => REFERENCE_PRODUCT_FAMILIES
      .map((family) => ({
        family,
        entries: results.filter((entry) => entry.productFamily === family),
      }))
      .filter((group) => group.entries.length > 0),
    [results],
  );

  const hasFilters = query.length > 0 || productFamily !== "all" || concept !== "all";
  const clearFilters = () => {
    setQuery("");
    setProductFamily("all");
    setConcept("all");
  };

  return (
    <main id="main-content" className="page-shell reference-shell">
      <h1 className="visually-hidden">Petroleum market terminology reference</h1>

      <section className="reference-controls" aria-labelledby="reference-search-title">
        <div className="reference-controls-heading">
          <div>
            <p className="section-kicker">Find a definition</p>
            <h2 id="reference-search-title">Search the terminology catalog</h2>
          </div>
          <p className="reference-result-count" aria-live="polite">
            {results.length} {results.length === 1 ? "definition" : "definitions"}
          </p>
        </div>

        <div className="reference-filter-grid">
          <label className="reference-search-field">
            <span>Search term or meaning</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Try implied demand, RBOB, prediction interval, or backtest"
              autoComplete="off"
            />
          </label>

          <label className="reference-select-field">
            <span>Product family</span>
            <select
              value={productFamily}
              onChange={(event) => setProductFamily(event.target.value as ReferenceFilterValue<ReferenceProductFamily>)}
            >
              <option value="all">All product families</option>
              {REFERENCE_PRODUCT_FAMILIES.map((family) => (
                <option key={family} value={family}>{family}</option>
              ))}
            </select>
          </label>

          <label className="reference-select-field">
            <span>Concept</span>
            <select
              value={concept}
              onChange={(event) => setConcept(event.target.value as ReferenceFilterValue<ReferenceConcept>)}
            >
              <option value="all">All concepts</option>
              {REFERENCE_CONCEPTS.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>

          <button
            className="reference-clear-button"
            type="button"
            onClick={clearFilters}
            disabled={!hasFilters}
          >
            Clear filters
          </button>
        </div>
      </section>

      {groupedResults.map((group) => (
        <section className="reference-family-section" key={group.family} aria-labelledby={familyHeadingId(group.family)}>
          <div className="reference-family-heading">
            <h2 id={familyHeadingId(group.family)}>{group.family}</h2>
            <span>{group.entries.length} {group.entries.length === 1 ? "entry" : "entries"}</span>
          </div>
          <div className="definition-grid">
            {group.entries.map((entry) => <DefinitionCard key={entry.id} entry={entry} />)}
          </div>
        </section>
      ))}

      {results.length === 0 ? (
        <section className="reference-empty-state" aria-labelledby="no-reference-results">
          <p className="placeholder-label">No matches</p>
          <h2 id="no-reference-results">Try a broader term or clear a filter.</h2>
          <p>Search aliases such as diesel, RBOB, E0, inventory, imports, or PADD.</p>
          <button type="button" onClick={clearFilters}>Show all definitions</button>
        </section>
      ) : null}
    </main>
  );
}
