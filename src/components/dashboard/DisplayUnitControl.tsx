import {
  getDisplayUnitOptions,
  getSourceUnitLabel,
  isDisplayUnit,
  type DisplayUnitOption,
  type DisplayUnitId,
} from "../../lib/units";

interface DisplayUnitControlProps {
  sourceUnit: string;
  value: DisplayUnitId;
  onChange: (unit: DisplayUnitId) => void;
  compact?: boolean;
  /** Short chart-edge treatment using trader abbreviations rather than long labels. */
  micro?: boolean;
  /** Prevalidated derived display choices that are not fixed-factor unit conversions. */
  additionalOptions?: readonly DisplayUnitOption[];
  helpText?: string;
}

function optionLabel(option: DisplayUnitOption, micro: boolean): string {
  if (micro) return `${option.compactLabel}${option.isSourceUnit ? " · source" : ""}`;
  const qualifiers = [option.compactLabel, option.isSourceUnit ? "source" : null]
    .filter((value): value is string => Boolean(value));
  return `${option.longLabel} (${qualifiers.join(", ")})`;
}

export function DisplayUnitControl({
  sourceUnit,
  value,
  onChange,
  compact = false,
  micro = false,
  additionalOptions = [],
  helpText,
}: DisplayUnitControlProps) {
  const options = [...getDisplayUnitOptions(sourceUnit)];
  for (const option of additionalOptions) {
    if (!options.some((candidate) => candidate.id === option.id)) options.push(option);
  }
  if (!options.length) return null;
  const fixed = options.length === 1;

  return (
    <fieldset className={`display-unit-control ${compact ? "display-unit-control-compact" : ""} ${micro ? "display-unit-control-micro" : ""}`}>
      <legend>{micro ? "Unit" : "Display unit"}</legend>
      {fixed ? (
        <div className="display-unit-fixed" aria-label={`${options[0]!.longLabel} is fixed`}>
          {micro ? options[0]!.compactLabel : `${options[0]!.longLabel} (fixed)`}
        </div>
      ) : (
        <select
          value={value}
          aria-label="Convert chart values to display unit"
          onChange={(event) => {
            if (isDisplayUnit(event.target.value)) onChange(event.target.value);
          }}
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {optionLabel(option, micro)}
            </option>
          ))}
        </select>
      )}
      {!compact ? (
        <small>{helpText ?? `Display conversion only; source data remain ${getSourceUnitLabel(sourceUnit)}.`}</small>
      ) : null}
    </fieldset>
  );
}
