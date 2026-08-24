import { type LucideIcon } from 'lucide-react';
import { DEVICE_CLASS_CATALOG } from './deviceClassCatalog';
import type { DeviceClass } from './types';

/**
 * The single device-class -> icon map. Before Phase O this existed three times, drifting
 * (`automation/ScheduleRow.tsx` and `automation/automationMath.ts` each had their own emoji
 * set, `devices/DevicesView.tsx` had this exact lucide set) — one map, imported everywhere,
 * so a class's icon can only be wrong in one place.
 */
export const CLASS_ICON: Record<DeviceClass, LucideIcon> = Object.fromEntries(
  (Object.keys(DEVICE_CLASS_CATALOG) as DeviceClass[]).map((c) => [c, DEVICE_CLASS_CATALOG[c].icon]),
) as Record<DeviceClass, LucideIcon>;
