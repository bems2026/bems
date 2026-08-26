import { InfoHint } from '@/components/ui/InfoHint';
import { useDevicePresence } from '@/hooks/useDevicePresence';
import { presenceSplit, type PresenceDevice } from '@/lib/devicePresence';

const names = (devices: PresenceDevice[]) => devices.map((d) => d.name ?? d.id).join(', ');

/**
 * The one diagnostic that decides whether somebody makes a journey, shown only when it has
 * something to say.
 *
 * DELIBERATELY NOT A PER-DEVICE COLUMN, which is what FI-015 originally asked for. The reply is
 * keyed by vendor device, and the registry carries no vendor id — `shared/registry.mjs` says so
 * outright, because two of its logical meters are one physical box. Joining on the display name
 * would look right and be wrong for exactly the devices that are hardest to reason about, and
 * this project has already made that mistake once and got a confident, empty answer out of it.
 * Carrying the vendor id into the registry is FI-001; until then the vendor's own names are
 * reported as the vendor's, unjoined and labelled as such.
 *
 * Silent when there is nothing to act on, following the same rule as the unstable count in the
 * page header — a healthy fleet should not have to render a zero. The card this replaces on the
 * Devices page was removed in EX-028b for restating what the table already showed; this only
 * ever says something the table cannot.
 */
export function SegmentPresenceNote() {
  const presence = useDevicePresence();

  // Loading, no vendor credentials, or the request failed: stay quiet. This is supplementary
  // diagnostics, and a deployment that was never given credentials is not faulty.
  if (presence.status !== 'ready') return null;

  if (!presence.arpReadable) {
    // Worth saying rather than hiding: in this deployment the server IS the Pi, so a server
    // that cannot read a neighbour table is itself the news.
    return (
      <p className="devices-watchdog-note">
        Segment presence unavailable — the server could not read a neighbour table.
        <InfoHint label="Why segment presence is unavailable">
          This check joins the vendor cloud's per-device MAC against the host's own ARP table, so it only means anything on the
          machine that shares a network segment with the devices. The server reported that it could not read one. Nothing is
          being claimed about the fleet either way — an empty ARP table would otherwise mark every device absent.
        </InfoHint>
      </p>
    );
  }

  const { onSegment, absent } = presenceSplit(presence);
  if (onSegment.length === 0 && absent.length === 0) return null;

  return (
    <p className="devices-watchdog-note">
      {absent.length > 0 && <span>{names(absent)} off the network — needs a power-cycle on site. </span>}
      {onSegment.length > 0 && <span>{names(onSegment)} still on the segment but not discoverable — try a static address first, but it may still need power. </span>}
      <InfoHint label="How segment presence is determined">
        These are the vendor cloud's device names, not this table's — the two are deliberately not joined, because the registry
        carries no vendor id and one physical meter appears here as two logical devices. A device dark to the cloud that still
        answers ARP is associated to the access point, so a static <code>deviceIp</code> is worth trying and costs nothing.
        It is not a promise: answering ARP proves the device's network layer is alive, not its Tuya session, and on 2026-08-26
        <code>CO5</code> did exactly that — took a correct address and then refused every connection, needing power after all.
        A device that answers nothing has certainly left the network. The split moves, twice within an hour on that same day,
        so re-read it immediately before acting on it.
      </InfoHint>
    </p>
  );
}
