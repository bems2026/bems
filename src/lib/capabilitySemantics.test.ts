/**
 * A diagnostic is not a setting, and the catalogue has always said which is which.
 *
 * THE DEFECT, seen on the running app 2026-09-08. A meter's card rendered:
 *
 *     ⚙  Device settings     net state cloud_net    device state working
 *
 * Both of those are `semantic: 'diagnostic'` in `shared/deviceCapabilities.mjs`. Neither is
 * configuration. And on a meter that row contained NOTHING ELSE — `cz_ct_*` declares none of the
 * five real read-only settings — so the whole row was mislabelled, under a gear icon, in a group
 * whose other members are things like `switch_type` and `random_time`.
 *
 * WHY IT MATTERS RATHER THAN BEING A WORDING NIT. phase28's own migration says what `net_state`
 * is for: *"A device that goes dark having last reported no_net was already in trouble; one that
 * goes dark from cloud_net more likely lost the local segment. That distinction is what decides
 * whether somebody has to drive to the office."* Filing it under settings puts the one field
 * that answers that question in the list a reader skims past.
 *
 * THE CAUSE IS THE ONE RM-050 FIXED IN THE BRIDGE, ONE LAYER UP: a hand-written list standing in
 * for a fact the catalogue already declares. `READ_ONLY_SETTINGS`'s own docblock admitted it —
 * "each installs unattended switching **or reports link state** inside the device" — two
 * different things named in one sentence and rendered in one row.
 *
 * These tests are the guard that makes the mislabelling impossible to reintroduce: membership of
 * either list is checked against `semantic`, so adding `net_state` back to the settings fails
 * here rather than on somebody's screen.
 */
import { describe, it, expect } from 'vitest';
import { CAPABILITY_PROFILES } from '@shared/deviceCapabilities.mjs';
import { READ_ONLY_SETTINGS, OPERATOR_DIAGNOSTICS, capabilitiesOf } from './capabilitySchema';
import type { Device, Reading } from './types';

/** base code -> the semantic every product that declares it agrees on. */
const SEMANTIC_BY_BASE = (() => {
  const m = new Map<string, Set<string>>();
  const profiles = CAPABILITY_PROFILES as unknown as Record<string, { capabilities: ReadonlyArray<{ base?: string; code: string; semantic: string }> }>;
  for (const p of Object.values(profiles)) {
    for (const c of p.capabilities) {
      const base = c.base ?? c.code;
      if (!m.has(base)) m.set(base, new Set());
      m.get(base)!.add(c.semantic);
    }
  }
  return m;
})();

describe('the settings list contains only things the catalogue calls settings', () => {
  it.each(READ_ONLY_SETTINGS)('%s is a setting', (base) => {
    expect([...(SEMANTIC_BY_BASE.get(base) ?? [])]).toEqual(['setting']);
  });

  it('and it no longer carries the two diagnostics it used to', () => {
    // The regression this file exists for. Both were in this list until 2026-09-08.
    expect(READ_ONLY_SETTINGS).not.toContain('net_state');
    expect(READ_ONLY_SETTINGS).not.toContain('device_state');
  });
});

describe('the operator diagnostics are diagnostics, and are curated', () => {
  it.each(OPERATOR_DIAGNOSTICS)('%s is a diagnostic', (base) => {
    expect([...(SEMANTIC_BY_BASE.get(base) ?? [])]).toEqual(['diagnostic']);
  });

  it('deliberately excludes the calibration diagnostics', () => {
    // `semantic` answers "is it a setting or a diagnostic". It cannot answer "is this worth a
    // human's attention", which is a product question — and the coefficients are not. Deriving
    // this list purely from `semantic` would put four calibration constants and a sync flag on
    // every meter card. They stay in the long tail, where phase28 keeps them.
    for (const noise of ['voltage_coe', 'electric_coe', 'power_coe', 'electricity_coe', 'test_bit', 'sync_request']) {
      expect(SEMANTIC_BY_BASE.get(noise)).toEqual(new Set(['diagnostic']));
      expect(OPERATOR_DIAGNOSTICS).not.toContain(noise);
    }
  });

  it('excludes the diagnostics that already have a widget of their own', () => {
    // `fault` has FaultWidget and `power_type` rides with the power alarm. Listing them here
    // would render each twice, which reads as two independent reports of the same fact.
    expect(OPERATOR_DIAGNOSTICS).not.toContain('fault');
    expect(OPERATOR_DIAGNOSTICS).not.toContain('power_type');
  });

  it('no base is in both lists', () => {
    for (const d of OPERATOR_DIAGNOSTICS) expect(READ_ONLY_SETTINGS).not.toContain(d);
  });
});

describe('the resolver carries the semantic through', () => {
  const dev = (over: Partial<Device>): Device => ({
    id: 'x', display_name: 'x', class: 'meter', room: null, dps_map: null, status: 'active', ...over,
  });
  const meter = dev({ id: 'mtr_co_yellow', capability_profile: 'cz_ct_double', channel: 1 });
  const reading: Reading = {
    device_id: 'mtr_co_yellow', ts: new Date().toISOString(), online: true, state: 'on',
    capabilities: { net_state: 'cloud_net', device_state1: 'working' },
  };

  it('reports the declared semantic for a capability', () => {
    // Without this the split above could only be enforced by a test, never by the code.
    const caps = capabilitiesOf(meter, reading);
    expect(caps.meta('net_state')?.semantic).toBe('diagnostic');
    expect(caps.meta('warn_power')?.semantic).toBe('setting');
    expect(caps.meta('cur_power')?.semantic).toBe('instant');
  });

  it('still resolves the channel for a diagnostic, like any other capability', () => {
    // `device_state1` and `device_state2` are two channels of one physical meter, and they carry
    // different vocabularies — 'close' on channel 1, 'idle' on channel 2.
    const ch2 = dev({ id: 'mtr_lo_yellow', capability_profile: 'cz_ct_double', channel: 2 });
    expect(capabilitiesOf(meter, reading).meta('device_state')?.code).toBe('device_state1');
    expect(capabilitiesOf(ch2, reading).meta('device_state')?.code).toBe('device_state2');
  });
});
