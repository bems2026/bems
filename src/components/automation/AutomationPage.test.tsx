import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { AutomationPage } from './AutomationPage';
import { useDeviceStore } from '@/stores/deviceStore';
import { useContextStore } from '@/stores/contextStore';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';
import { useDeviceConfigStore } from '@/stores/deviceConfigStore';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useAcuRuleStore } from '@/stores/acuRuleStore';
import type { Device } from '@/lib/types';

/**
 * The page's first component coverage. It had none at all before RM-059 — which is part of
 * how it went months telling the operator "nothing on the real bridge reads these yet" while
 * `server/scheduler.mjs` was firing its rows at real relays. The reach assertions below are
 * the ones that matter most; the rest is structure.
 */

const device = (id: string, display_name: string, cls: Device['class']): Device => ({
  id,
  display_name,
  class: cls,
  room: null,
  dps_map: null,
  status: 'active',
});

const DEVICES = [device('l1', 'Light Switch 1', 'switch'), device('co1', 'Outlet 1', 'outlet_dual'), device('mtr_lo_red', 'L.O Red', 'meter')];

/** `scheduling` is a declared function, so a device with no config row is included by default. */
beforeEach(() => {
  window.location.hash = '';
  useDeviceStore.setState({ devices: DEVICES, latestReadings: {}, totals: null, history: {} });
  useContextStore.setState({ saved: {}, draft: {}, status: 'ready', saveStatus: 'idle', saveError: null, lastSave: null });
  useCapabilitiesStore.setState({ dispatchClasses: null, hardwareDispatchEnabled: null });
  useDeviceConfigStore.setState({ saved: {}, draft: {} });
  useScheduleStore.setState({ schedules: [], status: 'ready', busy: {}, rowError: {}, loadError: null, lastSave: null });
  useAcuRuleStore.setState({ rules: [], loopState: {}, status: 'ready', busy: {}, rowError: {}, loadError: null });
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
  useContextStore.setState({ saved: {}, draft: {}, status: 'idle', saveStatus: 'idle', saveError: null, lastSave: null });
  useCapabilitiesStore.setState({ dispatchClasses: null, hardwareDispatchEnabled: null });
});

describe('AutomationPage — the reach statement', () => {
  it('says firings are DRY RUNS while the dispatch gate is closed', () => {
    useCapabilitiesStore.setState({ dispatchClasses: [] });
    render(<AutomationPage />);
    expect(screen.getByText(/dry runs — dispatch is closed/i)).toBeInTheDocument();
    expect(screen.queryByText(/switch real hardware/i)).not.toBeInTheDocument();
  });

  it('says it SWITCHES REAL HARDWARE once the gate reports open', () => {
    // The old copy said "Staged, not yet dispatchable" unconditionally, which had been false
    // since the scheduler daemon shipped. This is the assertion that stops it coming back.
    useCapabilitiesStore.setState({ dispatchClasses: ['switch', 'outlet_dual'] });
    render(<AutomationPage />);
    expect(screen.getByText(/switch real hardware/i)).toBeInTheDocument();
  });

  it('treats a not-yet-loaded capabilities response as closed, never as open', () => {
    // `null` means the proxy has not answered. Claiming hardware dispatch is open before being
    // told so is the one direction of this mistake that can hurt somebody.
    useCapabilitiesStore.setState({ dispatchClasses: null });
    render(<AutomationPage />);
    // Both the page header and the Overview card say it, and they must agree — a page that
    // hedged in one place and not the other would be read as whichever the reader saw first.
    expect(screen.getAllByText(/dispatch is closed/i).length).toBeGreaterThanOrEqual(2);
  });
});

