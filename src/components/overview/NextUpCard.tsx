import { CalendarClock } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useContextStore } from '@/stores/contextStore';
import { nextUpSchedules, armedScheduleCount } from '@/components/automation/automationMath';
import { CLASS_ICON } from '@/lib/deviceIcons';

/**
 * v4's "Active Schedules" card, retitled "Next up" per the Phase M plan — v3's
 * chronologically-sorted "what happens next" is a more useful frame than v4's unsorted
 * "what's currently armed" (see `automationMath.ts`'s `nextUpSchedules`).
 *
 * Wired to real data now that M4's `POST /api/context` and the Automation page that writes
 * to it both exist. Reads `saved` only, never `draft` — an Automation edit that hasn't been
 * written yet isn't a real schedule Node-RED's subflow would act on.
 */
export function NextUpCard() {
  const devices = useDeviceStore((s) => s.devices);
  const saved = useContextStore((s) => s.saved);
  const entries = nextUpSchedules(devices, saved);
  const armed = armedScheduleCount(devices, saved);

  return (
    <div className="card">
      <div className="card-head">
        <h3 className="card-title">
          <CalendarClock size={14} className="title-icon" aria-hidden="true" />
          Next up
        </h3>
        <span className="card-sub">{armed > 0 ? `${armed} armed · ` : ''}Node-RED global context</span>
      </div>
      {entries.length === 0 ? (
        <p className="section-placeholder">No schedules armed — No data</p>
      ) : (
        entries.map((e) => {
          const Icon = CLASS_ICON[e.deviceClass];
          return (
            <div className="next-up-row" key={e.deviceId}>
              <Icon size={14} aria-hidden="true" />
              <p className="next-up-name">{e.name}</p>
              <span className="next-up-window mono">{e.time}</span>
            </div>
          );
        })
      )}
    </div>
  );
}
