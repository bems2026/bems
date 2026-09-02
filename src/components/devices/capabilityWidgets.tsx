import { useState, type ReactNode } from 'react';
import { Gauge, Lock, LockOpen, AlertTriangle, Timer, Settings2, Zap } from 'lucide-react';
import { MetricValue } from '@/components/ui/MetricValue';
import { Sparkline } from '@/components/ui/Sparkline';
import { useDeviceStore, historyFor } from '@/stores/deviceStore';
import { measured } from '@/lib/staleness';
import { formatNumber, MISSING } from '@/lib/format';
import { faultFlags, READ_ONLY_SETTINGS } from '@/lib/capabilitySchema';
import { useCapabilityStore, writeFor } from '@/stores/capabilityStore';
import type { ResolvedCapabilities } from '@/lib/capabilitySchema';
import type { CapabilityValue, Device, Reading } from '@/lib/types';
import { RelayToggle } from './RelayToggle';
import { useRelayState } from '@/hooks/useRelayState';

/**
 * The pieces a device card is assembled from. Which of them appear is decided in
 * `widgetRegistry.ts` — data there, presentation here, which is also what keeps this file
 * exporting components only (the `react-refresh/only-export-components` rule, and a reasonable
 * separation regardless).
 *
 * EVERY WIDGET ASSUMES ITS CAPABILITY EXISTS. None of them tests for `undefined` to decide
 * whether to render at all; the registry has already established that the device's PRODUCT
 * declares the capability. What they do handle is the value not having arrived yet, which is a
 * different thing and shows as `—`. Mounting on the value instead would make controls appear and
 * vanish as packets came and went, and a layout that twitches is worse than a dash.
 */
export interface WidgetProps {
  device: Device;
  caps: ResolvedCapabilities;
  reading: Reading | undefined;
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="device-card__row">
      <span className="device-card__row-label">
        {icon}
        {label}
      </span>
      <span className="device-card__row-value">{children}</span>
    </div>
  );
}

/** The relay(s). Absorbs what `SwitchesListCard` and `OutletsListCard` each spelled for itself. */
export function RelayWidget({ device, caps }: WidgetProps) {
  const dual = caps.declares('switch_2');
  const state = useRelayState(device.id, dual ? 1 : undefined);

  return (
    <Row icon={<Zap size={14} aria-hidden="true" />} label={dual ? 'Sockets' : 'Relay'}>
      {dual ? (
        <span className="device-card__sockets">
          <RelayToggle deviceId={device.id} name={device.display_name} socket={1} variant="socket" />
          <RelayToggle deviceId={device.id} name={device.display_name} socket={2} variant="socket" />
        </span>
      ) : (
        <span className="device-card__relay">
          <span className="device-card__relay-label">{state.label}</span>
          <RelayToggle deviceId={device.id} name={device.display_name} />
        </span>
      )}
    </Row>
  );
}

/**
 * Live volts / amps / watts, plus a sparkline when history happens to be loaded.
 *
 * Values go through `measured()`, so a reading that has expired renders `—` instead of its last
 * number. A stale `0 W` shown as a real zero reads as an idle device, which is a lie a missing
 * value never tells.
 */
export function TelemetryWidget({ device, caps, reading }: WidgetProps) {
  // `historyFor` returns a shared empty array, so this selector is reference-stable and does not
  // re-render the card on every unrelated store change.
  const points = useDeviceStore((s) => historyFor(s.history, device.id, '24h'));
  const series = points.map((p) => p.power_w ?? 0);

  const v = measured(caps.value('cur_voltage') as number | undefined, reading);
  const a = measured(caps.value('cur_current') as number | undefined, reading);
  const w = measured(caps.value('cur_power') as number | undefined, reading);

  return (
    <Row icon={<Zap size={14} aria-hidden="true" />} label="Live now">
      <div className="device-card__telemetry">
        <div className="device-card__metrics">
          <span className="device-card__metric">
            <MetricValue value={w ?? null} unit="W" digits={1} size="md" />
            <span className="device-card__metric-label">power</span>
          </span>
          <span className="device-card__metric">
            <MetricValue value={v ?? null} unit="V" digits={1} size="sm" />
            <span className="device-card__metric-label">volts</span>
          </span>
          <span className="device-card__metric">
            <MetricValue value={a ?? null} unit="A" digits={3} size="sm" />
            <span className="device-card__metric-label">amps</span>
          </span>
        </div>
        {series.length > 1 && (
          <div className="device-card__spark">
            <Sparkline values={series} height={28} />
          </div>
        )}
      </div>
    </Row>
  );
}

