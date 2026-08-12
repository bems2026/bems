import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { LoadShedBanner } from './LoadShedBanner';
import { useDeviceStore } from '@/stores/deviceStore';
import { useContextStore } from '@/stores/contextStore';
import type { Totals } from '@/lib/types';

const totals = (over: Partial<Totals> = {}): Totals => ({
  device_id: '_totals',
  ts: new Date().toISOString(),
  energy_kwh_today: null,
  energy_kwh_week: null,
  energy_kwh_month: null,
  total_power_w: 1000,
  avg_voltage: 220,
  phase_current: { red: 5, yellow: 5, blue: null },
  ...over,
});

afterEach(() => {
  cleanup();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
  useContextStore.setState({ saved: {}, draft: {}, status: 'idle', saveStatus: 'idle', saveError: null });
});

describe('LoadShedBanner', () => {
  it('renders nothing when no DSM threshold has ever been saved', () => {
    useDeviceStore.setState({ totals: totals({ phase_current: { red: 999, yellow: 999, blue: null } }) });
    render(<LoadShedBanner />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders nothing when thresholds exist but nothing is over them', () => {
    useContextStore.setState({ saved: { 'global.dsm.max_phase_a': '20' } });
    useDeviceStore.setState({ totals: totals({ phase_current: { red: 5, yellow: 5, blue: null } }) });
    render(<LoadShedBanner />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('arms when the saved max phase current is genuinely exceeded', () => {
    useContextStore.setState({ saved: { 'global.dsm.max_phase_a': '10' } });
    useDeviceStore.setState({ totals: totals({ phase_current: { red: 15, yellow: 5, blue: null } }) });
    render(<LoadShedBanner />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Warning only/)).toBeInTheDocument();
  });

  it('ignores an unsaved draft edit — only the saved threshold can arm the banner', () => {
    useContextStore.setState({ saved: {}, draft: { 'global.dsm.max_phase_a': '1' } });
    useDeviceStore.setState({ totals: totals({ phase_current: { red: 15, yellow: 5, blue: null } }) });
    render(<LoadShedBanner />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('states auto-shed is armed when that key is also saved true', () => {
    useContextStore.setState({ saved: { 'global.dsm.max_phase_a': '10', 'global.dsm.auto_shed': 'true' } });
    useDeviceStore.setState({ totals: totals({ phase_current: { red: 15, yellow: 5, blue: null } }) });
    render(<LoadShedBanner />);
    expect(screen.getByText(/Auto-shed is armed/)).toBeInTheDocument();
  });
});
