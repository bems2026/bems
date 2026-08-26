import { InfoHint } from '@/components/ui/InfoHint';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';

/**
 * Says when commands are being recorded locally instead of in the audit table.
 *
 * WHY IT HAS TO BE SAID: during an internet outage the devices still switch — they are on the
 * Pi's own segment and need no internet — and the command path deliberately keeps working by
 * recording each command to a durable local buffer instead of Supabase. That is the right
 * behaviour, but it means "the light turned off" and "the audit trail knows the light turned
 * off" have briefly come apart. A command accepted into the buffer is not the same fact as one
 * recorded, and this project's posture is that the UI never claims more than it can observe.
 *
 * Silent when the backlog is zero, and silent when the proxy never reported the field at all —
 * an older proxy is *unknown*, not zero, and inventing "all clear" from an absent answer is the
 * exact mistake `dispatchClasses` already distinguishes against.
 */
export function AuditBacklogNote() {
  const pending = useCapabilitiesStore((s) => s.auditBufferPending);
  if (typeof pending !== 'number' || pending <= 0) return null;

  return (
    <p className="devices-watchdog-note">
      {pending} command{pending === 1 ? '' : 's'} recorded locally — the audit trail is behind.
      <InfoHint label="Why the audit trail is behind">
        Commands are still reaching the devices: they sit on the same local network as the Pi and do not need the internet. What is
        unavailable is the database the audit trail lives in, so each command is being written to a durable file on the Pi first and
        uploaded when the connection returns — a command is never dispatched without being recorded somewhere. Nothing needs doing;
        this clears itself. If it keeps climbing for hours, the Pi has lost its internet connection rather than its device network.
      </InfoHint>
    </p>
  );
}
