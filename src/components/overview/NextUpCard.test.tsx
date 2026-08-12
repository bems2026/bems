import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextUpCard } from './NextUpCard';
import { useDeviceStore } from '@/stores/deviceStore';
import { useContextStore } from '@/stores/contextStore';
import type { Device } from '@/lib/types';

const light = (id: string, name: string): Device => ({ id, display_name: name, class: 'switch', room: null, dps_map: null, status: 'active' });

afterEach(() => {
  cleanup();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
  useContextStore.setState({ saved: {}, draft: {}, status: 'idle', saveStatus: 'idle', saveError: null });
});

describe('NextUpCard', () => {
  it('shows the empty state when nothing is armed and saved', () => {
    useDeviceStore.setState({ devices: [light('l1', 'Light Switch 1')] });
    render(<NextUpCard />);
    expect(screen.getByText('No schedules armed — No data')).toBeInTheDocument();
  });

  it('an unsaved draft edit does not appear — only a saved, armed schedule counts', () => {
    useDeviceStore.setState({ devices: [light('l1', 'Light Switch 1')] });
    useContextStore.setState({ draft: { 'global.schedule.l1.armed': 'true', 'global.schedule.l1.on': '07:00' } });
    render(<NextUpCard />);
    expect(screen.getByText('No schedules armed — No data')).toBeInTheDocument();
  });

  it('renders a real saved, armed schedule with its on-time', () => {
    useDeviceStore.setState({ devices: [light('l1', 'Light Switch 1')] });
    useContextStore.setState({ saved: { 'global.schedule.l1.armed': 'true', 'global.schedule.l1.on': '07:30' } });
    render(<NextUpCard />);
    expect(screen.getByText('Light Switch 1')).toBeInTheDocument();
    expect(screen.getByText('07:30')).toBeInTheDocument();
    expect(screen.getByText(/1 armed/)).toBeInTheDocument();
  });
});