/**
 * The device's own energy counters.
 *
 * `today_acc_energy` is what the meter itself says today's total is — the figure the bridge now
 * prefers over the value it used to integrate from power. Showing it beside the lifetime counter
 * is how an operator tells a counter reset from a genuine jump.
 */
export function EnergyWidget({ caps }: WidgetProps) {
  const today = caps.value('today_acc_energy');
  const total = caps.value('total_energy');
  const all = caps.value('all_energy');

  return (
    <Row icon={<Gauge size={14} aria-hidden="true" />} label="Energy">
      <span className="device-card__kv">
        <span>today {typeof today === 'number' ? `${formatNumber(today, 3)} kWh` : MISSING}</span>
        <span>lifetime {typeof total === 'number' ? `${formatNumber(total, 1)} kWh` : MISSING}</span>
        {typeof all === 'number' && (
          // Device-wide, not per-channel: both logical meters of a dual-channel device report
          // the same figure, and it is exactly channel 1 + channel 2.
          <span className="device-card__muted">both channels {formatNumber(all, 1)} kWh</span>
        )}
      </span>
    </Row>
  );
}

/**
 * Child lock — the physical-button lockout on the outlet itself.
 *
 * Writable, and the badge IS the control. The displayed state comes from the reading, never
 * from what was just clicked: the device does not confirm a setting back synchronously, so an
 * optimistic flip would show a lock that may not have engaged. "sending…" is the honest
 * intermediate, and the badge changes when the device says it has.
 */
export function ChildLockWidget({ device, caps }: WidgetProps) {
  const locked = caps.value('child_lock');
  const unknown = locked === undefined;
  const writable = caps.meta('child_lock')?.writable === true;
  const setCapability = useCapabilityStore((s) => s.setCapability);
  const write = useCapabilityStore((s) => writeFor(s.writes, device.id, 'child_lock'));
  const busy = write?.phase === 'sending';

  const label = unknown ? MISSING : locked ? 'locked' : 'unlocked';

  return (
    <Row
      icon={locked === true ? <Lock size={14} aria-hidden="true" /> : <LockOpen size={14} aria-hidden="true" />}
      label="Child lock"
    >
      {writable ? (
        <button
          type="button"
          className={`badge device-card__badge-button${locked === true ? ' badge--accent' : ''}`}
          aria-pressed={locked === true}
          aria-label={`Child lock, currently ${label}`}
          disabled={busy || unknown}
          onClick={() => void setCapability(device.id, 'child_lock', !locked)}
        >
          {busy ? 'sending…' : label}
        </button>
      ) : (
        <span className={`badge${locked === true ? ' badge--accent' : ''}`}>{label}</span>
      )}
      {write?.phase === 'failed' && <span className="device-card__error">{write.error}</span>}
    </Row>
  );
}

/**
 * The over-power alarm threshold the device holds, and the device's own verdict against it.
 *
 * The slider is bounded by the vendor's declared min/max/step rather than by anything chosen
 * here, so it cannot offer a value the hardware would reject — including the step, because
 * offering 1550 W when the device quantises to 100 W would show a number it never held.
 *
 * The committed value comes from the READING. While dragging, the thumb follows the finger
 * (`draft`), and the write is sent on release — one command per adjustment rather than one per
 * pixel. If the device reports something else afterwards, the device wins.
 *
 * `power_type` is the DEVICE's verdict against this threshold, not one evaluated here. The two
 * can disagree, and when they do the device is the one wired to the circuit.
 */
