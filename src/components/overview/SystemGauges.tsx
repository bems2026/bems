import { useDeviceStore } from '@/stores/deviceStore';
import { StaleDataBadge } from '@/components/common/StaleDataBadge';

function fmt(value: number | null | undefined, unit: string, digits = 1): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(digits)} ${unit}`;
}

/**
 * Building-level voltage, per-phase current, and total power — from the `_totals` row
 * of `/api/readings/latest` (`docs/bridge-contract.md`).
 *
 * Phase mapping mirrors `Calculate 3-Phase Totals` in the live flow exactly: Red =
 * L.O Red + AREC ACU, Yellow = C.O Yellow + L.O Yellow. Blue is always rendered as
 * "Not metered", never as a number — no Blue-phase meter is installed, and
 * `Calculate 3-Phase Totals` hardcodes `currentBlue = 0`. Showing "0 A" there would
 * misrepresent the building's electrical layout as if it were a real reading of zero.
 */
export function SystemGauges() {
  const totals = useDeviceStore((s) => s.totals);
  const phase = totals?.phase_current;

  return (
    <StaleDataBadge className="gauges-badge-wrap">
      <div className="gauges-grid">
        <GaugeCard label="System Voltage" value={fmt(totals?.avg_voltage, 'V')} />
        <GaugeCard label="Total Power" value={fmt(totals?.total_power_w, 'W', 0)} />
        <GaugeCard label="Phase Red" value={fmt(phase?.red, 'A')} />
        <GaugeCard label="Phase Yellow" value={fmt(phase?.yellow, 'A')} />
        <GaugeCard label="Phase Blue" value="Not metered" muted />
      </div>
    </StaleDataBadge>
  );
}

function GaugeCard({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`gauge-card${muted ? ' gauge-card--muted' : ''}`}>
      <span className="gauge-label">{label}</span>
      <span className="gauge-value">{value}</span>
    </div>
  );
}
