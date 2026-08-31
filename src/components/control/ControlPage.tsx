import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Lightbulb, Plug, Snowflake } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useCommandStore } from '@/stores/commandStore';
import { useDevicesFor } from '@/hooks/useDevicesFor';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';
import { AuditBacklogNote } from './AuditBacklogNote';
import { ConfirmModal, type ConfirmTone } from '@/components/ui/ConfirmModal';
import { InfoHint } from '@/components/ui/InfoHint';
import { LightingMatrixCard } from './LightingMatrixCard';
import { OutletPlanCard } from './OutletPlanCard';
import { SwitchesListCard } from './SwitchesListCard';
import { OutletsListCard } from './OutletsListCard';
import { IrCommandCenterCard } from './IrCommandCenterCard';
import { CommandLogCard } from './CommandLogCard';
import { useControlLog } from './controlLog';
import type { DeviceClass } from '@/lib/types';
import { dispatchScope } from './dispatchScope';

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
    body: 'This sends a single IR off command to the aircon. It does not cut power to the unit — only a relay master would do that, and this app has none for the aircon by design.',
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
  // The page's own membership: devices declared for `control`. The master actions below act on
  // exactly what is rendered — a device configured off this page must not be swept up by
  // "Lights off", which would switch something the operator deliberately removed from view.
  const { included: controlled } = useDevicesFor('control');
  const send = useCommandStore((s) => s.send);
  const log = useControlLog((s) => s.log);
  const dispatchClasses = useCapabilitiesStore((s) => s.dispatchClasses);
  // Which controls on this page are actually wired to hardware right now. `null` (not yet
  // loaded) resolves to 'closed' inside dispatchScope — never claim otherwise before a real
  // /api/capabilities response says so.
  const scope = useMemo(() => dispatchScope(devices, dispatchClasses), [devices, dispatchClasses]);
  // Flag individual cards only in the MIXED state. When nothing dispatches at all, the banner
  // above already says so once, and repeating it on every card is noise that trains people to
  // ignore the flag — which would defeat it at the one moment it matters.
  const flagSimulated = (cls: DeviceClass) => scope.simulated.includes(cls);
  const [confirming, setConfirming] = useState<MasterAction | null>(null);
  useFaultLogging();

  const runMaster = (action: MasterAction) => {
    if (action === 'lights-off') {
      for (const d of controlled.filter((d) => d.class === 'switch')) {
        send(d.id, undefined, 'off');
        log('RELAY', `${d.display_name} → off`);
      }
    } else if (action === 'outlets-off') {
      for (const d of controlled.filter((d) => d.class === 'outlet_dual')) {
        send(d.id, 1, 'off');
        send(d.id, 2, 'off');
        log('RELAY', `${d.display_name} → off`);
      }
    } else {
      // By class and through `controlled`, like the two branches above — FI-016. This used to
      // send to one building's aircon by id, which had a second consequence worth naming: it
      // BYPASSED the page's own membership, so "AC off" could switch a unit the operator had
      // deliberately configured off this page. The other two master actions never could.
      for (const d of controlled.filter((d) => d.class === 'acu_ir')) {
        send(d.id, undefined, 'off');
        log('IR', `${d.display_name} → off`);
      }
    }
    setConfirming(null);
  };

  return (
    <>
      <PageHeader
        title="Spatial Plan & Manual Overrides"
        sub={
          <>
            14 relay nodes
            <InfoHint label="How the ACU is controlled">The ACU is IR-commanded from the HVAC card below — no relay cut.</InfoHint>
          </>
        }
        actions={
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
        }
      />

      <AuditBacklogNote />

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
            <SwitchesListCard simulated={flagSimulated('switch')} />
            <OutletsListCard simulated={flagSimulated('outlet_dual')} />
          </div>
        </div>

        <div className="control-grid__side">
          <IrCommandCenterCard simulated={flagSimulated('acu_ir')} />
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