export function WarnPowerWidget({ device, caps }: WidgetProps) {
  const meta = caps.meta('warn_power');
  const value = caps.value('warn_power');
  const verdict = caps.value('power_type');
  const known = typeof value === 'number';
  const writable = meta?.writable === true;

  const setCapability = useCapabilityStore((s) => s.setCapability);
  const write = useCapabilityStore((s) => writeFor(s.writes, device.id, 'warn_power'));
  const busy = write?.phase === 'sending';

  // The device's value is the truth; the draft exists only for the duration of a drag.
  //
  // It records WHAT IT WAS DRAGGED AGAINST, and is ignored the moment the reading moves — so a
  // value the device rejected cannot linger on screen looking committed. Derived during render
  // rather than cleared in an effect: resetting state from an effect renders once with the
  // stale value first, and is what `react-hooks/set-state-in-effect` exists to catch.
  const [draft, setDraft] = useState<{ against: CapabilityValue | undefined; value: number } | null>(null);
  const live = draft && draft.against === value ? draft.value : null;

  const min = meta?.min ?? 0;
  const shown = live ?? (known ? value : min);

  const commit = () => {
    if (live === null || live === value) return; // released where it started — nothing to say
    void setCapability(device.id, 'warn_power', live);
  };

  return (
    <Row icon={<AlertTriangle size={14} aria-hidden="true" />} label="Power alarm">
      <span className="device-card__threshold">
        <input
          type="range"
          className="device-card__slider"
          min={min}
          max={meta?.max ?? 100}
          step={meta?.step ?? 1}
          value={shown}
          disabled={!writable || busy || !known}
          aria-label="Over-power alarm threshold"
          aria-valuetext={`${formatNumber(shown, 0)} watts`}
          onChange={(e) => setDraft({ against: value, value: Number(e.currentTarget.value) })}
          // Committed on release, not on every pixel of the drag — one command per adjustment.
          onPointerUp={() => commit()}
          onKeyUp={(e) => { if (/^(Arrow|Home|End|Page)/.test(e.key)) commit(); }}
        />
        <span className="device-card__threshold-value">
          {known || live !== null ? `${formatNumber(shown, 0)} W` : MISSING}
        </span>
        {busy && <span className="device-card__muted">sending…</span>}
        {typeof verdict === 'string' && !busy && (
          <span className={`badge${verdict === 'warn' ? ' badge--warn' : ' badge--good'}`}>{verdict}</span>
        )}
      </span>
      {write?.phase === 'failed' && <span className="device-card__error">{write.error}</span>}
    </Row>
  );
}

/** Auto-off countdown, in seconds, as the device holds it. */
export function CountdownWidget({ caps }: WidgetProps) {
  const dual = caps.declares('countdown_2');
  const show = (v: unknown) => (typeof v === 'number' ? (v === 0 ? 'off' : `${formatNumber(v, 0)} s`) : MISSING);

  return (
    <Row icon={<Timer size={14} aria-hidden="true" />} label="Countdown">
      <span className="device-card__kv">
        <span>{dual ? `S1 ${show(caps.value('countdown_1'))}` : show(caps.value('countdown_1'))}</span>
        {dual && <span>S2 {show(caps.value('countdown_2'))}</span>}
      </span>
    </Row>
  );
}

/** Any fault bits the device is reporting. */
export function FaultWidget({ caps }: WidgetProps) {
  const flags = faultFlags(caps);
  const raw = caps.value('fault');

  return (
    <Row icon={<AlertTriangle size={14} aria-hidden="true" />} label="Faults">
      {raw === undefined ? (
        <span className="device-card__muted">{MISSING}</span>
      ) : flags.length === 0 ? (
        <span className="badge badge--good">none reported</span>
      ) : (
        <span className="device-card__kv">
          {flags.map((f) => (
            <span key={f} className="badge badge--bad">
              {f}
            </span>
          ))}
        </span>
      )}
    </Row>
  );
}

/**
 * The settings this system reads and deliberately does not write.
 *
 * `relay_status`, `switch_inching`, `cycle_time` and `random_time` each install unattended
 * switching inside the device, where the Supabase scheduler and the command audit trail cannot
 * see or override it. Showing them matters precisely because they are invisible otherwise: an
 * operator wondering why a light turned itself off has nowhere else to look.
 */
export function SettingsWidget({ caps }: WidgetProps) {
  const shown = READ_ONLY_SETTINGS.filter((s) => caps.declares(s));

  return (
    <Row icon={<Settings2 size={14} aria-hidden="true" />} label="Device settings">
      <span className="device-card__kv device-card__kv--wrap">
        {shown.map((s) => {
          const v = caps.value(s);
          const text = v === undefined || v === '' ? MISSING : String(v);
          return (
            <span key={s} className="device-card__setting">
              <span className="device-card__muted">{s.replace(/_/g, ' ')}</span> {text}
            </span>
          );
        })}
      </span>
    </Row>
  );
}
