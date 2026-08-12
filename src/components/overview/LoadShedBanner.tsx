import { useDeviceStore } from '@/stores/deviceStore';
import { useContextStore } from '@/stores/contextStore';
import { readDsmThresholds, checkDsmBreach } from '@/lib/dsm';
import { navigateTo } from '@/lib/useHashRoute';

/**
 * The M2 slot, finally armed by real data: `saved` (not `draft`) DSM thresholds — a banner
 * driven by someone's unsaved Automation edit would be arming itself off a value Node-RED
 * has never actually seen. Renders nothing at all until a threshold is genuinely
 * configured and genuinely exceeded; no placeholder, no sample breach.
 */
export function LoadShedBanner() {
  const totals = useDeviceStore((s) => s.totals);
  const saved = useContextStore((s) => s.saved);
  const thresholds = readDsmThresholds(saved);
  const breach = checkDsmBreach(thresholds, totals);

  if (!breach.breached) return null;

  return (
    <div className="load-shed-banner" role="alert">
      <span aria-hidden="true">⚠</span>
      <div className="load-shed-banner__body">
        <p className="load-shed-banner__title">Load shed warning — DSM threshold breached</p>
        <p className="load-shed-banner__detail">
          {breach.reason} {thresholds.autoShed ? 'Auto-shed is armed.' : 'Warning only — no automatic shed.'}
        </p>
      </div>
      <div className="load-shed-banner__actions">
        <button type="button" className="load-shed-banner__btn load-shed-banner__btn--ghost" onClick={() => navigateTo('automation')}>
          Review thresholds
        </button>
        <button type="button" className="load-shed-banner__btn load-shed-banner__btn--solid" onClick={() => navigateTo('control')}>
          Master overrides
        </button>
      </div>
    </div>
  );
}
