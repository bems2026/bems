import { Plug } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useCommandStore, targetKey } from '@/stores/commandStore';
import { controlView } from '@/lib/socketView';
import { corroborate } from '@/lib/relayCorroboration';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/components/ui/useConfirm';
import { useControlLog } from './controlLog';
import { PLAN } from '@/components/scene3d/geometry';
import type { Device, SocketIndex } from '@/lib/types';

/**
 * Same 7 outlet positions `FloorPlanView.tsx` uses (its own comment explains the source:
 * the live `Outlet Floor Plan (Status Only)` `ui_template`'s fixed `coords` array, index
 * i-1 -> device `co{i}`). Duplicated rather than imported because `geometry.ts`'s exported
 * `OUTLET_FIXTURES` gives the 3D scene's *wall-snapped* mount point, not this original
 * plan-space position — the two diverge for any outlet not flush against the wall the
 * snap picked, so a 2D plan wanting the actual surveyed pin needs the raw coordinates.
 */
const OUTLET_LAYOUT: { id: string; x: number; y: number }[] = [
  { id: 'co1', x: 25, y: 470 },
  { id: 'co2', x: 50, y: 515 },
  { id: 'co3', x: 285, y: 470 },
  { id: 'co4', x: 25, y: 370 },
  { id: 'co5', x: 65, y: 115 },
  { id: 'co6', x: 235, y: 115 },
  { id: 'co7', x: 285, y: 190 },
];

const VB_W = 320;
const VB_H = 550;
const pct = (px: number, total: number) => `${((px / total) * 100).toFixed(2)}%`;

/** The glazed partition's real doorway gap (`officeScene.ts`'s `addGlazedPartition`)
 * mirrored here in plan-space — 1.6m centered on the room's x-midpoint, converted at the
 * same 1 SVG unit = 2cm scale `geometry.ts` uses. */
const DOORWAY_HALF_PX = 40;

export function OutletPlanCard() {
  const devices = useDeviceStore((s) => s.devices);
  const send = useCommandStore((s) => s.send);
  const log = useControlLog((s) => s.log);
  const { ask, modalProps } = useConfirm();
  const outlets = devices.filter((d) => d.class === 'outlet_dual');
  const outletById = new Map(outlets.map((d) => [d.id, d]));

  const midX = (PLAN.x0 + PLAN.x1) / 2;

  const allOn = () => {
    for (const d of outlets) {
      send(d.id, 1, 'on');
      send(d.id, 2, 'on');
      log('RELAY', `${d.display_name} → on`);
    }
  };
  const allOff = () => {
    for (const d of outlets) {
      send(d.id, 1, 'off');
      send(d.id, 2, 'off');
      log('RELAY', `${d.display_name} → off`);
    }
  };
  const askAllOn = () =>
    ask({ title: 'Turn all outlets on?', body: `This sends an on command to both sockets on all ${outlets.length} outlets (CO1-CO7) at once.`, confirmLabel: 'Turn outlets on', tone: 'red' }, allOn);
  const askAllOff = () =>
    ask(
      { title: 'Turn all outlets off?', body: `This sends an off command to both sockets on all ${outlets.length} outlets (CO1-CO7) at once. Anything plugged in — chargers, equipment, the water dispenser — loses power immediately.`, confirmLabel: 'Turn outlets off', tone: 'red' },
      allOff,
    );

  return (
    <div className="control-plan-panel control-plan-panel--outlets">
      <div className="control-plan-panel__label">
        <Plug size={12} className="title-icon" aria-hidden="true" />
        CONVENIENCE OUTLETS · CO1-CO7
      </div>
      <div className="control-outlet-plan">
        <div
          className="control-outlet-plan__outline"
          style={{ left: pct(PLAN.x0, VB_W), top: pct(PLAN.y0, VB_H), right: pct(VB_W - PLAN.x1, VB_W), bottom: pct(VB_H - PLAN.y1, VB_H) }}
        />
        <div
          className="control-outlet-plan__partition control-outlet-plan__partition--glass"
          style={{ top: pct(PLAN.partitionY, VB_H), left: pct(PLAN.x0, VB_W), width: pct(midX - DOORWAY_HALF_PX - PLAN.x0, VB_W) }}
        />
        <div
          className="control-outlet-plan__partition control-outlet-plan__partition--glass"
          style={{ top: pct(PLAN.partitionY, VB_H), left: pct(midX + DOORWAY_HALF_PX, VB_W), width: pct(PLAN.x1 - (midX + DOORWAY_HALF_PX), VB_W) }}
        />
        {/* The sliding door fills the gap the two glass panels above leave — same doorway
            gap the 3D shell's `addGlazedPartition` cuts, not the old south-wall position. */}
        <div
          className="control-outlet-plan__door"
          style={{ top: pct(PLAN.partitionY, VB_H), left: pct(midX - DOORWAY_HALF_PX, VB_W), width: pct(DOORWAY_HALF_PX * 2, VB_W) }}
        />

        {OUTLET_LAYOUT.map(({ id, x, y }) => {
          const device = outletById.get(id);
          if (!device) return null;
          return <OutletPin key={id} device={device} left={pct(x, VB_W)} top={pct(y, VB_H)} />;
        })}
      </div>
      <div className="control-plan-panel__actions">
        <button type="button" className="control-plan-btn" onClick={askAllOn}>
          All outlets on
        </button>
        <button type="button" className="control-plan-btn control-plan-btn--accent" onClick={askAllOff}>
          All outlets off
        </button>
      </div>
      <ConfirmModal {...modalProps} />
    </div>
  );
}

