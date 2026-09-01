/**
 * Load-shed tiers, in one place an operator can actually work in — RM-006c.
 *
 * WHY THIS EXISTS. The whole shed path has been built, tested and audited for weeks and sheds
 * nothing, because no device carries a tier. The only way to set one was the per-device metadata
 * editor: open a device, find one field among seven, save, repeat twenty times, with no view of
 * what the tiers add up to. `ROADMAP.md` calls this "the largest finished feature that does
 * nothing yet, and it is one decision" — a decision nobody could see the shape of.
 *
 * IT SHOWS THE THREE CONDITIONS `server/shedPlan.mjs` ACTUALLY APPLIES, not just the tier. A
 * device is switched only if it is assigned to a tier, has a real dispatch path, AND is on. An
 * editor that showed only the first would let somebody assign tiers to a fleet that cannot be
 * commanded and believe the building was protected. `inertCount` is that gap, named.
 *
 * IT REFUSES TO OFFER A TIER FOR A DEVICE THAT CANNOT BE SHED, and says why instead. The aircon
 * is the single largest controllable load in this building at 33% of demand, and it has no relay
 * — it is IR-commanded and the compressor is deliberately never power-cut. Leaving it silently
 * out of the list would read as an oversight; leaving it in would be a lie.
 *
 * IT IS HONEST ABOUT WHAT SHEDDING CAN REACH HERE. `npm run shed:profile` measured 919 W of
 * office-hours demand, of which everything a relay can switch is 29 W. That does not make tiers
 * pointless — a tier is PERMISSION, not size, and an outlet averaging 1 W is 400 W the afternoon
 * somebody plugs a kettle in — but somebody planning around auto-shed should meet that number
 * here rather than after a breach.
 */
import { useMemo } from 'react';
import { Zap } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { InfoHint } from '@/components/ui/InfoHint';
import { useDeviceStore } from '@/stores/deviceStore';
import { useDeviceConfigStore } from '@/stores/deviceConfigStore';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';
import { LOAD_SHED_OPTIONS, effectiveConfig, resolveDisplayName, type LoadShedGroup } from '@/lib/deviceConfig';
import { summariseShed, SHED_ORDER } from '@/lib/shedTiers';

const TIER_LABEL: Record<LoadShedGroup | 'unassigned', string> = {
  group_1: 'Group 1 — sheds first',
  group_2: 'Group 2',
  group_3: 'Group 3 — sheds last',
  never: 'Protected — never shed',
  unassigned: 'Not classified',
};

