import { Cloud } from 'lucide-react';
import { useCloudFleet } from '@/hooks/useCloudFleet';
import { InfoHint } from '@/components/ui/InfoHint';

/**
 * What Tuya's cloud sees, beside what the bridge sees.
 *
 * The cloud reaches these devices over the internet rather than the local subnet, so the two
 * views disagreeing is a diagnosis: a device the cloud calls online while the bridge cannot
 * reach it is powered, joined and talking to Tuya, and the network is what is in the way.
 *
 * DELIBERATELY NOT JOINED PER DEVICE, and deliberately not counted against the local total.
 * The registry has no Tuya device id, so the only sound join key does not exist on this side
 * yet — and comparing the two counts instead is unsound, because several registry devices are
 * two logical readers of one physical meter and two flow nodes have no cloud device at all.
 * That exact mistake was made once already today and produced a confident, empty verdict. The
 * list is shown as the cloud's own answer, for a person to read against the fleet below.
 */
export function CloudFleetCard() {
  const { byId, status } = useCloudFleet();
  // A deployment with no Tuya credentials is not broken; it simply does not have this.
  if (status === 'unconfigured') return null;

  const devices = Object.values(byId).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const online = devices.filter((d) => d.online).length;

  return (
    <div className="card cloud-fleet-card">
      <div className="card-head">
        <h3 className="card-title">
          <Cloud size={14} className="title-icon" aria-hidden="true" />
          Vendor cloud view
          <InfoHint label="What this tells you">
            Tuya reaches these devices over the internet, not the office network. A device shown
            online here that the fleet below calls offline is powered and connected — the local
            network is what cannot reach it.
          </InfoHint>
        </h3>
        {status === 'ready' && (
          <span className="cloud-fleet-card__count mono">
            {online}/{devices.length} online
          </span>
        )}
      </div>

      {status === 'loading' && <p className="section-placeholder">Asking the vendor cloud…</p>}
      {status === 'error' && devices.length === 0 && (
        <p className="section-placeholder">The vendor cloud could not be reached.</p>
      )}
      {devices.length > 0 && (
        <ul className="cloud-fleet-list">
          {devices.map((d) => (
            <li key={d.id} className="cloud-fleet-list__row">
              <span className="cloud-fleet-list__name">{d.name ?? d.id}</span>
              <span className={`cloud-fleet-list__state${d.online ? ' cloud-fleet-list__state--on' : ''}`}>
                {d.online ? 'online' : 'offline'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
