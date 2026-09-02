import { memo } from 'react';
import { useCommandStore } from '@/stores/commandStore';
import { useRelayState } from '@/hooks/useRelayState';
import { useControlLog } from '@/components/control/controlLog';
import type { SocketIndex } from '@/lib/types';

/**
 * One relay control — the switch toggle and the outlet socket button, which were the same
 * component written five times.
 *
 * WHY IT EXISTS. `SwitchesListCard`, `OutletsListCard`, `LightingMatrixCard`, `OutletPlanCard`
 * and `MasterQuickActionsCard` each re-derived the identical triple:
 *
 *     const view = controlView(reading, pending, socket);
 *     const busy = view.kind === 'pending';
 *     const unknown = view.kind === 'unknown';
 *     const on = !unknown && view.value === 'on';
 *
 * and then each decided independently what `disabled` meant. That is exactly how EX-017's fix
 * ended up half-applied — staleness was removed from `disabled=` but left in one click handler,
 * so a button rendered enabled and silently did nothing. Five copies is five chances to get the
 * refusal rule subtly different, on a control that moves a real relay.
 *
 * The rule, in one place: a toggle is refused when a command is in flight, when there is no
 * known state to toggle *from*, or when the bridge says the device is offline. **Never for
 * staleness** — telemetry and dispatch travel in opposite directions, and gating the second on
 * the first cost the outlets their controls entirely (nothing polls an outlet faster than 60 s,
 * so its reading is stale most of the time while the relay is perfectly reachable).
 *
 * Subscribes to its OWN reading and its OWN pending entry rather than to the maps, so one
 * device's packet re-renders one toggle. `OutletRow` used to select the whole `pending` map,
 * which re-rendered both its sockets on any command anywhere in the building.
 */
export interface RelayToggleProps {
  deviceId: string;
  /** Used for the accessible name and the control log line. */
  name: string;
  /** Omit for a whole-device switch; 1 or 2 for one socket of a dual outlet. */
  socket?: SocketIndex;
  /**
   * `switch` renders the sliding track used by the lighting rows; `socket` renders the compact
   * labelled button used by the outlet rows. Markup and ARIA differ because the two say
   * different things: a switch is `role="switch"` with `aria-checked`, a socket button is a
   * pressed-state button among siblings.
   */
  variant?: 'switch' | 'socket';
}

export const RelayToggle = memo(function RelayToggle({ deviceId, name, socket, variant = 'switch' }: RelayToggleProps) {
  const { busy, unknown, on, disabled, stale } = useRelayState(deviceId, socket);
  const send = useCommandStore((s) => s.send);
  const log = useControlLog((s) => s.log);

  const label = socket === undefined ? name : `${name} socket ${socket}`;

  const toggle = () => {
    if (disabled) return;
    const next = on ? 'off' : 'on';
    void send(deviceId, socket, next);
    log('RELAY', socket === undefined ? `${name} → ${next}` : `${name} S${socket} → ${next}`);
  };

  if (variant === 'socket') {
    // Staleness is shown here, and only here: it tells the operator the READING is old, which is
    // worth knowing beside a control it deliberately does not disable.
    return (
      <button
        type="button"
        className={`outlet-socket-toggle outlet-socket-toggle--compact${on ? ' outlet-socket-toggle--on' : ''}${busy ? ' outlet-socket-toggle--busy' : ''}`}
        aria-pressed={on}
        aria-busy={busy}
        aria-label={label}
        disabled={disabled}
        onClick={toggle}
      >
        <span className="outlet-socket-toggle__label">S{socket}</span>
        <span className="outlet-socket-toggle__state">{unknown ? 'unknown' : stale ? 'stale' : busy ? '…' : on ? 'on' : 'off'}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-busy={busy}
      className={`quick-toggle${on ? ' quick-toggle--on' : ''}`}
      disabled={disabled}
      onClick={toggle}
    >
      <span className="quick-toggle__knob" />
    </button>
  );
});
