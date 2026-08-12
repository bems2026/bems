import { Plug, Lightbulb, Gauge, Snowflake, Thermometer, type LucideIcon } from 'lucide-react';
import type { DeviceClass } from './types';

/**
 * The single device-class -> icon map. Before Phase O this existed three times, drifting
 * (`automation/ScheduleRow.tsx` and `automation/automationMath.ts` each had their own emoji
 * set, `devices/DevicesView.tsx` had this exact lucide set) — one map, imported everywhere,
 * so a class's icon can only be wrong in one place.
 */
export const CLASS_ICON: Record<DeviceClass, LucideIcon> = {
  outlet_dual: Plug,
  switch: Lightbulb,
  meter: Gauge,
  acu_ir: Snowflake,
  sensor_temp_humidity: Thermometer,
};
