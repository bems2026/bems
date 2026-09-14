import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SourceCard } from './SourceCard';
import { useDeviceStore } from '@/stores/deviceStore';
import type { Device, Reading } from '@/lib/types';
import type { SyncStatus } from '@/lib/dataQuality';

/*
 * RM-079 — a card must not present a held reading as the current one. L.O Red's card showed 19.1 W
 * all day on 2026-09-12 with a live-looking status dot while its meter was not measuring.
 */

const device: Device = { id: 'mtr_lo_red', display_name: 'L.O Red', class: 'meter', room: null, dps_map: 'type_a', status: 'active' };
const sync: SyncStatus = { settled: true, fetchedAt: Date.now(), failures: 0, lastError: null, refetchMs: 60_000, source: 'bridge' };
const reading = (over: Partial<Reading> = {}): Reading => ({
  device_id: 'mtr_lo_red',
  ts: new Date().toISOString(),
  online: true,
  state: null,
  power_w: 19.1,
  voltage: 228.2,
  current: 0.576,
  ...over,
});
const mount = () => render(<SourceCard device={device} color="red" scope="branches" param="power" range="24h" selected={false} onSelect={() => {}} sync={sync} />);

afterEach(() => {
  cleanup();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
});

describe('SourceCard', () => {
  it('says since when a meter has been frozen, instead of presenting the held reading as current', () => {
    useDeviceStore.setState({ latestReadings: { mtr_lo_red: reading({ measurement_frozen: true, frozen_since: '2026-09-12T06:00:05+08:00' }) } });
    mount();
    expect(screen.getByText('Frozen since 06:00')).toBeInTheDocument();
  });

  it('says nothing about freezing for a reading the bridge did not flag', () => {
    useDeviceStore.setState({ latestReadings: { mtr_lo_red: reading() } });
    mount();
    expect(screen.queryByText(/Frozen since/)).not.toBeInTheDocument();
  });
});
