import { describe, it, expect } from 'vitest';
import { capabilitiesOf, declaresAll, faultFlags } from './capabilitySchema';
import type { Device, Reading } from './types';

const outlet: Device = {
  id: 'co3', display_name: 'Outlet 3', class: 'outlet_dual', room: null,
  dps_map: 'type_b', capability_profile: 'pc_outlet', status: 'active',
};
const meterCh1: Device = {
  id: 'mtr_co_yellow', display_name: 'C.O Yellow', class: 'meter', room: null,
  dps_map: 'type_a', capability_profile: 'cz_ct_double', channel: 1, status: 'active',
};
const meterCh2: Device = {
  id: 'mtr_lo_yellow', display_name: 'L.O Yellow', class: 'meter', room: null,
  dps_map: 'type_c', capability_profile: 'cz_ct_double', channel: 2, status: 'active',
};
const irBlaster: Device = {
  id: 'acu_main', display_name: 'CARE ACU IR', class: 'acu_ir', room: null,
  dps_map: null, capability_profile: null, status: 'active',
};

const reading = (capabilities?: Reading['capabilities']): Reading => ({
  device_id: 'x', ts: '2026-09-02T18:00:00+08:00', online: true, state: null, capabilities,
});

describe('capabilitiesOf', () => {
  it('resolves the channel suffix so components never see one', () => {
    // The whole reason this module exists. One physical meter, two logical devices; asking for
    // `cur_power` must give each its OWN channel, or two branch circuits swap loads on screen.
    const both = reading({ cur_power1: 998.4, cur_power2: 0, cur_voltage1: 225.4, cur_voltage2: 225.6 });
    expect(capabilitiesOf(meterCh1, both).value('cur_power')).toBe(998.4);
    expect(capabilitiesOf(meterCh2, both).value('cur_power')).toBe(0);
    expect(capabilitiesOf(meterCh1, both).value('cur_voltage')).toBe(225.4);
    expect(capabilitiesOf(meterCh2, both).value('cur_voltage')).toBe(225.6);
  });

  it('hides the other channel entirely, rather than merely preferring its own', () => {
    const caps = capabilitiesOf(meterCh2, reading({ cur_power1: 998.4 }));
    expect(caps.value('cur_power')).toBeUndefined();
    expect(caps.meta('cur_power')?.code).toBe('cur_power2');
  });

  it('separates what the hardware CAN do from what the reading currently carries', () => {
    // A widget mounts on the first and shows a dash for the second. Mounting on the value would
    // make controls appear and vanish as packets came and went.
    const caps = capabilitiesOf(outlet, reading({}));
    expect(caps.declares('child_lock')).toBe(true);
    expect(caps.value('child_lock')).toBeUndefined();
  });

  it('never coerces a missing value, and preserves a real zero', () => {
    const caps = capabilitiesOf(outlet, reading({ cur_power: 0 }));
    expect(caps.value('cur_power')).toBe(0);
    expect(caps.value('cur_voltage')).toBeUndefined();
  });

  it('returns a safe empty result for a device with no dps at all', () => {
    // The IR blaster and the ambient sensor are read from flow context. Asking must not throw.
    const caps = capabilitiesOf(irBlaster, reading());
    expect(caps.declares('switch_1')).toBe(false);
    expect(caps.value('switch_1')).toBeUndefined();
    expect(caps.meta('switch_1')).toBeNull();
    expect(caps.bases).toEqual([]);
  });

  it('is reference-stable for profile-less devices, so it is safe inside a selector', () => {
    // A fresh object per call fails React 19's useSyncExternalStore cache check and can loop —
    // the trap LightingMatrixCard documents.
    expect(capabilitiesOf(irBlaster, reading())).toBe(capabilitiesOf(undefined, undefined));
  });

  it('survives a device or reading that is missing entirely', () => {
    expect(capabilitiesOf(undefined, undefined).declares('cur_power')).toBe(false);
    expect(capabilitiesOf(outlet, undefined).value('cur_power')).toBeUndefined();
  });

  it('carries the vendor bounds a control needs, rather than inventing them', () => {
    // The anomaly-threshold slider must be bounded by the device's own limits, not by a
    // guess that would let an operator write a value the hardware rejects.
    const meta = capabilitiesOf(meterCh1, reading()).meta('warn_power');
    expect(meta).toMatchObject({ code: 'warn_power1', unit: 'W', min: 200, max: 50000, step: 100, writable: true });
  });

  it('reports the units the values are actually in, after scaling', () => {
    // The outlet reports current in mA at scale 0 and the meter in A at scale 3; both arrive
    // as amps, and a card that labelled one of them mA would be wrong by a thousand.
    expect(capabilitiesOf(outlet, reading()).meta('cur_current')?.unit).toBe('A');
    expect(capabilitiesOf(meterCh1, reading()).meta('cur_current')?.unit).toBe('A');
    expect(capabilitiesOf(meterCh1, reading()).meta('today_acc_energy')?.unit).toBe('kWh');
  });

  it('marks the refused settings unwritable even though the vendor allows them', () => {
    // relay_status, cycle_time and switch_inching install unattended switching inside the
    // device, where nothing here can see or override it. They are readable, never writable.
    const caps = capabilitiesOf(outlet, reading());
    expect(caps.meta('relay_status')?.writable).toBe(false);
    expect(caps.meta('cycle_time')?.writable).toBe(false);
    expect(caps.meta('child_lock')?.writable).toBe(true);
    expect(caps.meta('switch_1')?.writable).toBe(true);
  });
});

describe('declaresAll', () => {
  it('is true only when the product offers every capability asked for', () => {
    const caps = capabilitiesOf(outlet, reading());
    expect(declaresAll(caps, 'cur_power', 'cur_voltage')).toBe(true);
    expect(declaresAll(caps, 'cur_power', 'today_acc_energy')).toBe(false);
    expect(declaresAll(caps)).toBe(true);
  });
});

describe('faultFlags', () => {
  it('names the bits that are set', () => {
    // Bits low to high: ov_cr, ov_vol, ov_pwr, ls_cr, ls_vol, ls_pow.
    const caps = capabilitiesOf(outlet, reading({ fault: 0b000101 }));
    expect(faultFlags(caps)).toEqual(['ov_cr', 'ov_pwr']);
  });

  it('distinguishes a healthy device from one that cannot report faults', () => {
    // Both give [], and only `declares` tells them apart — "no faults" and "cannot tell" are
    // different claims and only one is reassuring.
    expect(faultFlags(capabilitiesOf(outlet, reading({ fault: 0 })))).toEqual([]);
    expect(faultFlags(capabilitiesOf(meterCh1, reading()))).toEqual([]);
    expect(capabilitiesOf(outlet, reading({ fault: 0 })).declares('fault')).toBe(true);
    expect(capabilitiesOf(meterCh1, reading()).declares('fault')).toBe(false);
  });
});
