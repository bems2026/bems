import { InfoHint } from '@/components/ui/InfoHint';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';
import { useCommandStore } from '@/stores/commandStore';
import { useDeviceStore } from '@/stores/deviceStore';

/**
 * How this building's commands actually reach its hardware, and whether any of them have
 * recently had to leave the building to do it.
 *
 * WHY THIS EXISTS AT ALL. The single most-asked question about this system is whether the
 * devices can be controlled over the local 2.4 GHz network from their device id and local key,
 * with no vendor cloud in the path. The answer has been yes since the first release — the Tuya
 * fleet sits on the Pi's own segment, `server/dispatchLight.mjs` tries that path first on every
 * command, and the cloud is only reached after a local failure — but nothing on screen said so.
 * A property nobody can see is one that gets re-litigated every few months, and worse, one that
 * can regress without anybody noticing.
 *
 * TWO FACTS, NOT ONE. The policy says what this site permits; `cloudFallbackConfigured` says
 * whether a fallback exists to permit. They are shown together because either alone misleads:
 * `local-first` with no vendor credentials set behaves exactly like `local-only` today, and is
 * a completely different promise about tomorrow.
 *
 * THE RECOVERY LINE IS THE PART THAT EARNS ITS SPACE. A command that only landed through the
 * vendor cloud SUCCEEDED — the operator sees an ordinary success — while meaning that device
 * stopped answering on the LAN. That is the earliest warning this system has that a device is
 * going bad, and until now it appeared only in the alerts bell and a database column. See
 * `docs/adr-002-device-recovery-path.md`.
 *
 * Silent about the policy when the proxy never reported it: an older proxy is *unknown*, not
 * `local-first`, and inventing a guarantee from an absent answer is exactly the mistake
 * `dispatchClasses` already distinguishes against.
 */
export function DispatchPathNote() {
  const policy = useCapabilitiesStore((s) => s.dispatchPolicy);
  const cloudConfigured = useCapabilitiesStore((s) => s.cloudFallbackConfigured);
  const cloudRecoveries = useCommandStore((s) => s.cloudRecoveries);
  const devices = useDeviceStore((s) => s.devices);

  const recovered = Object.keys(cloudRecoveries);

  if (policy === null && recovered.length === 0) return null;

  const nameFor = (id: string) => devices.find((d) => d.id === id)?.display_name ?? id;

  return (
    <p className="devices-watchdog-note">
      {policy === 'local-only'
        ? 'Commands are sent over the local network only.'
        : policy === 'local-first'
          ? cloudConfigured
            ? 'Commands are sent over the local network first, falling back to the vendor cloud only if that fails.'
            : 'Commands are sent over the local network. No vendor fallback is configured on this deployment.'
          : null}
      {policy !== null && (
        <InfoHint label="How commands reach the devices">
          The devices are on the same local network as the Pi and are commanded directly, using each device&rsquo;s own id and local
          key. That path needs no internet at all, which is why switching a light keeps working through an outage. The vendor cloud
          exists only as a fallback for one specific fault: a device whose inbound connection table is exhausted stops answering
          locally while its outbound connection to the vendor stays healthy, and without the fallback the only recovery is removing
          power at the breaker. It is never used when the local path succeeds.
        </InfoHint>
      )}
      {recovered.length > 0 && (
        <>
          {' '}
          <strong>{recovered.map(nameFor).join(', ')}</strong> answered only through the vendor cloud this session — that device is
          no longer reachable on the local network and is worth looking at before it stops answering altogether.
        </>
      )}
    </p>
  );
}
