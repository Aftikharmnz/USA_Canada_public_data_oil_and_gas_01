export type RegionSelectionMode = "single" | "combined";

export interface SelectableRegion {
  id: string;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
}

interface RegionSelectionControlProps {
  label: string;
  mode: RegionSelectionMode;
  options: readonly SelectableRegion[];
  selectedIds: readonly string[];
  onModeChange: (mode: RegionSelectionMode) => void;
  onSelectionChange: (ids: string[]) => void;
  compact?: boolean;
  idPrefix: string;
  combinedDisabledReason?: string;
}

export function RegionSelectionControl({
  label,
  mode,
  options,
  selectedIds,
  onModeChange,
  onSelectionChange,
  compact = false,
  idPrefix,
  combinedDisabledReason,
}: RegionSelectionControlProps) {
  const selected = new Set(selectedIds);
  const selectedLabels = options.filter((option) => selected.has(option.id)).map((option) => option.label);

  const toggle = (id: string, checked: boolean) => {
    const next = checked
      ? [...selectedIds, id]
      : selectedIds.filter((candidate) => candidate !== id);
    if (!next.length || (mode === "combined" && next.length < 2)) return;
    onSelectionChange([...new Set(next)]);
  };

  return (
    <fieldset className={`region-selection-control ${compact ? "region-selection-control-compact" : ""}`}>
      <legend>{label}</legend>
      <div className="region-mode-toggle" role="group" aria-label={`${label} selection mode`}>
        <button
          type="button"
          aria-pressed={mode === "single"}
          onClick={() => onModeChange("single")}
        >
          Single
        </button>
        <button
          type="button"
          aria-pressed={mode === "combined"}
          disabled={Boolean(combinedDisabledReason)}
          title={combinedDisabledReason}
          onClick={() => onModeChange("combined")}
        >
          Combined
        </button>
      </div>

      {mode === "single" ? (
        <select
          id={`${idPrefix}-single-region`}
          value={selectedIds[0] ?? ""}
          aria-label={label}
          onChange={(event) => onSelectionChange([event.target.value])}
        >
          {options.map((option) => (
            <option key={option.id} value={option.id} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <details className="region-checkbox-picker">
          <summary>
            {selectedLabels.length >= 2
              ? `${selectedLabels.length} regions · ${selectedLabels.join(" + ")}`
              : "Select at least two regions"}
          </summary>
          <div className="region-checkbox-list" role="group" aria-label={`Regions to combine for ${label}`}>
            {options.map((option) => {
              const checked = selected.has(option.id);
              const disabled = option.disabled && !checked;
              return (
                <label key={option.id} title={disabled ? option.disabledReason : undefined}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={(event) => toggle(option.id, event.target.checked)}
                  />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>
        </details>
      )}
      {!compact && mode === "combined" ? (
        <small>Only compatible, non-overlapping regions at this geography level can be combined.</small>
      ) : null}
    </fieldset>
  );
}
