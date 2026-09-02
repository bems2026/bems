import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import { DeviceCard } from './DeviceCard';
import { useDeviceStore } from '@/stores/deviceStore';
import type { Device, Reading } from '@/lib/types';

const device = (id: string, name: string, cls: Device['class'], extra: Partial<Device> = {}): Device => ({
  id, display_name: name, class: cls, room: null, dps_map: null, status: 'active', ...extra,
});

const outlet = device('co3', 'Outlet 3', 'outlet_dual', { capability_profile: 'pc_outlet', branch_circuit: 'C.O Yellow' });
const light = device('l1', 'Light Switch 1', 'switch', { capability_profile: 'tdq_switch' });
const meter1 = device('mtr_co_yellow', 'C.O Yellow', 'meter', { capability_profile: 'cz_ct_double', channel: 1 });
const meter2 = device('mtr_lo_yellow', 'L.O Yellow', 'meter', { capability_profile: 'cz_ct_double', channel: 2 });
const singleMeter = device('mtr_lo_red', 'L.O Red', 'meter', { capability_profile: 'cz_ct_single', channel: 1 });
const irBlaster = device('acu_main', 'CARE ACU IR', 'acu_ir', { capability_profile: null });

const reading = (id: string, capabilities?: Reading['capabilities'], over: Partial<Reading> = {}): Reading => ({
  device_id: id, ts: new Date().toISOString(), online: true, state: 'on', capabilities, ...over,
});

const mount = (d: Device, devices: Device[], readings: Record<string, Reading>) => {
  useDeviceStore.setState({ devices, latestReadings: readings, totals: null, history: {} });
  return render(<DeviceCard device={d} />);
};

afterEach(() => {
  cleanup();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
});

describe('DeviceCard — what it mounts', () => {
  it('renders an outlet with the capabilities its product actually has', () => {
    mount(outlet, [outlet], {
      co3: reading('co3', {
        switch_1: true, switch_2: false, cur_power: 74.8, cur_voltage: 227, cur_current: 0.526,
        child_lock: false, countdown_1: 0, countdown_2: 0, fault: 0, relay_status: 'memory',
      }),
    });
    expect(screen.getByText('Sockets')).toBeInTheDocument();
    expect(screen.getByText('Child lock')).toBeInTheDocument();
    expect(screen.getByText('unlocked')).toBeInTheDocument();
    expect(screen.getByText('Countdown')).toBeInTheDocument();
    expect(screen.getByText('Faults')).toBeInTheDocument();
    expect(screen.getByText('none reported')).toBeInTheDocument();
  });

  it('does not render a capability the device does not have', () => {
    // The resilience requirement, stated as absence rather than as a caught error. A light
    // switch has no metering, no child lock, no fault bitmap — and no empty boxes for them.
    mount(light, [light], { l1: reading('l1', { switch_1: true, countdown_1: 0, relay_status: 'off' }) });
    expect(screen.getByText('Relay')).toBeInTheDocument();
    expect(screen.queryByText('Child lock')).not.toBeInTheDocument();
    expect(screen.queryByText('Faults')).not.toBeInTheDocument();
    expect(screen.queryByText('Power alarm')).not.toBeInTheDocument();
    expect(screen.queryByText('Energy')).not.toBeInTheDocument();
  });

  it('mounts a widget before its first value arrives, showing a dash rather than vanishing', () => {
    // Mounting on the VALUE would make controls appear and disappear as packets came and went.
    mount(outlet, [outlet], { co3: reading('co3', {}) });
    const lock = screen.getByText('Child lock').closest('.device-card__row');
    expect(within(lock as HTMLElement).getByText('—')).toBeInTheDocument();
  });

  it('renders a device with no data points at all without crashing', () => {
    // The IR blaster and the ambient sensor are read from flow context, not dps.
    mount(irBlaster, [irBlaster], { acu_main: reading('acu_main') });
    expect(screen.getByText('CARE ACU IR')).toBeInTheDocument();
    expect(screen.getByText('This device reports no data points.')).toBeInTheDocument();
  });

  it('survives a reading that carries an unknown capability code', () => {
    // A firmware update adding a dp must not break the card for everything else on it.
    mount(outlet, [outlet], { co3: reading('co3', { cur_power: 12, brand_new_code: 'surprise' }) });
    expect(screen.getByText('Sockets')).toBeInTheDocument();
    expect(screen.queryByText('surprise')).not.toBeInTheDocument();
  });

  it('survives having no reading at all', () => {
    mount(outlet, [outlet], {});
    expect(screen.getByText('No reading yet.')).toBeInTheDocument();
    expect(screen.getByText('Sockets')).toBeInTheDocument();
  });
});

