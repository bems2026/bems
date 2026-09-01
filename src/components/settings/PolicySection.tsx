/**
 * The building's operating rules — RM-038. Today that means one: the aircon setpoint floor.
 *
 * WHY THIS EXISTS. The floor comes from the university's energy-efficiency policy, and a
 * university policy changes. It used to live only in `shared/sites/<id>/site.mjs`, compiled into
 * both the browser bundle and the proxy, so revising an administrative decision meant editing a
 * source file, rebuilding and redeploying — a code change standing in for a signature.
 *
 * THE NUMBER SHOWN IS THE ONE IN FORCE, not the one stored. It comes from `/api/capabilities`,
 * which reports what the proxy will actually validate the next command against — including when
 * the proxy has fallen back to its build value because the database was unreachable. Showing the
 * stored value during an outage would be showing a rule that is not currently being applied.
 *
 * EMPTY IS A REAL CHOICE and is not zero. It means "no policy floor — the hardware bound alone
 * applies", which is different from a floor of 16 that happens to coincide with the hardware
 * minimum today.
 */
import { useState } from 'react';
import { Thermometer } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { InfoHint } from '@/components/ui/InfoHint';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';
import { useAuthStore } from '@/stores/authStore';
import { setAcuMinSetpoint, FLOOR_MIN_C, FLOOR_MAX_C, isValidFloor } from '@/lib/supabasePolicy';
import { supabase } from '@/config/supabase';

export function PolicySection() {
  const inForce = useCapabilitiesStore((s) => s.acuMinSetpointC);
  const source = useCapabilitiesStore((s) => s.policySource);
  const refresh = useCapabilitiesStore((s) => s.load);
  const mode = useAuthStore((s) => s.mode);

  /**
   * `null` means "nobody has typed", and the field then FOLLOWS the floor in force. So when
   * another operator changes it, this screen tracks them instead of sitting on a stale number
   * that would overwrite their change on save.
   *
   * Derived at render rather than synced by an effect: an effect would set state during commit
   * and cascade a second render for a value that is just a function of two others.
   */
  const [typed, setTyped] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  const live = inForce === null ? '' : String(inForce);
  const draft = typed ?? live;

  // A break-glass session has no Supabase identity, so the function's `auth.uid()` would be null
  // and the change unattributable. `handleCommand` refuses those sessions for the same reason.
  const canEdit = supabase !== null && mode === 'supabase';

  const parsed = draft.trim() === '' ? null : Number(draft);
  const valid = draft.trim() === '' || (Number.isFinite(parsed) && isValidFloor(parsed as number));
  const changed = live !== draft.trim();

  const save = async () => {
    setStatus('saving');
    setError(null);
    try {
      await setAcuMinSetpoint(parsed as number | null);
      // Re-read rather than trusting the write: what matters is the floor the PROXY now applies,
      // and that is a different process reading a cache with its own refresh interval.
      await refresh();
      // Back to following the live value, so the field shows what the bridge now reports rather
      // than what was typed at it.
      setTyped(null);
      setStatus('saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The change could not be saved.');
      setStatus('idle');
    }
  };

  return (
    <Card className="settings-card">
      <h2 className="card-title">
        <Thermometer size={16} className="title-icon" aria-hidden="true" />
        Building policy
        <InfoHint label="What a policy floor does">
          The floor is the coldest aircon setpoint this building permits. It is enforced by the
          bridge, not by this page — a request below it is refused server-side, so a command that
          never went through this dashboard is refused too. It can only ever <strong>narrow</strong>{' '}
          the range the hardware supports ({FLOOR_MIN_C}–{FLOOR_MAX_C} °C), never widen it.
        </InfoHint>
      </h2>

      <div className="policy-field">
        <label className="policy-field__label" htmlFor="policy-acu-floor">
          Coldest aircon setpoint allowed
        </label>
        <div className="policy-field__row">
          <input
            id="policy-acu-floor"
            className="policy-field__input"
            type="number"
            inputMode="numeric"
            min={FLOOR_MIN_C}
            max={FLOOR_MAX_C}
            step={1}
            placeholder="none"
            value={draft}
            disabled={!canEdit}
            onChange={(e) => {
              setTyped(e.target.value);
              setStatus('idle');
              setError(null);
            }}
          />
          <span className="policy-field__unit">°C</span>
          <button
            type="button"
            className="space-plan__btn"
            disabled={!canEdit || !valid || !changed || status === 'saving'}
            onClick={() => void save()}
          >
            {status === 'saving' ? 'Saving…' : 'Save'}
          </button>
          {status === 'saved' && !changed && (
            <span className="policy-field__ok" role="status">
              Saved — the bridge is applying it
            </span>
          )}
        </div>

        <p className="policy-field__hint">
          Leave it empty for no policy floor, which is not the same as {FLOOR_MIN_C} °C: it means
          the hardware range alone applies, and it keeps applying if that range ever widens.
        </p>

        {!valid && (
          <p className="policy-field__error" role="alert">
            Enter a whole number between {FLOOR_MIN_C} and {FLOOR_MAX_C}, or leave it empty.
          </p>
        )}
        {error && (
          <p className="policy-field__error" role="alert">
            {error}
          </p>
        )}

        {/* The distinction that stops this screen lying during an outage. */}
        {source === 'build' && (
          <p className="policy-field__warn" role="status">
            The bridge could not read the stored policy, so it is applying the value this
            deployment was built with. A change saved here will not take effect until it can.
          </p>
        )}
        {!canEdit && (
          <p className="policy-field__hint">
            {supabase === null
              ? 'Supabase is not configured for this deployment, so the policy cannot be changed here.'
              : 'This is a local session. Changing a building policy needs a signed-in account, so the change can be attributed.'}
          </p>
        )}
      </div>
    </Card>
  );
}
