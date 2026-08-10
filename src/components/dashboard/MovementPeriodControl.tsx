import { formatPeriod } from "../../lib/formatters";

interface MovementPeriodControlProps {
  periods: readonly string[];
  value: string;
  onChange: (period: string) => void;
}

export function MovementPeriodControl({
  periods,
  value,
  onChange,
}: MovementPeriodControlProps) {
  return (
    <label className="movement-period-control">
      <span>Source period</span>
      <select
        aria-label="Movement source period"
        title="Choose a historical source period"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {[...periods].reverse().map((period) => (
          <option key={period} value={period}>
            {formatPeriod(period)}
          </option>
        ))}
      </select>
    </label>
  );
}
