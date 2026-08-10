import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface ExpandablePanelProps {
  title: string;
  children: ReactNode;
  className?: string;
}

/**
 * Keeps compact profile cards dense while still offering a large, keyboard-
 * accessible inspection surface. The overlay is used instead of the browser
 * Fullscreen API so it works consistently on GitHub Pages and mobile devices.
 */
export function ExpandablePanel({
  title,
  children,
  className = "",
}: ExpandablePanelProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExpanded(false);
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]):not([hidden]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || !panelRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (triggerRef.current?.isConnected) triggerRef.current.focus();
    };
  }, [expanded]);

  return (
    <article
      ref={panelRef}
      className={`expandable-panel ${expanded ? "is-expanded" : ""} ${className}`.trim()}
      role={expanded ? "dialog" : undefined}
      aria-modal={expanded ? true : undefined}
      aria-labelledby={titleId}
    >
      <h3 id={titleId} className="visually-hidden">{title}</h3>
      <button
        ref={triggerRef}
        type="button"
        className="profile-expand-button"
        aria-label={`Expand ${title}`}
        aria-expanded={expanded}
        onClick={() => setExpanded(true)}
        hidden={expanded}
      >
        <span aria-hidden="true">&#x26F6;</span>
        Expand
      </button>
      {expanded ? (
        <button
          ref={closeRef}
          type="button"
          className="profile-close-button"
          aria-label={`Close expanded ${title}`}
          onClick={() => setExpanded(false)}
        >
          Close
        </button>
      ) : null}
      <div className="expandable-panel-content">{children}</div>
    </article>
  );
}
