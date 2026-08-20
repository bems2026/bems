import { useMemo } from 'react';
import { Plug } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useCommandStore, targetKey, type PendingCommand } from '@/stores/commandStore';
import { controlView } from '@/lib/socketView';
import { corroborate } from '@/lib/relayCorroboration';
import { isReadingStale } from '@/lib/staleness';
import { StaleDataBadge } from '@/components/common/StaleDataBadge';
import { InfoHint } from '@/components/ui/InfoHint';
import { SimulatedBadge } from './SimulatedBadge';
import type { Device, Reading, SocketIndex } from '@/lib/types';
import { useControlLog, type LogTag } from './controlLog';

/**
 * The 7 dual-socket outlets as a scannable list — same control path the plan's pucks use
 * (`commandStore`, `socketView.controlView`, `relayCorroboration`), one row per outlet.
 * See `LightingMatrixCard.tsx`'s `useLightSwitches` comment for why the sort is a
 * `useMemo` over the raw selector rather than inline in the selector itself.
 */
export function OutletsListCard({ simulated = false }: { simulated?: boolean }) {
  const devices = useDeviceStore((s) => s.devices);
  const outlets = useMemo(() => devices.filter((d) => d.class === 'outlet_dual').sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })), [devices]);

  return (
    <div className="card control-list-card">
      <h3 className="control-list-card__title">
        <Plug size={16} className="title-icon" aria-hidden="true" />
        Outlets
        <InfoHint label="Hardware">7x Tuya 20A dual-socket, S1/S2.</InfoHint>
        {simulated && <SimulatedBadge />}
      </h3>
      {outlets.map((d) => (
        <OutletRow key={d.id} device={d} />
      ))}
    </div>
  );
}

function OutletRow({ device }: { device: Device }) {
  const reading = useDeviceStore((s) => s.latestReadings[device.id]);
  const pendingMap = useCommandStore((s) => s.pending);
  const send = useCommandStore((s) => s.send);
  const log = useControlLog((s) => s.log);
  const corroboration = corroborate(device, reading);
  const stale = isReadingStale(reading);

  return (
    <StaleDataBadge deviceId={device.id} label={device.display_name} className="control-list-row">
      <div className="control-list-row__body">
        <p className="control-list-row__name">{device.display_name}</p>
        <p className="control-list-row__meta">
          {device.branch_circuit}
          {corroboration === 'contradicted' ? ' — commanded off, meter reads real power' : ''}
        </p>
      </div>
      <div className="control-list-row__sockets">
        <SocketMiniToggle deviceId={device.id} socket={1} pendingMap={pendingMap} reading={reading} send={send} log={log} name={device.display_name} stale={stale} />
        <SocketMiniToggle deviceId={device.id} socket={2} pendingMap={pendingMap} reading={reading} send={send} log={log} name={device.display_name} stale={stale} />
      </div>
    </StaleDataBadge>
  );
}

function SocketMiniToggle({
  deviceId,
  socket,
  pendingMap,
  reading,
  send,
  log,
  name,
  stale,
}: {
  deviceId: string;
  socket: SocketIndex;
  pendingMap: Record<string, PendingCommand>;
  reading: Reading | undefined;
  send: (deviceId: string, socket: SocketIndex | undefined, desired: 'on' | 'off') => Promise<void>;
  log: (tag: LogTag, text: string) => void;
  name: string;
  stale: boolean;
}) {
  const view = controlView(reading, pendingMap[targetKey(deviceId, socket)], socket);
  const busy = view.kind === 'pending';
  const unknown = view.kind === 'unknown';
  const on = !unknown && view.value === 'on';

  return (
    <button
      type="button"
      className={`outlet-socket-toggle outlet-socket-toggle--compact${on ? ' outlet-socket-toggle--on' : ''}${busy ? ' outlet-socket-toggle--busy' : ''}`}
      aria-pressed={on}
      aria-busy={busy}
      disabled={busy || unknown || stale}
      onClick={() => {
        const next = on ? 'off' : 'on';
        send(deviceId, socket, next);
        log('RELAY', `${name} S${socket} → ${next}`);
      }}
    >
      <span className="outlet-socket-toggle__label">S{socket}</span>
      <span className="outlet-socket-toggle__state">{unknown ? 'unknown' : stale ? 'stale' : busy ? '…' : on ? 'on' : 'off'}</span>
    </button>
  );
}
