import { useDeviceStore } from '@/stores/deviceStore';
import { useContextStore } from '@/stores/contextStore';
import { readDsmThresholds, maxPhaseNow, totalKwNow } from '@/lib/dsm';

const MAX_PHASE_KEY = 'global.dsm.max_phase_a';
const MAX_TOTAL_KEY = 'global.dsm.max_total_kw';
const AUTO_SHED_KEY = 'global.dsm.auto_shed';

/** Breach raises Overview's `LoadShedBanner` — but only once these values are actually
 * saved (`LoadShedBanner` reads `saved`, never `draft`). Live readout is real: the same
 * `_totals` reading Overview's Main Panel Health card shows. */
export function DsmThresholdsCard() {
  const totals = useDeviceStore((s) => s.totals);
  const saved = useContextStore((s) => s.saved);
  const draft = useContextStore((s) => s.draft);
  const setDraft = useContextStore((s) => s.setDraft);

  const effective = (key: string) => draft[key] ?? saved[key] ?? '';
  const thresholds = readDsmThresholds({ ...saved, ...draft });
  const phaseNow = maxPhaseNow(totals);
  const kwNow = totalKwNow(totals);

  const phaseBreached = thresholds.maxPhaseA !== null && phaseNow !== null && phaseNow > thresholds.maxPhaseA;
  const powerBreached = thresholds.maxTotalKw !== null && kwNow !== null && kwNow > thresholds.maxTotalKw;
  const autoShedDraftValue = effective(AUTO_SHED_KEY) === 'true';

  return (
    <div className="card automation-dsm-card">
      <h3 className="card-title">DSM Thresholds</h3>
      <p className="card-sub">
        Breach raises the Overview load-shed banner once saved. Live: {phaseNow !== null ? `${phaseNow.toFixed(1)} A` : '—'} max phase,{' '}
        {kwNow !== null ? `${kwNow.toFixed(2)} kW` : '—'} total.
      </p>

      <div className="automation-dsm-field">
        <div className="automation-dsm-field__head">
          <span>MAX PHASE CURRENT (A)</span>
          <span className={phaseBreached ? 'automation-dsm-field__breach' : 'automation-dsm-field__ok'}>{phaseBreached ? 'BREACHED' : 'OK'}</span>
        </div>
        <input
          type="number"
          className="automation-number-input"
          value={effective(MAX_PHASE_KEY)}
          placeholder="not set"
          onChange={(e) => setDraft(MAX_PHASE_KEY, e.target.value)}
        />
      </div>

      <div className="automation-dsm-field">
        <div className="automation-dsm-field__head">
          <span>MAX TOTAL DRAW (kW)</span>
          <span className={powerBreached ? 'automation-dsm-field__breach' : 'automation-dsm-field__ok'}>{powerBreached ? 'BREACHED' : 'OK'}</span>
        </div>
        <input
          type="number"
          className="automation-number-input"
          value={effective(MAX_TOTAL_KEY)}
          placeholder="not set"
          onChange={(e) => setDraft(MAX_TOTAL_KEY, e.target.value)}
        />
      </div>

      <div className="automation-shed-mode">
        <div className="automation-shed-mode__body">
          <p className="automation-shed-mode__title">On breach: {autoShedDraftValue ? 'arm automatic shed' : 'warn and wait for manual override'}</p>
          <p className="automation-shed-mode__sub">Auto-shed is a decision point — confirm before anything cuts power unattended.</p>
        </div>
        <button type="button" className="automation-shed-mode__switch" onClick={() => setDraft(AUTO_SHED_KEY, String(!autoShedDraftValue))}>
          Switch
        </button>
      </div>
    </div>
  );
}
