import { useMemo } from 'react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useDeviceConfigStore } from '@/stores/deviceConfigStore';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';
import { effectiveConfig } from '@/lib/deviceConfig';
import { summariseShed, type ShedSummary } from '@/lib/shedTiers';

/**
 * What load shedding could reach, for any component that needs to ask.
 *
 * WHY A HOOK RATHER THAN A SECOND COPY OF THE SELECTORS. Two components now need this — the
 * `LoadShedPanel` that edits the tiers and the `DsmThresholdsCard` that arms the mechanism which
 * acts on them — and they sit in different folders on the same page. Assembling the four stores
 * independently in each is how the two would drift into disagreeing about what is sheddable,
 * which is the failure `shedTiers.ts` opens by naming: a UI that shows a different set than the
 * shedder acts on is worse than no UI, because it is believed.
 *
 * The reading of the summary still differs per caller, and should: the panel shows `inertCount`
 * (assigned but not reachable this minute), while the card gates on `shedEligibleCount`
 * (assigned at all). Same data, two questions.
 */
export function useShedSummary(): ShedSummary {
  const devices = useDeviceStore((s) => s.devices);
  const readings = useDeviceStore((s) => s.latestReadings);
  const saved = useDeviceConfigStore((s) => s.saved);
  const draft = useDeviceConfigStore((s) => s.draft);
  const dispatchClasses = useCapabilitiesStore((s) => s.dispatchClasses);

  return useMemo(
    () => summariseShed(devices, (id) => effectiveConfig(draft, saved, id).loadShedGroup, readings, dispatchClasses),
    [devices, draft, saved, readings, dispatchClasses],
  );
}
