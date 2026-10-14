import { useEffect } from 'react';
import { InfoHint } from '@/components/ui/InfoHint';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';

/** Under this, the cloud is merely between uploads (every 5 minutes), which is not worth a sentence. */
const QUIET_FOR_MS = 15 * 60_000;
/** The capabilities load once at app start; a kiosk runs for days, so a page showing this asks again. */
const RECHECK_MS = 5 * 60_000;

function behindBy(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))} minutes`;
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${Math.floor(hours / 24)} days`;
}

/**
 * Says when the cloud is behind the Pi's own record — RM-163, 2026-10-14.
 *
 * WHY. The site was offline from 7 to 14 October. The Pi logged every minute throughout, but the cloud got
 * none of it until the internet returned, and then took hours to catch up over a slow uplink. Meanwhile the
 * Reports page showed those days empty, and nothing on screen said the data was safe and on its way. This
 * says it, and that reports for those days wait until their readings are up (`server/reports.mjs`).
 *
 * Silent when the cloud is within the normal upload cycle, when it has everything, and when the proxy never
 * reported the field — unknown is not "caught up", the same rule `AuditBacklogNote` follows. The lag is
 * measured when the proxy answered (`checkedAtMs`), which this page refreshes every five minutes.
 */
export function CloudBacklogNote() {
  const backlog = useCapabilitiesStore((s) => s.cloudBacklog);
  useEffect(() => {
    const t = setInterval(() => void useCapabilitiesStore.getState().load(), RECHECK_MS);
    return () => clearInterval(t);
  }, []);
  if (!backlog || backlog.since === null) return null;
  const lagMs = backlog.checkedAtMs - Date.parse(backlog.since);
  if (!(lagMs >= QUIET_FOR_MS)) return null;

  return (
    <p className="devices-watchdog-note">
      Logging on the Pi is live. The cloud is {behindBy(lagMs)} behind ({backlog.rows.toLocaleString()} readings waiting); reports
      for those days wait until it catches up.
      <InfoHint label="Why the cloud is behind">
        The Pi keeps every minute in its own archive whether or not the internet is up, and uploads it to the cloud when it can. After
        an outage it uploads every minute until it has caught up; on a slow connection that can take hours. Nothing is lost and
        nothing needs doing. If this keeps growing, the Pi has lost its internet connection, not its device network.
      </InfoHint>
    </p>
  );
}
