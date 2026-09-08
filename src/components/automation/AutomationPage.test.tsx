import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { AutomationPage } from './AutomationPage';
import { useDeviceStore } from '@/stores/deviceStore';
import { useContextStore } from '@/stores/contextStore';
import { useDeviceConfigStore } from '@/stores/deviceConfigStore';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';
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
  useCapabilitiesStore.setState({ hardwareDispatchEnabled: null, dispatchClasses: null });
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

  /**
   * THE PAGE MUST NOT NAME THE DATABASE. "Write to Supabase" told the operator the vendor and
   * not the consequence; the thing they need to know is that the edit is saved and who it is
   * recorded against, not which product stores the row.
   */
  describe('vocabulary', () => {
    it('never says "Supabase" anywhere on the page', () => {
      useDeviceStore.setState({ devices: [light('l1')] });
      useContextStore.setState({ saved: {}, draft: { 'global.schedule.l1.on': '07:00' } });
      const { container } = render(<AutomationPage />);
      expect(container.textContent).not.toMatch(/supabase/i);
    });

    it('offers a plainly-named save control', () => {
      useDeviceStore.setState({ devices: [light('l1')] });
      useContextStore.setState({ saved: {}, draft: { 'global.schedule.l1.on': '07:00' } });
      render(<AutomationPage />);
      expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled();
    });
  });

  /**
   * THE PAGE WAS ASSERTING THE OPPOSITE OF THE TRUTH. Both its subtitle hint and its save
   * confirmation said "nothing on the real bridge reads these yet; hardware dispatch is still
   * gated closed". `HARDWARE_DISPATCH_ENABLED` is `true` on this deployment and the scheduler
   * logs `dispatch=OPEN` at boot — so the one page that arms unattended load shedding was
   * telling the operator it was inert. Read from the live capability state now, never asserted.
   */
  describe('what saving actually does', () => {
    const seedOneEdit = () => {
      useDeviceStore.setState({ devices: [light('l1')] });
      useContextStore.setState({ saved: {}, draft: { 'global.schedule.l1.on': '07:00' } });
    };

    it('says saved rules DO switch real hardware when dispatch is open', () => {
      useCapabilitiesStore.setState({ hardwareDispatchEnabled: true });
      seedOneEdit();
      const { container } = render(<AutomationPage />);
      expect(container.textContent).toMatch(/switch real hardware/i);
      expect(container.textContent).not.toMatch(/nothing on the real bridge/i);
    });

    it('says they reach nothing when dispatch is positively closed', () => {
      useCapabilitiesStore.setState({ hardwareDispatchEnabled: false });
      seedOneEdit();
      const { container } = render(<AutomationPage />);
      expect(container.textContent).toMatch(/do not reach any hardware/i);
    });

    /** Never claim either way from an unanswered capability probe. */
    it('claims neither while the gate state is still unknown', () => {
      useCapabilitiesStore.setState({ hardwareDispatchEnabled: null });
      seedOneEdit();
      const { container } = render(<AutomationPage />);
      expect(container.textContent).not.toMatch(/switch real hardware/i);
      expect(container.textContent).not.toMatch(/do not reach any hardware/i);
      expect(container.textContent).toMatch(/not been confirmed/i);
    });

    it('carries the same warning into the save confirmation, not just the page', () => {
      useCapabilitiesStore.setState({ hardwareDispatchEnabled: true });
      seedOneEdit();
      render(<AutomationPage />);
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
      const dialog = screen.getByRole('alertdialog');
      expect(dialog).toHaveTextContent(/switch real hardware/i);
      expect(dialog.textContent).not.toMatch(/supabase/i);
    });
  });
});