import { useMemo } from 'react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useDeviceConfigStore } from '@/stores/deviceConfigStore';
import { useSocketConfigStore } from '@/stores/socketConfigStore';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';
import { effectiveConfig, resolveShedTier } from '@/lib/deviceConfig';
import { summariseShed, type ShedSummary } from '@/lib/shedTiers';

/**
 * What load shedding could reach, for any component that needs to ask.
 *
 * WHY A HOOK RATHER THAN A SECOND COPY OF THE SELECTORS. Two components need this — the
 * `LoadShedPanel` that edits the tiers and the `DsmThresholdsCard` that arms the mechanism which
 * acts on them — and they sit in different folders on the same page. Assembling the stores
 * independently in each is how the two would drift into disagreeing about what is sheddable,
 * which is the failure `shedTiers.ts` opens by naming: a UI that shows a different set than the
 * shedder acts on is worse than no UI, because it is believed.
 *
 * The reading of the summary still differs per caller, and should: the panel shows `inertCount`
 * (assigned but not reachable this minute), while the card gates on eligibility (assigned at
 * all). Same data, two questions.
 *
 * SINCE RM-067 THE UNIT IS A SOCKET. `resolveShedTier` is the single place socket-over-device
 * precedence is decided, and it is applied here so both callers inherit it — a hook that
 * resolved tiers one way while `server/shedPlan.mjs` resolved them another would reintroduce
 * exactly the drift this hook exists to prevent. The device-level value still comes through
 * `effectiveConfig`, so an unsaved edit in the metadata editor shows here as it always did.
 */
export function useShedSummary(): ShedSummary {
  const devices = useDeviceStore((s) => s.devices);
  const readings = useDeviceStore((s) => s.latestReadings);
  const saved = useDeviceConfigStore((s) => s.saved);
  const draft = useDeviceConfigStore((s) => s.draft);
  const socketConfigs = useSocketConfigStore((s) => s.saved);
  const dispatchClasses = useCapabilitiesStore((s) => s.dispatchClasses);

  return useMemo(
    () =>
      summariseShed(
        devices,
        (id, socket) =>
          resolveShedTier(id, socket, { [id]: { loadShedGroup: effectiveConfig(draft, saved, id).loadShedGroup } }, socketConfigs),
        readings,
        dispatchClasses,
      ),
    [devices, draft, saved, socketConfigs, readings, dispatchClasses],
  );
}
