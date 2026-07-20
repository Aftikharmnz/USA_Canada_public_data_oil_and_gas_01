import type { ReactNode } from "react";

interface CollapsibleToolbarProps {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  collapsed: boolean;
  contentId: string;
  hideLabel?: string;
  onCollapsedChange: (collapsed: boolean) => void;
  showLabel?: string;
  summary: ReactNode;
  summaryLabel?: string;
}

export function CollapsibleToolbar({
  ariaLabel,
  children,
  className,
  collapsed,
  contentId,
  hideLabel = "Hide filters",
  onCollapsedChange,
  showLabel = "Show filters",
  summary,
  summaryLabel = "Current selection",
}: CollapsibleToolbarProps) {
  const classes = ["collapsible-toolbar", className].filter(Boolean).join(" ");

  return (
    <section
      className={classes}
      aria-label={ariaLabel}
      data-collapsed={collapsed ? "true" : "false"}
    >
      <div className="collapsible-toolbar-bar">
        <p className="collapsible-toolbar-summary">
          <span className="collapsible-toolbar-summary-label">{summaryLabel}</span>
          <span className="collapsible-toolbar-summary-value">{summary}</span>
        </p>
        <button
          type="button"
          className="collapsible-toolbar-toggle"
          aria-controls={contentId}
          aria-expanded={!collapsed}
          onClick={() => onCollapsedChange(!collapsed)}
        >
          {collapsed ? showLabel : hideLabel}
        </button>
      </div>

      <div
        id={contentId}
        className="collapsible-toolbar-content"
        hidden={collapsed}
      >
        {children}
      </div>
    </section>
  );
}