function OutletPin({ device, left, top }: { device: Device; left: string; top: string }) {
  const reading = useDeviceStore((s) => s.latestReadings[device.id]);
  const pendingMap = useCommandStore((s) => s.pending);
  const send = useCommandStore((s) => s.send);
  const log = useControlLog((s) => s.log);
  const corroboration = corroborate(device, reading);

  const s1View = controlView(reading, pendingMap[targetKey(device.id, 1)], 1);
  const s2View = controlView(reading, pendingMap[targetKey(device.id, 2)], 2);
  const s1On = (s1View.kind === 'idle' || s1View.kind === 'pending') && s1View.value === 'on';
  const s2On = (s2View.kind === 'idle' || s2View.kind === 'pending') && s2View.value === 'on';
  const s1Busy = s1View.kind === 'pending';
  const s2Busy = s2View.kind === 'pending';
  const s1Unknown = s1View.kind === 'unknown';
  const s2Unknown = s2View.kind === 'unknown';

  const toggle = (socket: SocketIndex, on: boolean) => {
    const next = on ? 'off' : 'on';
    send(device.id, socket, next);
    log('RELAY', `${device.display_name} DP${socket} → ${next}`);
  };

  return (
    <div className="control-outlet-pin" style={{ left, top }}>
      <div className="control-outlet-pin__id">{device.id.toUpperCase()}</div>
      <div className="control-outlet-pin__puck" role="group" aria-label={`${device.display_name} sockets`}>
        <button
          type="button"
          className={`control-outlet-pin__half control-outlet-pin__half--left${s1On ? ' control-outlet-pin__half--on' : ''}`}
          disabled={s1Busy || s1Unknown}
          aria-pressed={s1On}
          aria-label={`${device.display_name} DP1`}
          title={`DP1: ${s1Unknown ? 'unknown' : s1Busy ? 'switching…' : s1On ? 'on' : 'off'}`}
          onClick={() => toggle(1, s1On)}
        />
        <button
          type="button"
          className={`control-outlet-pin__half control-outlet-pin__half--right${s2On ? ' control-outlet-pin__half--on' : ''}`}
          disabled={s2Busy || s2Unknown}
          aria-pressed={s2On}
          aria-label={`${device.display_name} DP2`}
          title={`DP2: ${s2Unknown ? 'unknown' : s2Busy ? 'switching…' : s2On ? 'on' : 'off'}`}
          onClick={() => toggle(2, s2On)}
        />
      </div>
      {corroboration === 'contradicted' && <div className="control-outlet-pin__warn">⚠ drawing power</div>}
    </div>
  );
}
