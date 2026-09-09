import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { fetchAutomationActivity, type AutomationEvent } from '@/lib/supabaseAutomationActivity';
import type { Device } from '@/lib/types';

const SOURCE_LABEL: Record<string, string> = {
  schedule: 'Schedule',
  dsm_autoshed: 'Auto-shed',
  acu_loop: 'Aircon loop',
};

/** How a firing ended. Free text on the wire by design, so an unknown value renders as itself. */
const STATUS_TONE: Record<string, string> = {
  dispatched: 'good',
  dry_run: 'neutral',
  failed: 'bad',
  dispatching: 'warn',
};

/**
 * What automation actually did in the last 24 hours.
 *
 * THE POINT OF THE WHOLE TAB. Every unattended path writes to `commands`, and nothing in this
 * app has ever read those rows back — so "I armed a schedule, did it fire?" had two answers
 * available: walk to the fixture, or SSH to the Pi and read the journal. That silence is part of
 * how this page went months telling operators nothing it saved reached hardware while the
 * scheduler was switching relays.
 *
 * A `dry_run` row is not a failure and must not read as one: it is the honest record of a
 * firing that happened with the dispatch gate closed.
 */
export function AutomationActivityCard({ devices }: { devices: Device[] }) {
  const [events, setEvents] = useState<AutomationEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAutomationActivity()
      .then((rows) => !cancelled && setEvents(rows))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Could not read the command history.'));
    return () => {
      cancelled = true;
    };
  }, []);

  const nameOf = (id: string) => devices.find((d) => d.id === id)?.display_name ?? id;

  return (
    <section className="card automation-activity">
      <h3 className="card-title">
        <History size={14} className="title-icon" aria-hidden="true" />
        What automation did
      </h3>
      <p className="automation-schedules-sub">
        Every unattended command in the last 24 hours, from the audit trail — schedules, auto-shed and the aircon loop.
      </p>

      {error && (
        <p className="schedule-stack__error" role="alert">
          {error}
        </p>
      )}

      {events === null && !error && <p className="section-placeholder">Reading the command history…</p>}

      {events !== null && events.length === 0 && (
        <p className="automation-pending-empty">
          Nothing has fired in the last 24 hours. That is the honest answer, not an error — a page with no armed rules
          should say exactly this.
        </p>
      )}

      {events !== null && events.length > 0 && (
        <ul className="automation-activity__list">
          {events.map((e) => (
            <li key={e.id} className="automation-activity__row">
              <span className="automation-activity__time mono">
                {new Date(e.requestedAt).toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="automation-activity__what">
                <strong>{nameOf(e.deviceId)}</strong>
                {e.socket !== null && <span className="automation-activity__socket"> · S{e.socket}</span>}{' '}
                {e.targetC !== null ? `set to ${e.targetC}°C` : e.action}
              </span>
              <span className="automation-activity__source">{SOURCE_LABEL[e.source] ?? e.source}</span>
              <span className={`automation-activity__status automation-activity__status--${STATUS_TONE[e.status] ?? 'neutral'}`}>
                {/* Spelled out, because "dry_run" reads as a fault to somebody who does not know
                    the gate exists — and this is the row that proves the gate is doing its job. */}
                {e.status === 'dry_run' ? 'dry run' : e.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