describe('DeviceCard — values', () => {
  it('shows live telemetry in the units the values are actually in', () => {
    mount(outlet, [outlet], { co3: reading('co3', { cur_power: 74.8, cur_voltage: 227, cur_current: 0.526 }) });
    expect(screen.getByText('74.8')).toBeInTheDocument();
    expect(screen.getByText('227.0')).toBeInTheDocument();
    expect(screen.getByText('0.526')).toBeInTheDocument();
  });

  it("shows the meter's own energy counters, and the combined figure for a dual-channel device", () => {
    mount(meter1, [meter1, meter2], {
      mtr_co_yellow: reading('mtr_co_yellow', {
        today_acc_energy1: 8.64, total_energy1: 29483.156, all_energy: 40422.546,
      }),
    });
    expect(screen.getByText(/today 8\.640 kWh/)).toBeInTheDocument();
    expect(screen.getByText(/lifetime 29483\.2 kWh/)).toBeInTheDocument();
    expect(screen.getByText(/both channels 40422\.5 kWh/)).toBeInTheDocument();
  });

  it("shows the power alarm bounded by the vendor's own limits, and the device's own verdict", () => {
    mount(singleMeter, [singleMeter], {
      mtr_lo_red: reading('mtr_lo_red', { warn_power1: 500, power_type1: 'normal' }),
    });
    const slider = screen.getByLabelText('Over-power alarm threshold') as HTMLInputElement;
    expect(slider.min).toBe('200');
    expect(slider.max).toBe('50000');
    expect(slider.step).toBe('100');
    // Inert until a capability command verb exists — rendering it live and dropping the write
    // would be worse than rendering it disabled with the reason on the title.
    expect(slider.disabled).toBe(true);
    expect(screen.getByText('500 W')).toBeInTheDocument();
    expect(screen.getByText('normal')).toBeInTheDocument();
  });

  it('names the fault bits that are set', () => {
    mount(outlet, [outlet], { co3: reading('co3', { fault: 0b000101 }) });
    expect(screen.getByText('ov_cr')).toBeInTheDocument();
    expect(screen.getByText('ov_pwr')).toBeInTheDocument();
    expect(screen.queryByText('ov_vol')).not.toBeInTheDocument();
  });

  it('shows the settings it deliberately will not write', () => {
    // An operator wondering why a light turned itself off has nowhere else to look: these
    // install unattended switching inside the device, invisible to the scheduler and the audit.
    mount(light, [light], {
      l1: reading('l1', { relay_status: 'memory', switch_type: 'flip', switch_inching: 'AAAC' }),
    });
    const row = screen.getByText('Device settings').closest('.device-card__row') as HTMLElement;
    expect(row.textContent).toContain('memory');
    expect(row.textContent).toContain('flip');
    expect(row.textContent).toContain('AAAC');
  });
});

describe('DeviceCard — dual-channel meters', () => {
  it('offers a tab per channel and shows each channel its own readings', () => {
    mount(meter1, [meter1, meter2], {
      mtr_co_yellow: reading('mtr_co_yellow', { cur_power1: 998.4, cur_voltage1: 225.4, cur_current1: 4.4 }),
      mtr_lo_yellow: reading('mtr_lo_yellow', { cur_power2: 0, cur_voltage2: 225.6, cur_current2: 0 }),
    });
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(screen.getByText('998.4')).toBeInTheDocument();

    fireEvent.click(tabs[1]);
    expect(screen.getByText('225.6')).toBeInTheDocument();
    expect(screen.queryByText('998.4')).not.toBeInTheDocument();
  });

  it('shows no tabs for a single-channel meter', () => {
    mount(singleMeter, [singleMeter], { mtr_lo_red: reading('mtr_lo_red', { cur_power1: 27.5 }) });
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('refuses to pair channels when more than one candidate exists', () => {
    // The registry carries no physical-device id to join on, deliberately — device identity is
    // the LOGICAL meter. With a second dual-channel meter on site the pairing is ambiguous, and
    // guessing would put two unrelated branch circuits under one card. Falling back to a single
    // channel is merely less convenient.
    const other = device('mtr_other', 'Other Yellow', 'meter', { capability_profile: 'cz_ct_double', channel: 2 });
    mount(meter1, [meter1, meter2, other], { mtr_co_yellow: reading('mtr_co_yellow', { cur_power1: 1 }) });
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });
});

describe('DeviceCard — switching subject without closing', () => {
  it('follows the device prop when another device is opened while one is already open', () => {
    // FOUND IN A BROWSER, not by a test. Opening Details on a second device re-uses the same
    // component instance, and `useState(device)` initialises once and never resyncs — so the
    // card rendered the PREVIOUS device's body under the new device's tabs. The screenshot
    // showed "CARE ACU IR" titled above C.O Yellow's two channels.
    const { rerender } = mount(meter1, [meter1, meter2, outlet], {
      mtr_co_yellow: reading('mtr_co_yellow', { cur_power1: 998.4 }),
      co3: reading('co3', { cur_power: 74.8, cur_voltage: 227 }),
    });
    expect(screen.getByText('C.O Yellow')).toBeInTheDocument();

    rerender(<DeviceCard device={outlet} />);
    // The TITLE, not any occurrence: this outlet's branch_circuit is legitimately "C.O Yellow"
    // and appears as its subtitle, which is the meter's name too.
    expect(document.querySelector('.device-card__title')?.textContent).toContain('Outlet 3');
    expect(document.querySelector('.device-card__title')?.textContent).not.toContain('C.O Yellow');
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByText('74.8')).toBeInTheDocument();
  });

  it('does not carry a chosen channel across to an unrelated device', () => {
    const { rerender } = mount(meter1, [meter1, meter2, singleMeter], {
      mtr_co_yellow: reading('mtr_co_yellow', { cur_power1: 998.4 }),
      mtr_lo_yellow: reading('mtr_lo_yellow', { cur_power2: 12.5 }),
      mtr_lo_red: reading('mtr_lo_red', { cur_power1: 27.5 }),
    });
    fireEvent.click(screen.getAllByRole('tab')[1]);
    expect(screen.getByText('12.5')).toBeInTheDocument();

    rerender(<DeviceCard device={singleMeter} />);
    expect(screen.getByText('L.O Red')).toBeInTheDocument();
    expect(screen.getByText('27.5')).toBeInTheDocument();
  });
});
