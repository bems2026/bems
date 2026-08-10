import { useEffect, useState } from 'react';
import { useConnectionStore } from '@/stores/connectionStore';
import { isStale } from '@/lib/bridgeClient';
import type { ConnStatus } from '@/lib/bridgeClient';

/** Ports the three-state colour + last-updated pattern from `Bems.html:1254-1271`. */
const LABEL: Record<ConnStatus, string> = {
  connected: 'Connected',
  'polling-fallback': 'Connected (polling)',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
};

const TONE: Record<ConnStatus, 'good' | 'warn' | 'bad'> = {
  connected: 'good',
  'polling-fallback': 'warn',
  reconnecting: 'warn',
  offline: 'bad',
};

/**
 * Built early (P0), not last — so "the bridge is down" is visually distinguishable from
 * "the UI is broken" for the rest of the build, per the Stage 1 plan.
 */
export function ConnectionStatus() {
  const wsStatus = useConnectionStore((s) => s.wsStatus);
  const lastMessageAt = useConnectionStore((s) => s.lastMessageAt);

  // Re-render once a second purely so staleness (computed from wall-clock time) dims
  // the badge even when no new store write has happened — the store alone can't tell us.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const stale = isStale(lastMessageAt ? Date.parse(lastMessageAt) : null);
  const tone = TONE[wsStatus];

  return (
    <div className="connection-status" role="status" aria-live="polite">
      <span
        className={`connection-dot connection-dot--${tone}${stale ? ' connection-dot--stale' : ''}`}
        aria-hidden="true"
      />
      <span className="connection-label">{LABEL[wsStatus]}</span>
      {lastMessageAt && (
        <span className="connection-last">
          · last update {new Date(lastMessageAt).toLocaleTimeString('en-PH', { hour12: false })}
        </span>
      )}
    </div>
  );
}
