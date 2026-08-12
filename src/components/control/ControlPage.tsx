import { useEffect, useRef, useState } from 'react';
import { Lightbulb, Plug, Snowflake } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useCommandStore } from '@/stores/commandStore';
import { ConfirmModal, type ConfirmTone } from '@/components/ui/ConfirmModal';
import { InfoHint } from '@/components/ui/InfoHint';
import { LightingMatrixCard } from './LightingMatrixCard';
import { OutletPlanCard } from './OutletPlanCard';
import { SwitchesListCard } from './SwitchesListCard';
import { OutletsListCard } from './OutletsListCard';
import { IrCommandCenterCard } from './IrCommandCenterCard';
import { CommandLogCard } from './CommandLogCard';
import { useControlLog } from './controlLog';

type MasterAction = 'lights-off' | 'outlets-off' | 'ac-off';

const MASTER_COPY: Record<MasterAction, { title: string; body: string; confirmLabel: string; tone: ConfirmTone }> = {
  'lights-off': {
    title: 'Turn all lighting off?',
    body: 'This sends an off command to all 7 lighting circuits (L1-L7). Anyone working under them right now loses light immediately.',
    confirmLabel: 'Turn lights off',
    tone: 'accent',
  },
  'outlets-off': {
    title: 'Turn all outlets off?',
    body: 'This sends an off command to both sockets on all 7 outlets (CO1-CO7). Anything plugged in — chargers, equipment, the water dispenser — loses power immediately.',
    confirmLabel: 'Turn outlets off',
    tone: 'red',
  },
  'ac-off': {
    title: 'Send AC off?',
    body: 'This sends a single IR off command to the CARE ACU. It does not cut power to the unit — only a relay master would do that, and this app has none for the aircon by design.',
    confirmLabel: 'Send AC off',
    tone: 'blue',
  },
};

/**
 * Watches `commandStore.pending` for entries that transition to `failed` and logs each one
 * to the command log exactly once — a `FAULT` row for a command this session actually sent
 * and the bridge (or the mock's `--cmd-fail`/`--500` harness) genuinely rejected, never a
 * fabricated one.
 */
function useFaultLogging() {
  const pending = useCommandStore((s) => s.pending);
  const log = useControlLog((s) => s.log);
  const loggedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const [key, cmd] of Object.entries(pending)) {
      if (cmd.phase !== 'failed') continue;
      const fault_id = `${key}:${cmd.command_id}`;
      if (loggedRef.current.has(fault_id)) continue;
      loggedRef.current.add(fault_id);
      log('FAULT', `${cmd.device_id}${cmd.socket ? ` S${cmd.socket}` : ''} — ${cmd.error ?? 'command failed'}`);
    }
  }, [pending, log]);
}

export function ControlPage() {
  const devices = useDeviceStore((s) => s.devices);
  const send = useCommandStore((s) => s.send);
  const log = useControlLog((s) => s.log);
  const [confirming, setConfirming] = useState<MasterAction | null>(null);
  useFaultLogging();

  const runMaster = (action: MasterAction) => {
    if (action === 'lights-off') {
      for (const d of devices.filter((d) => d.class === 'switch')) {
        send(d.id, undefined, 'off');
        log('RELAY', `${d.display_name} → off`);
      }
    } else if (action === 'outlets-off') {
      for (const d of devices.filter((d) => d.class === 'outlet_dual')) {
        send(d.id, 1, 'off');
        send(d.id, 2, 'off');
        log('RELAY', `${d.display_name} → off`);
      }
    } else {
      send('acu_main', undefined, 'off');
      log('IR', 'CARE ACU → off');
    }
    setConfirming(null);
  };

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Spatial Plan &amp; Manual Overrides</h1>
          <p className="page-sub">
            14 relay nodes
            <InfoHint label="How the ACU is controlled">The ACU is IR-commanded from the HVAC card below — no relay cut.</InfoHint>
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="control-master-btn control-master-btn--accent" onClick={() => setConfirming('lights-off')}>
            <Lightbulb size={14} aria-hidden="true" />
            Lights off
          </button>
          <button type="button" className="control-master-btn control-master-btn--red" onClick={() => setConfirming('outlets-off')}>
            <Plug size={14} aria-hidden="true" />
            Outlets off
          </button>
          <button type="button" className="control-master-btn control-master-btn--blue" onClick={() => setConfirming('ac-off')}>
            <Snowflake size={14} aria-hidden="true" />
            Send AC off
          </button>
        </div>
      </header>

      <div className="control-grid">
        <div className="control-grid__main">
          <div className="card control-plan-card">
            <div className="card-head">
              <div>
                <h3 className="card-title">Lighting &amp; outlet plan</h3>
                <p className="card-sub">Click a lamp, a row switch, or an outlet socket to switch it.</p>
              </div>
              <span className="control-plan-card__tag">LAYOUT PER AS-BUILT SKETCH</span>
            </div>
            <div className="control-plan-grid">
              <LightingMatrixCard />
              <OutletPlanCard />
            </div>
          </div>

          <div className="control-list-grid">
            <SwitchesListCard />
            <OutletsListCard />
          </div>
        </div>

        <div className="control-grid__side">
          <IrCommandCenterCard />
          <CommandLogCard />
        </div>
      </div>

      {confirming && (
        <ConfirmModal
          open
          title={MASTER_COPY[confirming].title}
          body={MASTER_COPY[confirming].body}
          confirmLabel={MASTER_COPY[confirming].confirmLabel}
          tone={MASTER_COPY[confirming].tone}
          onConfirm={() => runMaster(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  );
}
