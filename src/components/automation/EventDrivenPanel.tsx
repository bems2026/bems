import { useMemo } from 'react';
import { Plus, Thermometer } from 'lucide-react';
import { temperatureSources } from '@shared/temperatureSources.mjs';
import { roomTargetFloorC } from '@shared/sitePolicy.mjs';
import { SITE } from '@shared/siteConfig.mjs';
import { useAcuRuleStore, CREATING_RULE } from '@/stores/acuRuleStore';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';
import { AcuRuleCard } from './AcuRuleCard';
import { ComingSoonCard } from './ComingSoonCard';
import type { Device } from '@/lib/types';

/**
 * Event-driven automation: rules that fire on what a sensor reads rather than on the clock.
 *
 * Today that is one strategy — closed-loop aircon setpoint control (RM-069). The other two in
 * this category have no field devices at all, and say which ones.
 *
 * THE PAGE IS HONEST ABOUT BEING DORMANT HERE. `acu_main` and `sens_outside_temp` have never
 * been paired to the vendor account (RM-016), so a rule saved on this site will correctly sit at
 * `acu_offline` and do nothing. That is worth building and shipping anyway: the day the devices
 * are paired it starts working with no code change, and until then every rule says exactly what
 * it is waiting for.
 */
export function EventDrivenPanel({ devices }: { devices: Device[] }) {
  const rules = useAcuRuleStore((s) => s.rules);
  const loopState = useAcuRuleStore((s) => s.loopState);
  const status = useAcuRuleStore((s) => s.status);
  const loadError = useAcuRuleStore((s) => s.loadError);
  const save = useAcuRuleStore((s) => s.save);
  const creating = useAcuRuleStore((s) => s.busy[CREATING_RULE]);
  const createError = useAcuRuleStore((s) => s.rowError[CREATING_RULE]);

  const liveFloor = useCapabilitiesStore((s) => s.acuMinRoomTargetC);
  const policySource = useCapabilitiesStore((s) => s.policySource);
  // `null` from the store means "answered, and this site has no policy"; `undefined` means the
  // proxy has not answered, and only that should fall back to the build.
  const roomFloorC = policySource === null ? roomTargetFloorC(SITE.policy) : liveFloor;

  const acus = useMemo(() => devices.filter((d) => d.class === 'acu_ir'), [devices]);
  const sensors = useMemo(() => temperatureSources(devices).map((s: { device: Device }) => s.device), [devices]);

  // `sensors` always contains every aircon, so this is really just "is there an aircon".
  const canAdd = acus.length > 0 && sensors.length > 0;

  const addRule = () => {
    if (!canAdd) return;
    void save({
      acuDeviceId: acus[0].id,
      sensorDeviceId: sensors[0].id,
      // Opens at the building's own policy rather than a number nobody chose. If the site has no
      // policy, 24 is the funded plan's figure and the one the operator already works to.
      targetC: roomFloorC ?? 24,
      deadbandC: 0.5,
      stepC: 1,
      minStepIntervalS: 600,
      manualHoldS: 600,
      days: '1111100',
      windowStart: '08:00',
      windowEnd: '17:00',
      // Off. A rule that starts armed is a rule that acts before anyone has read it.
      enabled: false,
      label: null,
      overrideReason: null,
    });
  };

  return (
    <div className="automation-grid">
      <div className="automation-side">
        <div className="card event-driven__head">
          <div>
            <h3 className="card-title">
              <Thermometer size={14} className="title-icon" aria-hidden="true" />
              Aircon room-temperature control
            </h3>
            <p className="automation-schedules-sub">
              Holds a room at a target by stepping the aircon&apos;s setpoint against what a sensor actually reads.
              It only ever adjusts a unit that is already running — it never switches one on or off.
            </p>
          </div>
          <button type="button" className="schedule-stack__add" onClick={addRule} disabled={!canAdd || creating}>
            <Plus size={14} aria-hidden="true" />
            {creating ? 'Adding…' : 'Add rule'}
          </button>
        </div>

        {/* The only real way to have nothing to offer is to have no aircon. An `acu_ir` device
            reports its own return-air temperature, so any site with one always has at least one
            sensor to close on — itself. Spelling out a second, unreachable case would be copy
            nobody can ever see. */}
        {!canAdd && (
          <p className="schedule-stack__empty">
            This site has no IR-commandable aircon in its registry, so there is nothing to control.
          </p>
        )}

        {loadError && (
          <p className="schedule-stack__error" role="alert">
            {loadError}
          </p>
        )}
        {createError && (
          <p className="schedule-stack__error" role="alert">
            {createError}
          </p>
        )}

        {status === 'loading' && rules.length === 0 ? (
          <p className="section-placeholder">Reading the aircon rules…</p>
        ) : rules.length === 0 ? (
          canAdd && (
            <p className="schedule-stack__empty">
              No rules yet. Add one and arm it; until it is armed the controller ignores it entirely.
            </p>
          )
        ) : (
          rules.map((rule) => (
            <AcuRuleCard key={rule.id} rule={rule} state={loopState[rule.id]} acus={acus} sensors={sensors} roomFloorC={roomFloorC ?? null} />
          ))
        )}
      </div>

      <div className="automation-side">
        <ComingSoonCard
          title="Occupancy-driven lighting"
          what="Switch a lighting circuit on when its area is occupied and off when it is not, instead of on a fixed timetable."
          blockedOn="an occupancy sensor. None exists in the registry or the vendor project, and whether any is being bought is still an open procurement question."
          roadmapId="ROADMAP §5 Q11"
        />
        <ComingSoonCard
          title="CO₂-driven ventilation"
          what="Raise ventilation when measured CO₂ climbs, and let it fall again as the room empties."
          blockedOn="a CO₂ sensor. There is none in the registry and no such capability in the device catalogue."
        />
      </div>
    </div>
  );
}
