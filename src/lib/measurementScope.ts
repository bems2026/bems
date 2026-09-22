import { CAPABILITY_PROFILES } from '@shared/deviceCapabilities.mjs';
import { DEVICE_REGISTRY } from '@shared/registry.mjs';

/**
 * Is this logical device one channel of a multi-channel product, whose voltage is ONE measurement
 * shared with the other clamp? RM-133 found L.O Yellow's voltage dp following C.O Yellow's while its
 * own power and current stood still; for such a channel the voltage is no evidence that it is
 * measuring, and freeze detection keys on power and current alone (`timeseries.detectFrozenRuns`).
 *
 * Decided by the product's channel count in the catalogue, not by `channel`: the bridge gives the
 * single-channel meters `channel: 1` as well.
 */
export function voltageIsShared(device: { capability_profile?: string | null } | null | undefined): boolean {
  const profile = device?.capability_profile ? (CAPABILITY_PROFILES as Record<string, { channels?: number }>)[device.capability_profile] : undefined;
  return (profile?.channels ?? 1) > 1;
}

const SHARED_IDS: ReadonlySet<string> = new Set(
  (DEVICE_REGISTRY as { id: string; capability_profile?: string | null }[]).filter(voltageIsShared).map((d) => d.id),
);

/** The same answer by id, for chart code that holds ids rather than devices. */
export function voltageIsSharedById(id: string): boolean {
  return SHARED_IDS.has(id);
}
