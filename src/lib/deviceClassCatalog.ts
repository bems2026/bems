import { Plug, Lightbulb, Gauge, Snowflake, Thermometer, type LucideIcon } from 'lucide-react';
import type { DeviceClass } from './types';

/**
 * One table describing what each device class *is*, replacing six independent per-class
 * tables that each answered part of the question and could each drift alone:
 *
 *   deviceClass.SWITCHABLE_CLASSES      which classes have an on/off state
 *   deviceIcons.CLASS_ICON              which icon to draw
 *   DevicesView.CLASS_ORDER             what order to list them in
 *   DevicesView.CLASS_FILTER_LABEL      the plural name on a filter chip
 *   DevicesView.CLASS_PILL_LABEL        the singular name on a row pill
 *   AutomationPage.FILTER_CLASS         which chips the schedule filter offers
 *   AnalyticsPage.Scope                 a hardcoded 'branches' | 'outlets' union
 *
 * `deviceIcons.ts` already made this argument once for icons alone — that map existed three
 * times and drifted, and consolidating it meant a class's icon could only be wrong in one
 * place. This is the same argument for everything else a class needs to be known by.
 *
 * The point is modularity: adding a device class should be one entry here plus whatever the
 * type checker then demands, not a hunt through six files, five of which fail *silently* by
 * rendering nothing rather than by erroring.
 *
 * NOT consolidated here, deliberately: `server/dispatchLight.mjs`'s `DISPATCH_CLASSES`. That
 * answers a different question — which classes the *deployment* can currently drive — and it
 * is server-side, changes with the bridge rather than the UI, and is already surfaced
 * separately through `capabilitiesStore`. Folding it in would conflate what a class is with
 * what this particular Pi can reach today.
 */
export interface DeviceClassSpec {
  /** Plural, for section headings and filter chips: "Outlets". */
  label: string;
  /** Singular and lowercase, for the pill on a device row: "outlet". */
  pill: string;
  icon: LucideIcon;
  /**
   * Has a real on/off state. Distinct from "unknown": a meter has no state concept at all,
   * where unknown implies a state exists but was not reported. Drives whether a class can be
   * toggled, scheduled, and load-shed.
   */
  switchable: boolean;
  /** Reports voltage/current/power, and so earns a chart series and a per-source card. */
  metered: boolean;
  /**
   * Which Analytics grouping the class belongs to, or `null` when it has no metered series
   * to group. Replaces the hardcoded `'branches' | 'outlets'` union, so a new metered class
   * can introduce its own group without editing the page.
   */
  analyticsGroup: string | null;
}

export const DEVICE_CLASS_CATALOG: Record<DeviceClass, DeviceClassSpec> = {
  outlet_dual: { label: 'Outlets', pill: 'outlet', icon: Plug, switchable: true, metered: true, analyticsGroup: 'outlets' },
  switch: { label: 'Lighting Switches', pill: 'switch', icon: Lightbulb, switchable: true, metered: false, analyticsGroup: null },
  meter: { label: 'Branch Meters', pill: 'meter', icon: Gauge, switchable: false, metered: true, analyticsGroup: 'branches' },
  acu_ir: { label: 'Air Conditioning', pill: 'aircon', icon: Snowflake, switchable: true, metered: false, analyticsGroup: null },
  sensor_temp_humidity: { label: 'Sensors', pill: 'sensor', icon: Thermometer, switchable: false, metered: false, analyticsGroup: null },
};

/**
 * Display order. Kept as its own list rather than relying on object key order, which is a
 * language guarantee about insertion but not an obvious statement of intent to a reader.
 */
export const DEVICE_CLASS_ORDER: DeviceClass[] = ['outlet_dual', 'switch', 'meter', 'acu_ir', 'sensor_temp_humidity'];

/** Every class whose spec has the given boolean flag set, in display order. */
export function classesWhere(flag: 'switchable' | 'metered'): DeviceClass[] {
  return DEVICE_CLASS_ORDER.filter((c) => DEVICE_CLASS_CATALOG[c][flag]);
}

/**
 * Analytics group order — feeders before the loads they feed, which is why this is not just
 * `DEVICE_CLASS_ORDER` reused. The Devices page lists outlets first (there are seven of them
 * and they are what people look for); Analytics reads top-down through the electrical
 * hierarchy instead. Two real orderings for two real purposes.
 *
 * A group belongs to the group, not to any one class, so it is declared once here rather than
 * as a rank repeated on every class's spec. `deviceClassCatalog.test.ts` asserts that every
 * class's `analyticsGroup` appears in this list, so the two cannot drift apart.
 */
export const ANALYTICS_GROUP_ORDER: string[] = ['branches', 'outlets'];

/**
 * The distinct Analytics groups that actually have a class in them — what the scope toggle
 * should offer. Derived from the catalog rather than listed, so a new metered class shows up
 * on the page without anyone remembering to add it, but ordered by the list above.
 */
export function analyticsGroups(): string[] {
  const present = new Set(
    DEVICE_CLASS_ORDER.map((c) => DEVICE_CLASS_CATALOG[c].analyticsGroup).filter((g): g is string => g !== null),
  );
  return ANALYTICS_GROUP_ORDER.filter((g) => present.has(g));
}
