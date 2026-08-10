import { useDeviceStore } from '@/stores/deviceStore';
import { StaleDataBadge } from '@/components/common/StaleDataBadge';

function fmtKwh(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(2)} kWh`;
}

/**
 * Daily/weekly/monthly totals from `bems_energy_today/_week/_month` (the `_totals` row).
 *
 * Known upstream quirk, not a display bug: `Calculate 3-Phase Totals` sums only the four
 * CT branch meters — the seven outlet accumulators aren't included, and aren't reset at
 * midnight either (`docs/bridge-contract.md`). The caption below says so rather than
 * letting the numbers imply a completeness they don't have.
 */
export function EnergyTotals() {
  const totals = useDeviceStore((s) => s.totals);

  return (
    <StaleDataBadge className="energy-badge-wrap">
      <div className="energy-grid">
        <EnergyCard label="Today" value={fmtKwh(totals?.energy_kwh_today)} />
        <EnergyCard label="This Week" value={fmtKwh(totals?.energy_kwh_week)} />
        <EnergyCard label="This Month" value={fmtKwh(totals?.energy_kwh_month)} />
      </div>
      <p className="energy-caption">Branch meters only — individual outlet energy isn't included in these totals.</p>
    </StaleDataBadge>
  );
}

function EnergyCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="energy-card">
      <span className="energy-label">{label}</span>
      <span className="energy-value">{value}</span>
    </div>
  );
}
