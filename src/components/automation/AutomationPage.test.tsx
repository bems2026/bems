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
 * The page's first component coverage. It had none at all before RM-066 — which is part of
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

/**
 * My own two-state reach suite lived here and was removed in the merge, not lost: RM-062's
 * three-state version supersedes it and is asserted under "what saving actually does" below.
 * Two suites checking the same sentence with different expectations is how one of them ends up
 * quietly deleted later by whoever hits the failure.
 */

describe('AutomationPage — strategy tabs', () => {
  it('offers the four strategy categories', () => {
    render(<AutomationPage />);
    const list = screen.getByRole('tablist', { name: /automation strategies/i });
    expect(within(list).getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Summary',
      'Time-Driven',
      'State-Driven',
      'Event-Driven',
    ]);
  });

  it('lands on Summary by default', () => {
    render(<AutomationPage />);
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Summary');
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

  it('lists an OUTLET as two targets, one per socket — the point of RM-066', () => {
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
    expect(screen.getByText(/Daylight-driven lighting and blinds/i)).toBeInTheDocument();
    expect(screen.getByText(/neither of them physically installed/i)).toBeInTheDocument();
  });

  it('the aircon loop is a real feature on that tab now, not a coming-soon card', () => {
    // RM-069 built it. This fixture has no `acu_ir` device, so the panel says exactly that
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
    // no `server/` file ever read it. RM-069 replaces it with a real controller.
    render(<AutomationPage />);
    for (const tab of ['Summary', 'Time-Driven', 'State-Driven', 'Event-Driven']) {
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

  it('the save button is disabled with nothing staged', () => {
    render(<AutomationPage />);
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
  });
});


/* ===========================================================================
 * From RM-061/RM-062, kept through the merge.
 *
 * The vocabulary rule is theirs and it is right: an operator does not care which database this
 * is, so naming the vendor in a button makes the store the subject of a sentence that is really
 * about the building. It cost a rename here ("Write to Supabase" -> "Save changes") and a pass
 * over every error string this page can surface.
 * ======================================================================== */

describe('AutomationPage — vocabulary', () => {
  it('never says "Supabase" anywhere on the page', () => {
    useContextStore.setState({ saved: {}, draft: { 'global.dsm.max_total_kw': '2.21' } });
    const { container } = render(<AutomationPage />);
    expect(container.textContent).not.toMatch(/supabase/i);
  });

  it('offers a plainly-named save control', () => {
    useContextStore.setState({ saved: {}, draft: { 'global.dsm.max_total_kw': '2.21' } });
    render(<AutomationPage />);
    expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled();
  });
});

describe('AutomationPage — what saving actually does', () => {
  it('says saved rules DO switch real hardware when dispatch is open', () => {
    useCapabilitiesStore.setState({ hardwareDispatchEnabled: true });
    render(<AutomationPage />);
    expect(screen.getByText(/Saved rules switch real hardware here/i)).toBeInTheDocument();
  });

  it('says they reach nothing when dispatch is positively closed', () => {
    useCapabilitiesStore.setState({ hardwareDispatchEnabled: false });
    render(<AutomationPage />);
    expect(screen.getByText(/do not reach any hardware/i)).toBeInTheDocument();
  });

  it('claims NEITHER while the gate state is still unknown', () => {
    // `null` is an unanswered capability probe, not a closed gate. Collapsing it into "closed"
    // looks safe and states something the page does not know.
    useCapabilitiesStore.setState({ hardwareDispatchEnabled: null });
    render(<AutomationPage />);
    expect(screen.getByText(/has not been confirmed yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/switch real hardware here/i)).not.toBeInTheDocument();
  });

  it('carries the same sentence into the save confirmation, not just onto the page', () => {
    // The dialog reuses the page's string rather than rephrasing it — a second wording is a
    // second place for the two to disagree about what pressing Save causes.
    useCapabilitiesStore.setState({ hardwareDispatchEnabled: true });
    useContextStore.setState({ saved: {}, draft: { 'global.dsm.max_total_kw': '2.21' } });
    render(<AutomationPage />);
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(within(screen.getByRole('alertdialog')).getByText(/Saved rules switch real hardware here/i)).toBeInTheDocument();
  });
});
