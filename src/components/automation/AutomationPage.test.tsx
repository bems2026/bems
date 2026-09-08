import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AutomationPage } from './AutomationPage';
import { useDeviceStore } from '@/stores/deviceStore';
import { useContextStore } from '@/stores/contextStore';
import { useDeviceConfigStore } from '@/stores/deviceConfigStore';
import type { Device } from '@/lib/types';

vi.mock('@/config/supabase', () => ({ supabase: null }));

const light = (id: string): Device => ({
  id, display_name: id.toUpperCase(), class: 'switch', room: null, dps_map: null, status: 'active',
});

afterEach(() => {
  cleanup();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
  useContextStore.setState({ saved: {}, draft: {}, status: 'idle', saveStatus: 'idle', saveError: null });
  useDeviceConfigStore.setState({ saved: {}, draft: {}, status: 'idle', saveStatus: 'idle', saveError: null, lastSave: null });
});

describe('AutomationPage', () => {
  it('shows skeletons before the catalogue arrives, not a sentence', () => {
    render(<AutomationPage />);
    expect(document.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
  });

  /**
   * ONE announcement, not one per row. "Arm all" stages `armed = true` across every filtered
   * device in a single click, so a dozen rows can start warning at once.
   */
  it('summarises unrunnable schedules once, in a single live region', () => {
    useDeviceStore.setState({ devices: [light('l1'), light('l2')] });
    useContextStore.setState({
      saved: { 'global.schedule.l1.armed': 'true', 'global.schedule.l2.armed': 'true' },
      draft: {},
    });
    render(<AutomationPage />);
    const summary = document.querySelector('.automation-schedules-broken') as HTMLElement;
    expect(summary).toHaveAttribute('role', 'status');
    expect(summary).toHaveTextContent(/2 schedules cannot run as configured/i);
    expect(document.querySelectorAll('.automation-schedules-broken').length).toBe(1);
  });

  /**
   * A counter that is almost always zero trains people to stop reading the line — the same rule
   * the Devices page applies to its unstable-device count.
   */
  it('omits the summary entirely when every schedule is sound, rather than showing a zero', () => {
    useDeviceStore.setState({ devices: [light('l1')] });
    useContextStore.setState({
      saved: {
        'global.schedule.l1.armed': 'true',
        'global.schedule.l1.on': '07:00',
        'global.schedule.l1.days': '1111100',
      },
      draft: {},
    });
    render(<AutomationPage />);
    expect(document.querySelector('.automation-schedules-broken')).not.toBeInTheDocument();
    expect(screen.queryByText(/cannot run as configured/i)).not.toBeInTheDocument();
  });

  it('counts the staged draft, not just what was last written', () => {
    useDeviceStore.setState({ devices: [light('l1')] });
    useContextStore.setState({
      saved: { 'global.schedule.l1.armed': 'true', 'global.schedule.l1.on': '07:00', 'global.schedule.l1.days': '1111100' },
      draft: { 'global.schedule.l1.days': '0000000' },
    });
    render(<AutomationPage />);
    expect(document.querySelector('.automation-schedules-broken')).toHaveTextContent(/1 schedule cannot run/i);
  });
});
