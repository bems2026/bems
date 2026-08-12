import { History } from 'lucide-react';
import { useControlLog } from './controlLog';
import { InfoHint } from '@/components/ui/InfoHint';

const TAG_CLASS: Record<string, string> = {
  RELAY: 'control-log-tag--relay',
  IR: 'control-log-tag--ir',
  FAULT: 'control-log-tag--fault',
};

/** Every command this session actually sent — real dispatches, tagged by what kind of
 * command they were. Resets on reload; see `controlLog.ts`'s header for why that's honest
 * rather than a missing feature. */
export function CommandLogCard() {
  const entries = useControlLog((s) => s.entries);

  return (
    <div className="card control-log-card">
      <h3 className="control-log-card__title">
        <History size={14} className="title-icon" aria-hidden="true" />
        Command log
      </h3>
      {entries.length === 0 ? (
        <p className="control-log-card__empty">No commands sent this session</p>
      ) : (
        <ul className="control-log-list">
          {entries.map((e) => (
            <li className="control-log-row" key={e.id}>
              <span className={`control-log-tag ${TAG_CLASS[e.tag]}`}>{e.tag}</span>
              <span className="control-log-row__text">{e.text}</span>
              <span className="control-log-row__time">{e.time}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="control-log-card__footnote">
        Session-only
        <InfoHint label="Where this log comes from">Sends go through the mock bridge's POST /api/command — this log is session-only, nothing here is stored server-side.</InfoHint>
      </p>
    </div>
  );
}
