import { DEVICE_CLASS_CATALOG } from './deviceClassCatalog';
import type { DeviceConfig } from './deviceConfig';
import type { Device } from './types';

/**
 * What a device is *for*, declared per device rather than inferred from its class.
 *
 * The class catalog answers "what can a device of this kind do"; that is a fact about the
 * hardware. This answers "what is this particular device used for here", which is a decision
 * about the site — and the two genuinely differ. Two identical relays can be a lighting
 * circuit that should never be scheduled and a heater that should. A metered outlet feeding
 * nothing worth charting can be dropped from the power pages without anyone editing code.
 *
 * The prompt for this was noticing that light switches have control but no metering, and that
 * expressing that as "Analytics filters out the `switch` class" put a site decision inside a
 * page. It belongs in configuration, next to room and load-shed group, where an operator can
 * change it.
 */
export const DEVICE_FUNCTIONS = ['control', 'monitoring', 'scheduling'] as const;
export type DeviceFunction = (typeof DEVICE_FUNCTIONS)[number];

export const FUNCTION_OPTIONS: ReadonlyArray<{ value: DeviceFunction; label: string; hint: string }> = [
  { value: 'control', label: 'Control', hint: 'Appears on the Control page and can be switched.' },
  { value: 'monitoring', label: 'Monitoring', hint: 'Appears on Analytics, if it reports power at all.' },
  { value: 'scheduling', label: 'Scheduling', hint: 'Can be given a schedule and shed automatically.' },
];

/**
 * Per-class defaults, chosen to reproduce today's page membership exactly so that making this
 * configurable cannot quietly move a device onto or off a page. `deviceFunctions.test.ts`
 * pins each one to the page it currently governs.
 */
export const DEFAULT_FUNCTIONS: Record<keyof typeof DEVICE_CLASS_CATALOG, DeviceFunction[]> = {
  outlet_dual: ['control', 'monitoring', 'scheduling'],
  switch: ['control', 'scheduling'],
  meter: ['monitoring'],
  acu_ir: ['control', 'scheduling'],
  sensor_temp_humidity: ['monitoring'],
};

/**
 * Unknown values are dropped rather than thrown on or passed through — the same rule
 * `deviceConfig.coerceCategory` follows, and for the same reason: the only ways a bad value
 * arrives are a stale draft or a hand-edited row, and a dropped value beats a 400 from the
 * column's CHECK constraint.
 *
 * `null` and an empty array are deliberately different answers. `null` is "nobody has said",
 * which falls through to the class default; `[]` is "somebody said none", which is honoured.
 */
export function coerceFunctions(value: readonly string[] | null | undefined): DeviceFunction[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;
  return DEVICE_FUNCTIONS.filter((f) => value.includes(f));
}

/** The functions in effect for a device: its own if configured, otherwise its class's. */
export function functionsOf(device: Device, config: DeviceConfig | undefined): DeviceFunction[] {
  const configured = config?.functions;
  if (configured !== null && configured !== undefined) return configured;
  return DEFAULT_FUNCTIONS[device.class] ?? [];
}

export function hasFunction(device: Device, config: DeviceConfig | undefined, fn: DeviceFunction): boolean {
  return functionsOf(device, config).includes(fn);
}

/**
 * Splits a device list into those serving a function and those not — returning *both* halves
 * on purpose.
 *
 * A page that filters silently is indistinguishable from a page with a bug: the whole reason
 * light switches were absent from Analytics looked like an omission is that nothing said they
 * had been left out deliberately. Handing back `excluded` lets a page account for every
 * device it was given.
 */
export function partitionByFunction(
  devices: Device[],
  configs: Record<string, DeviceConfig>,
  fn: DeviceFunction,
): { included: Device[]; excluded: Device[] } {
  const included: Device[] = [];
  const excluded: Device[] = [];
  for (const d of devices) {
    (hasFunction(d, configs[d.id], fn) ? included : excluded).push(d);
  }
  return { included, excluded };
}
