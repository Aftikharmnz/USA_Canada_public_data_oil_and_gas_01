import {
  useId,
  useState,
  type ReactNode,
} from "react";

export interface ChartDetailsToggleProps {
  children: ReactNode;
  className?: string;
  /** Optional compact context shown beside the disclosure control. */
  summary?: ReactNode;
  /** Primarily useful for pre-expanded embeds; ordinary chart use stays collapsed. */
  defaultExpanded?: boolean;
}

/**
 * Keeps supporting chart diagnostics out of the primary graph surface until a
 * user explicitly asks for them. The controlled region remains mounted so its
 * generated id and any child state stay stable across disclosure changes.
 */
export function ChartDetailsToggle({
  children,
  className,
  summary,
  defaultExpanded = false,
}: ChartDetailsToggleProps) {
  const generatedId = useId();
  const triggerId = `chart-details-trigger-${generatedId}`;
  const contentId = `chart-details-content-${generatedId}`;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const classes = ["chart-details-toggle", className].filter(Boolean).join(" ");

  return (
    <div className={classes} data-expanded={expanded ? "true" : "false"}>
      <div className="chart-details-toggle-bar">
        {summary === undefined ? null : (
          <span className="chart-details-toggle-summary">{summary}</span>
        )}
        <button
          id={triggerId}
          type="button"
          className="chart-details-toggle-button"
          aria-controls={contentId}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Hide details" : "Show details"}
        </button>
      </div>

      <div
        id={contentId}
        className="chart-details-toggle-content"
        role="region"
        aria-labelledby={triggerId}
        hidden={!expanded}
      >
        {children}
      </div>
    </div>
  );
}
