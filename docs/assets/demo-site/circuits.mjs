/**
 * The demo building's electrical tree. See `site.mjs` for why this file is here.
 *
 * Data only, no imports — same rule as a real site. `PHASE_MAP` is DERIVED from this, so a
 * branch that names the wrong meter does not fail: it reports the wrong phase total, confidently.
 * `npm run site:check` is what catches that.
 */
export const CIRCUITS = [
  // Nothing measures the incoming supply as a whole, which is why building totals are a SUM of
  // branches rather than one reading — and why an offline branch makes a total incomplete
  // rather than wrong.
  {
    id: 'service_entrance',
    parent_id: null,
    kind: 'service_entrance',
    name: 'Service entrance',
    phase: null,
    meter_device_id: null,
  },
  {
    id: 'main_panel',
    parent_id: 'service_entrance',
    kind: 'panel',
    name: 'Main panel',
    phase: null,
    meter_device_id: null,
  },

  // Three branches over two metered phases. Deliberately NOT one branch per phase: as of this
  // writing `shared/buildLatest.mjs` hardcodes the blue phase's current to `null`, so a site
  // that clamps a meter on blue would declare a reading nothing reports. An example that
  // promises what the code does not deliver is worse than a smaller example.
  {
    id: 'outlets_a',
    parent_id: 'main_panel',
    kind: 'branch',
    name: 'Outlets A',
    phase: 'red',
    meter_device_id: 'mtr_outlets_a',
  },
  {
    id: 'lighting_a',
    parent_id: 'main_panel',
    kind: 'branch',
    name: 'Lighting A',
    phase: 'yellow',
    meter_device_id: 'mtr_lighting_a',
  },
  {
    id: 'hvac',
    parent_id: 'main_panel',
    kind: 'branch',
    name: 'HVAC',
    phase: 'red',
    meter_device_id: 'mtr_hvac',
  },
];
