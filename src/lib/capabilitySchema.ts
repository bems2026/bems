/**
 * What a device can do, resolved for the frontend.
 *
 * The catalogue itself lives in `shared/deviceCapabilities.mjs` and is imported rather than
 * mirrored — the bridge generates its Node-RED parsers from that same file, so a second copy
 * here would be free to disagree with the thing producing the data. (`lib/timing.ts` mirrors and
 * is held by a test; that is the older pattern and the weaker one. `lib/dsm.ts` re-exports from
 * `@shared`, which is this.)
 *
 * WHAT THIS ADDS over the raw catalogue is the channel resolution, and it is the whole point.
 * One physical dual-channel CT meter is TWO logical devices in the registry, and each reads only
 * its own suffix — `cur_power1` for `mtr_co_yellow`, `cur_power2` for `mtr_lo_yellow`. A
 * component that tested for `cur_power` by hand would render nothing for either, and one that
 * guessed the suffix would show a branch circuit its neighbour's load. So everything below is
 * keyed by BASE code, with the suffix already resolved for the device being asked about, and no
 * component ever needs to know a channel exists.
 */
import { CAPABILITY_PROFILES, canonicalUnitFor } from '@shared/deviceCapabilities.mjs';
import type { CapabilityValue, Device, Reading } from './types';

/** The declared shape of one capability, as the vendor's device model describes it. */
export interface CapabilityMeta {
  /** The vendor code for THIS device — channel suffix included, e.g. `cur_power2`. */
  code: string;
  /** The channel-agnostic name components ask for, e.g. `cur_power`. */
  base: string;
  kind: 'bool' | 'value' | 'enum' | 'string' | 'bitmap';
  /** Canonical unit after scaling: `V`, `A`, `W`, `kWh`, `s`, or `''` for dimensionless. */
  unit: string | null;
  min?: number;
  max?: number;
  step?: number;
  range?: string[];
  /** Bit labels, `fault` only. */
  bits?: string[];
  /**
   * Whether THIS SYSTEM will write it — deliberately narrower than the vendor's own `rw`.
   * `relay_status`, `switch_inching`, `cycle_time` and `random_time` are vendor-writable and
   * refused here: each installs unattended switching inside the device, where the Supabase
   * scheduler and the command audit trail cannot see or override it.
   */
  writable: boolean;
}

/** A device's capabilities, with its channel already resolved. */
export interface ResolvedCapabilities {
  profileId: string | null;
  channel: 1 | 2;
  /** Whether the device's PRODUCT declares this capability — true even before a value arrives. */
  declares(base: string): boolean;
  /** The declaration, or `null` if this product has no such capability. */
  meta(base: string): CapabilityMeta | null;
  /** The value from the reading, or `undefined`. Absent is absent — never coerced to 0. */
  value(base: string): CapabilityValue | undefined;
  /** Every base code this product declares, in catalogue order. */
  bases: string[];
}

interface RawCapability {
  code: string;
  base: string;
  dp: number;
  access: 'ro' | 'rw';
  kind: CapabilityMeta['kind'];
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  range?: string[];
  bits?: string[];
  writable: boolean;
  channel: 1 | 2 | null;
}

interface RawProfile {
  id: string;
  label: string;
  standard_instruction: boolean;
  channels: number;
  capabilities: RawCapability[];
}

const PROFILES = CAPABILITY_PROFILES as unknown as Record<string, RawProfile>;

/** Nothing declared, nothing carried. Shared so it is reference-stable inside selectors. */
const NO_CAPABILITIES: ResolvedCapabilities = {
  profileId: null,
  channel: 1,
  declares: () => false,
  meta: () => null,
  value: () => undefined,
  bases: [],
};

/**
 * Resolve one device's capabilities against a reading.
 *
 * `declares` reads the PRODUCT and `value` reads the READING, and keeping them separate is what
 * makes the UI stable: a widget mounts because the hardware has the feature, and shows `—` until
 * a value arrives. Mounting on the value instead would make controls appear and vanish as
 * packets came and went, which is worse than a dash.
 *
 * Returns a shared empty object for a device with no profile, so this is safe to call in a
 * zustand selector — a fresh object each call would fail React's `useSyncExternalStore` cache
 * check, which is the loop `LightingMatrixCard` documents.
 */
export function capabilitiesOf(device: Device | undefined, reading: Reading | undefined): ResolvedCapabilities {
  const profile = device?.capability_profile ? PROFILES[device.capability_profile] : undefined;
  if (!profile) return NO_CAPABILITIES;

  const channel = (device?.channel ?? 1) as 1 | 2;
  const values = reading?.capabilities;

  // THE CHANNEL RESOLUTION, in one line. Device-wide capabilities (no channel) plus this
  // device's own; the other channel's are excluded entirely rather than merely deprioritised,
  // so `cur_power` cannot fall through to a sibling branch circuit's reading. Each surviving
  // capability already carries its own suffixed `code`, so nothing downstream reconstructs one.
  const mine = profile.capabilities.filter((c) => c.channel == null || c.channel === channel);
  const byBase = new Map(mine.map((c) => [c.base, c]));

  const metaFor = (base: string): CapabilityMeta | null => {
    const raw = byBase.get(base);
    if (!raw) return null;
    return {
      code: raw.code,
      base: raw.base,
      kind: raw.kind,
      unit: canonicalUnitFor(raw) as string | null,
      min: raw.min,
      max: raw.max,
      step: raw.step,
      range: raw.range,
      bits: raw.bits,
      writable: raw.writable,
    };
  };

  return {
    profileId: profile.id,
    channel,
    declares: (base) => byBase.has(base),
    meta: metaFor,
    value: (base) => {
      const raw = byBase.get(base);
      if (!raw) return undefined;
      return values?.[raw.code];
    },
    bases: mine.map((c) => c.base),
  };
}

/** Does this device's product offer every one of these capabilities? */
export function declaresAll(caps: ResolvedCapabilities, ...bases: string[]): boolean {
  return bases.every((b) => caps.declares(b));
}

/**
 * Decode the outlet's `fault` bitmap into the bits that are actually set.
 *
 * Returns `[]` for a healthy device and for one that does not report faults at all — the caller
 * distinguishes those with `declares('fault')`, because "no faults" and "cannot tell" are
 * different claims and only one of them is reassuring.
 */
export function faultFlags(caps: ResolvedCapabilities): string[] {
  const meta = caps.meta('fault');
  const value = caps.value('fault');
  if (!meta?.bits || typeof value !== 'number') return [];
  return meta.bits.filter((_, i) => (value & (1 << i)) !== 0);
}

/**
 * The settings this system reads and deliberately does not write.
 *
 * Every one of these is `writable: false` in the catalogue, and each installs unattended
 * switching or reports link state INSIDE the device — where the Supabase scheduler and the
 * command audit trail cannot see or override it. Surfacing them matters precisely because they
 * are invisible otherwise: an operator wondering why a light turned itself off has nowhere else
 * to look.
 *
 * A list rather than a filter on `writable`, because it also fixes the ORDER they read in, and
 * because not every unwritable capability belongs in this group — `cur_power` is unwritable too.
 */
export const READ_ONLY_SETTINGS = [
  'relay_status',
  'switch_type',
  'switch_inching',
  'cycle_time',
  'random_time',
  'net_state',
  'device_state',
] as const;
