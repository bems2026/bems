/**
 * A row of mutually exclusive toggle pills — one pressed at a time.
 *
 * The same `aria-pressed` pattern the Analytics scope buttons and the Automation filter chips already
 * use inline, extracted because the aircon panel needs it twice (mode and fan) and a third inline copy
 * is how the touch-target rule gets missed on one of them. A native radio group was considered and not
 * used: these are commands' parts, not form fields, and a pressed button reads as the choice on a
 * kiosk without a focus ring to hint at it.
 */
export interface PillOption<T extends string> {
  value: T;
  label: string;
}

export function PillGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: PillOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="pill-group" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`pill-group__pill${o.value === value ? ' pill-group__pill--active' : ''}`}
          aria-pressed={o.value === value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