export function LoadShedPanel({ onClose }: { onClose?: () => void }) {
  const devices = useDeviceStore((s) => s.devices);
  const readings = useDeviceStore((s) => s.latestReadings);
  const saved = useDeviceConfigStore((s) => s.saved);
  const draft = useDeviceConfigStore((s) => s.draft);
  const setDraftField = useDeviceConfigStore((s) => s.setDraftField);
  const save = useDeviceConfigStore((s) => s.save);
  const saveError = useDeviceConfigStore((s) => s.saveError);
  const dispatchClasses = useCapabilitiesStore((s) => s.dispatchClasses);

  const summary = useMemo(
    () => summariseShed(devices, (id) => effectiveConfig(draft, saved, id).loadShedGroup, readings, dispatchClasses),
    [devices, draft, saved, readings, dispatchClasses],
  );

  /** Set and save in one step. A tier is a single choice from a fixed list, not a field somebody
   * is part-way through typing, so staging it behind a Save button would only create a state
   * where the panel shows one thing and the shedder would do another. */
  const setTier = (deviceId: string, value: string) => {
    setDraftField(deviceId, 'loadShedGroup', value);
    void save(deviceId);
  };

  return (
    <Card className="shed-panel">
      <div className="shed-panel__head">
        <h2 className="card-title">
          <Zap size={16} className="title-icon" aria-hidden="true" />
          Load-shed tiers
          <InfoHint label="What a tier does">
            When the building goes over its limit and auto-shed is on, the system switches off
            <strong> one tier at a time</strong> — Group 1 first — re-measures, and only escalates
            if still over. It <strong>never switches anything back on</strong>: restoring load
            unattended is not recoverable by a person, so that is deliberately manual.
          </InfoHint>
        </h2>
        {onClose && (
          <button type="button" className="shed-panel__close" onClick={onClose}>
            Close
          </button>
        )}
      </div>

      <p className="shed-panel__lede">
        A tier is <strong>permission, not size</strong> — it says this load may be dropped, not
        that it is large. An outlet averaging a watt is four hundred the afternoon somebody plugs
        a kettle into it. Nothing without a tier is ever shed: an unclassified device is not a
        volunteer.
      </p>

      {saveError && (
        <p className="shed-panel__error" role="alert">
          {saveError}
        </p>
      )}

      {/* FOUR TILES, NOT FIVE. Every tier here is a decision somebody made — including "never",
          which is a deliberate exemption. "Not classified" is the absence of a decision, and
          rendering it as a fifth identical tile both said it was a tier and left it orphaned on
          its own row when four fitted across. It gets its own line below, which is what it is. */}
      <div className="shed-panel__tally">
        {[...SHED_ORDER, 'never' as const].map((tier) => (
          <div key={tier} className="shed-panel__tally-item">
            <span className="metric-label">{TIER_LABEL[tier]}</span>
            <span className="shed-panel__tally-count">{summary.byTier[tier].total}</span>
            {/* "Would act" is the honest count: assigned, dispatchable and on. The difference
                from the total is not a rounding error, it is the part that would do nothing. */}
            {tier !== 'never' && summary.byTier[tier].total > 0 && (
              <span className="shed-panel__tally-sub">{summary.byTier[tier].effective} would act now</span>
            )}
          </div>
        ))}
      </div>

      <p className="shed-panel__unassigned">
        <span className="shed-panel__unassigned-count">{summary.byTier.unassigned.total}</span>
        <span>
          {TIER_LABEL.unassigned}
          {summary.byTier.unassigned.total > 0 && ' — an unclassified device is never shed, so these are not volunteers'}
        </span>
      </p>

      {summary.inertCount > 0 && (
        <p className="shed-panel__warn" role="status">
          {summary.inertCount} device{summary.inertCount === 1 ? ' has' : 's have'} a tier but no
          dispatch path right now, so shedding would not reach {summary.inertCount === 1 ? 'it' : 'them'}.
          The tier is saved and will work once the bridge reports that class as commandable.
        </p>
      )}

      {/* MEASURED 2026-09-01 at 1920px: this table ran to 1104px against 406px for the other two
          cards in the column, leaving the Automation page 494px ragged down its left-hand side.
          The tier counts above are the summary; the per-device rows are a lookup, and a lookup
          is the right thing to put behind a scroll. The header stays pinned so a row scrolled
          into view still says which column is which. */}
      <div className="shed-panel__table-scroll" tabIndex={0} role="region" aria-label="Device load-shed tiers">
      <table className="shed-panel__table">
        <thead>
          <tr>
            <th scope="col">Device</th>
            <th scope="col">Now</th>
            <th scope="col">Tier</th>
          </tr>
        </thead>
        <tbody>
          {summary.rows.map((row) => (
            <tr key={row.device.id}>
              <td>
                <span className="shed-panel__name">{resolveDisplayName(row.device, saved[row.device.id])}</span>
                <span className="shed-panel__id mono">{row.device.id}</span>
              </td>
              <td>
                <span className={`shed-panel__state${row.on ? ' shed-panel__state--on' : ''}`}>
                  {row.on ? 'on' : 'off'}
                </span>
                {!row.dispatchable && <span className="shed-panel__inert">not commandable</span>}
              </td>
              <td>
                <label className="sr-only" htmlFor={`shed-${row.device.id}`}>
                  Load-shed tier for {resolveDisplayName(row.device, saved[row.device.id])}
                </label>
                <select
                  id={`shed-${row.device.id}`}
                  className="shed-panel__select"
                  value={row.tier ?? ''}
                  onChange={(e) => setTier(row.device.id, e.target.value)}
                >
                  <option value="">Not classified</option>
                  {LOAD_SHED_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {summary.rows.length === 0 && (
        <p className="shed-panel__note">No relay-controlled devices at this site, so there is nothing to shed.</p>
      )}

      {summary.excluded.length > 0 && (
        <details className="shed-panel__excluded">
          <summary>{summary.excluded.length} devices cannot be shed at all</summary>
          <ul>
            {summary.excluded.map(({ device, reason }) => (
              <li key={device.id}>
                <strong>{resolveDisplayName(device, saved[device.id])}</strong> — {reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

