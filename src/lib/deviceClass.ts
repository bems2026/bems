import type { DeviceClass } from './types';

/**
 * Device classes with a real on/off state concept. Meters and sensors have none at all —
 * a fact distinct from "unknown", which implies a state exists but wasn't reported. Shared
 * across every view that renders a device's state (`DevicesView`, `OutletsView`) so none
 * of them classify a class differently.
 */
export const SWITCHABLE_CLASSES: DeviceClass[] = ['outlet_dual', 'switch', 'acu_ir'];

export function hasSwitchableState(deviceClass: DeviceClass): boolean {
  return SWITCHABLE_CLASSES.includes(deviceClass);
}
