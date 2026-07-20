export function DashboardLoading({ label = "Loading validated market data" }: { label?: string }) {
  return (
    <section className="dashboard-state-card" aria-live="polite" aria-busy="true">
      <span className="loading-orbit" aria-hidden="true" />
      <div>
        <p className="section-kicker">Connecting to static assets</p>
        <h2>{label}</h2>
        <p>The dashboard is checking schema, geography availability, and freshness metadata.</p>
      </div>
    </section>
  );
}

export function DashboardError({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <section className="dashboard-state-card dashboard-error" role="alert">
      <span className="state-symbol" aria-hidden="true">!</span>
      <div>
        <p className="section-kicker">Last-known-good protection</p>
        <h2>{title}</h2>
        <p>{message}</p>
        <p>The browser will not invent values or fall back to an incompatible schema.</p>
        <button className="retry-button" type="button" onClick={onRetry}>Try again</button>
      </div>
    </section>
  );
}

export function LastKnownGoodNotice({ error }: { error: string }) {
  return (
    <div className="last-known-good" role="status">
      <strong>Showing the last validated asset from this session.</strong>
      <span>The latest request failed: {error}</span>
    </div>
  );
}