describe('AutomationPage — strategy tabs', () => {
  it('offers the four strategy categories', () => {
    render(<AutomationPage />);
    const list = screen.getByRole('tablist', { name: /automation strategies/i });
    expect(within(list).getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Overview',
      'Time-Driven',
      'State-Driven',
      'Event-Driven',
    ]);
  });

  it('lands on Overview by default', () => {
    render(<AutomationPage />);
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Overview');
  });

  it('a deep link opens the named tab directly', () => {
    window.location.hash = '#automation/state';
    render(<AutomationPage />);
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('State-Driven');
  });

  it('switching tabs updates the URL so the view can be linked and survives a reload', () => {
    render(<AutomationPage />);
    fireEvent.click(screen.getByRole('tab', { name: /Time-Driven/ }));
    expect(window.location.hash).toBe('#automation/time');
  });

  it('shows the schedule targets only on the Time-Driven tab', () => {
    render(<AutomationPage />);
    expect(screen.queryByText('Light Switch 1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Time-Driven/ }));
    expect(screen.getAllByText('Light Switch 1').length).toBeGreaterThan(0);
  });

  it('lists an OUTLET as two targets, one per socket — the point of RM-059', () => {
    render(<AutomationPage />);
    fireEvent.click(screen.getByRole('tab', { name: /Time-Driven/ }));
    // S1 appears twice — in the target list and as the heading of the stack it opened.
    expect(screen.getAllByText('Outlet 1 · S1').length).toBeGreaterThan(0);
    expect(screen.getByText('Outlet 1 · S2')).toBeInTheDocument();
  });

  it('a meter is never offered as a schedule target', () => {
    render(<AutomationPage />);
    fireEvent.click(screen.getByRole('tab', { name: /Time-Driven/ }));
    expect(screen.queryByText('L.O Red')).not.toBeInTheDocument();
  });
});

describe('AutomationPage — strategies that are not installed', () => {
  it('names the specific blocker rather than only saying "coming soon"', () => {
    // An operator reading this page is the person who can unblock several of these. A bare
    // "coming soon" converts a procurement question into a wait.
    render(<AutomationPage />);
    fireEvent.click(screen.getByRole('tab', { name: /Event-Driven/ }));
    expect(screen.getByText(/Occupancy-driven lighting/i)).toBeInTheDocument();
    expect(screen.getByText(/open procurement question/i)).toBeInTheDocument();
    expect(screen.getByText(/CO₂-driven ventilation/i)).toBeInTheDocument();
  });

  it('the aircon loop is a real feature on that tab now, not a coming-soon card', () => {
    // RM-062 built it. This fixture has no `acu_ir` device, so the panel says exactly that
    // rather than offering a rule against nothing.
    render(<AutomationPage />);
    fireEvent.click(screen.getByRole('tab', { name: /Event-Driven/ }));
    expect(screen.getByText(/Aircon room-temperature control/i)).toBeInTheDocument();
    expect(screen.getByText(/no IR-commandable aircon in its registry/i)).toBeInTheDocument();
  });

  it('puts the solar strategy under State-Driven, with the logger named as the blocker', () => {
    render(<AutomationPage />);
    fireEvent.click(screen.getByRole('tab', { name: /State-Driven/ }));
    expect(screen.getByText(/Solar-surplus load scheduling/i)).toBeInTheDocument();
    expect(screen.getByText(/not on the device network/i)).toBeInTheDocument();
  });
});

describe('AutomationPage — the dead ambient trigger is gone', () => {
  it('no longer offers a control that nothing on the server reads', () => {
    // `global.trigger.care_acu_on` round-tripped browser -> Supabase -> browser for months and
    // no `server/` file ever read it. RM-062 replaces it with a real controller.
    render(<AutomationPage />);
    for (const tab of ['Overview', 'Time-Driven', 'State-Driven', 'Event-Driven']) {
      fireEvent.click(screen.getByRole('tab', { name: new RegExp(tab) }));
      expect(screen.queryByLabelText(/ambient trigger setpoint/i)).not.toBeInTheDocument();
    }
  });
});

describe('AutomationPage — pending writes', () => {
  it('stays visible across tabs, because a staged edit is page-scoped not tab-scoped', () => {
    useContextStore.setState({ saved: {}, draft: { 'global.dsm.max_total_kw': '2.21' } });
    render(<AutomationPage />);
    expect(screen.getByText('global.dsm.max_total_kw')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Event-Driven/ }));
    expect(screen.getByText('global.dsm.max_total_kw')).toBeInTheDocument();
  });

  it('the write button is disabled with nothing staged', () => {
    render(<AutomationPage />);
    expect(screen.getByRole('button', { name: /write to supabase/i })).toBeDisabled();
  });
});
