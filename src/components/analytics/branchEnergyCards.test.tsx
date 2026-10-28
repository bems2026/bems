import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';
import { EnergySection } from './EnergySection';
import { EnergyBreakdownCard } from '@/components/overview/EnergyBreakdownCard';
import { useDeviceStore } from '@/stores/deviceStore';
import { AlertsPopover } from '@/components/layout/AlertsPopover';
import { useAlertsPanelStore } from '@/stores/alertsPanelStore';
import type { Device, HistoryPoint, Reading, Totals } from '@/lib/types';

/*
 * RM-077 and RM-078, on the two cards the operator compared.
 *
 * Overview's Energy Breakdown and Analytics' "By branch" showed L.O Red differently, and both said
 * "L.O Red is reporting less than it measured … 0.00 kWh against 0.30 kWh (100 % missing)". The
 * fixture is that evening: 2026-09-12, 22:00 local, with L.O Red having repeated 19.1 W / 228.2 V /
 * 0.576 A from 06:00 to 20:59 while its registers stood still.
 */

const MIN = 60_000;
const local = (s: string) => Date.parse(`${s}+08:00`);
const NOW = local('2026-09-12T22:00:00');

const meter = (id: string, name: string): Device => ({ id, display_name: name, class: 'meter', room: null, dps_map: 'type_a', status: 'active' });
const DEVICES = [meter('mtr_co_yellow', 'C.O Yellow'), meter('mtr_lo_red', 'L.O Red'), meter('mtr_arec_acu', 'CARE ACU'), meter('mtr_lo_yellow', 'L.O Yellow')];

const reading = (id: string, kwh: number, integrated: number): Reading => ({
  device_id: id,
  ts: new Date(NOW - 30_000).toISOString(),
  online: true,
  state: null,
  energy_kwh_today: kwh,
  energy_kwh_today_integrated: integrated,
});

function samples(fromLocal: string, minutes: number, at: (i: number) => Partial<HistoryPoint>): HistoryPoint[] {
  const start = local(fromLocal);
  return Array.from({ length: minutes }, (_, i) => ({ ts: new Date(start + i * MIN + 5000).toISOString(), power_w: 0, online: true, ...at(i) }));
}

function frozenEvening() {
  useDeviceStore.setState({
    devices: DEVICES,
    latestReadings: {
      mtr_co_yellow: reading('mtr_co_yellow', 3.034, 3.05),
      mtr_lo_red: reading('mtr_lo_red', 0.008, 0.3),
      mtr_arec_acu: reading('mtr_arec_acu', 0.4, 0.398),
      mtr_lo_yellow: reading('mtr_lo_yellow', 0.535, 0.533),
    },
    totals: null,
  });
  useDeviceStore.getState().setHistory(
    'mtr_lo_red',
    [
      ...samples('2026-09-12T00:00:00', 360, (i) => ({ power_w: 0, voltage: 227 + (i % 9) * 0.2, current: 0 })),
      ...samples('2026-09-12T06:00:00', 900, () => ({ power_w: 19.1, voltage: 228.2, current: 0.576 })),
      ...samples('2026-09-12T21:00:00', 60, (i) => ({ power_w: 13.3 + (i % 3) * 0.1, voltage: 226 + (i % 7) * 0.3, current: 0.41 })),
    ],
    '24h',
  );
}

/** Mount, then let the shared one-second clock catch up with the fake time. */
function mount(ui: React.ReactElement) {
  const view = render(ui);
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  return view;
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
  useAlertsPanelStore.setState({ open: false });
});

describe('Energy Breakdown and By branch — one derivation', () => {
  it('shows L.O Red with the same figure on Overview and on Analytics', () => {
    frozenEvening();
    const overview = mount(<EnergyBreakdownCard />);
    const overviewRow = [...document.querySelectorAll('.breakdown-row')].find((r) => r.textContent?.includes('L.O Red'));
    const overviewKwh = overviewRow?.querySelector('.breakdown-row__kwh')?.textContent;
    overview.unmount();

    mount(<EnergySection />);
    const analyticsRow = [...document.querySelectorAll('.analytics-energy-row')].find((r) => r.textContent?.includes('L.O Red'));
    expect(analyticsRow?.querySelector('.analytics-energy-row__kwh')?.textContent).toBe(overviewKwh);
    expect(overviewKwh).toBe('0.01');
  });

  it.each([
    ['Overview', () => <EnergyBreakdownCard />],
    ['Analytics', () => <EnergySection />],
  ])('%s tags the held branch and leaves the notice to the bell (RM-165)', (_page, ui) => {
    frozenEvening();
    mount(
      <>
        {ui()}
        <AlertsPopover />
      </>,
    );
    const row = [...document.querySelectorAll('.breakdown-row, .analytics-energy-row')].find((r) => r.textContent?.includes('L.O Red'));
    const tag = row?.querySelector('button.held-tag');
    expect(tag?.textContent).toBe('was held');
    expect(tag?.getAttribute('aria-label')).toBe("L.O Red's reading was held. Open alerts for the details.");
    // No paragraph in the card: the 2026-10-28 Overview carried eight and lost its layout.
    expect(document.querySelectorAll('.energy-disagreement')).toHaveLength(0);
    act(() => {
      fireEvent.click(tag!);
    });
    const text = screen.getByRole('dialog', { name: 'Alerts' }).textContent ?? '';
    // RM-136's wording: the READING was held; the meter is not accused of not measuring.
    expect(text).toContain("L.O Red's reading was held.It repeated exactly 19.1 W at 228.2 V from 06:00 to 20:59 (14 h 59 min)");
    expect(text).not.toMatch(/reporting less than it measured|not measuring|stopped updating/);
  });
});

describe('Energy Breakdown and By branch — RM-165, energy checks in the bell', () => {
  it('keeps the disagreement out of both cards and carries it in the bell', () => {
    // 2026-10-28: "Two measurements of the same circuits disagree… 3.32 kWh… 1.91 kWh — 1.7x less" sat inside
    // both cards. Now each card carries a mark, and the bell the notice.
    useDeviceStore.setState({
      devices: DEVICES,
      latestReadings: {
        mtr_co_yellow: reading('mtr_co_yellow', 1.5, 1.5),
        mtr_lo_red: reading('mtr_lo_red', 0.3, 0.3),
        mtr_arec_acu: reading('mtr_arec_acu', 1.2, 1.2),
        mtr_lo_yellow: reading('mtr_lo_yellow', 0.32, 0.32),
      },
      totals: { device_id: '_totals', ts: new Date(NOW - 30_000).toISOString(), energy_kwh_today: 3.32, energy_kwh_week: 3.32, energy_kwh_month: 3.32, total_power_w: 500, avg_voltage: 220, energy_kwh_today_integrated: 1.91 } as Totals,
    });
    mount(
      <>
        <EnergyBreakdownCard />
        <EnergySection />
        <AlertsPopover />
      </>,
    );
    expect(document.querySelectorAll('.energy-disagreement')).toHaveLength(0);
    expect(document.querySelectorAll('.energy-check-mark')).toHaveLength(2);
    act(() => {
      fireEvent.click(document.querySelector('.energy-check-mark') as HTMLElement);
    });
    expect(screen.getByRole('dialog', { name: 'Alerts' }).textContent).toContain('Two measurements of the same circuits disagree.The branches add up to 3.32 kWh today');
  });
});
