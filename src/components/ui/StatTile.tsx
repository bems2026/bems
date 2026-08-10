import type { ReactNode } from 'react';
import { MetricValue } from './MetricValue';

interface StatTileProps {
  label: string;
  value: number | string | null | undefined;
  unit?: string;
  digits?: number;
  /** Emoji or glyph shown in the tinted leading chip. */
  icon?: string;
  /** Right-aligned slot in the header — typically a `<Badge>`. */
  badge?: ReactNode;
  muted?: boolean;
}

/** A KPI tile: icon chip + label on top, large tabular number beneath. */
export function StatTile({ label, value, unit, digits, icon, badge, muted }: StatTileProps) {
  return (
    <div className="stat-tile">
      <div className="stat-tile__head">
        {icon && (
          <span className="stat-tile__icon" aria-hidden="true">
            {icon}
          </span>
        )}
        <span className="metric-label">{label}</span>
        {badge && <span style={{ marginLeft: 'auto' }}>{badge}</span>}
      </div>
      <MetricValue value={value} unit={unit} digits={digits} muted={muted} />
    </div>
  );
}
