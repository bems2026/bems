import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextUpCard } from './NextUpCard';
import { useDeviceStore } from '@/stores/deviceStore';
import { useScheduleStore } from '@/stores/scheduleStore';
import type { Schedule } from '@/lib/supabaseSchedules';
import type { Device } from '@/lib/types';

const light = (id: string, name: string): Device => ({ id, display_name: name, class: 'switch', room: null, dps_map: null, status: 'active' });

const rule = (over: Partial<Schedule> = {}): Schedule => ({
  id: 'r1',
  deviceId: 'l1',
  socket: null,
  on: '07:30',
  off: null,
  days: '1111111',
  enabled: true,
  label: null,
  updatedBy: '11111111-1111-1111-1111-111111111111',
  updatedAt: null,
  createdAt: null,
  ...over,
});

// Monday 06:00, so a 07:30 on-time is still ahead of it today.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-24T06:00:00'));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
  useScheduleStore.setState({ schedules: [], status: 'idle', busy: {}, rowError: {}, loadError: null, lastSave: null });
});

describe('NextUpCard', () => {
  it('shows the empty state when nothing is armed and saved', () => {
    useDeviceStore.setState({ devices: [light('l1', 'Light Switch 1')] });
    render(<NextUpCard />);
    expect(screen.getByText('No schedules armed — No data')).toBeInTheDocument();
  });

  it('a disarmed rule does not appear — only an armed one counts', () => {
    useDeviceStore.setState({ devices: [light('l1', 'Light Switch 1')] });
    useScheduleStore.setState({ schedules: [rule({ enabled: false })] });
    render(<NextUpCard />);
    expect(screen.getByText('No schedules armed — No data')).toBeInTheDocument();
  });

  it('renders a real armed schedule with its next time', () => {
    useDeviceStore.setState({ devices: [light('l1', 'Light Switch 1')] });
    useScheduleStore.setState({ schedules: [rule()] });
    render(<NextUpCard />);
    expect(screen.getAllByText(/Light Switch 1/).length).toBeGreaterThan(0);
    expect(screen.getByText('07:30')).toBeInTheDocument();
    expect(screen.getByText(/1 armed rule/)).toBeInTheDocument();
  });

  it('counts armed RULES, not armed devices — one device can hold several', () => {
    // The number this card showed before RM-066 was "devices with something armed", which
    // stopped being answerable the moment a device could hold five rules.
    useDeviceStore.setState({ devices: [light('l1', 'Light Switch 1')] });
    useScheduleStore.setState({
      schedules: [rule({ id: 'a', on: '07:30' }), rule({ id: 'b', on: '13:00' }), rule({ id: 'c', on: '18:00' })],
    });
    render(<NextUpCard />);
    expect(screen.getByText(/3 armed rules/)).toBeInTheDocument();
  });
});
