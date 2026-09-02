import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { StaleDataBadge } from './StaleDataBadge';
import { useDeviceStore } from '@/stores/deviceStore';

const RESET = { devices: [], latestReadings: {}, totals: null, history: {} };

afterEach(() => {
  cleanup();
  useDeviceStore.setState(RESET);
});

describe('StaleDataBadge', () => {
  it('is stale with no reading in the store yet, with an accessible live-region description', () => {
    render(
      <StaleDataBadge deviceId="co3" label="Outlet 3">
        <span>content</span>
      </StaleDataBadge>,
    );
    expect(screen.getByText('content').parentElement).toHaveClass('stale-wrap--stale');
    const flag = screen.getByRole('status');
    expect(flag).toHaveAccessibleName('Outlet 3: no reading in the last 30 seconds');
  });

  it('falls back to a generic subject when no label is given', () => {
    render(
      <StaleDataBadge deviceId="co3">
        <span>content</span>
      </StaleDataBadge>,
    );
    expect(screen.getByRole('status')).toHaveAccessibleName('This device: no reading in the last 30 seconds');
  });

  it('is not stale for a fresh, online device reading, and has no live region at all', () => {
    useDeviceStore.setState({
      latestReadings: { co3: { device_id: 'co3', ts: new Date().toISOString(), online: true, state: 'on', power_w: 400 } },
    });
    render(
      <StaleDataBadge deviceId="co3" label="Outlet 3">
        <span>content</span>
      </StaleDataBadge>,
    );
    expect(screen.getByText('content').parentElement).not.toHaveClass('stale-wrap--stale');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('is stale when the device is explicitly reported offline', () => {
    useDeviceStore.setState({
      latestReadings: { co3: { device_id: 'co3', ts: new Date().toISOString(), online: false, state: 'off' } },
    });
    render(
      <StaleDataBadge deviceId="co3">
        <span>content</span>
      </StaleDataBadge>,
    );
    expect(screen.getByText('content').parentElement).toHaveClass('stale-wrap--stale');
  });

  it('badges the _totals row when no deviceId is given', () => {
    useDeviceStore.setState({
      totals: {
        device_id: '_totals',
        ts: new Date(Date.now() - 60_000).toISOString(),
        energy_kwh_today: 1,
        energy_kwh_week: 1,
        energy_kwh_month: 1,
        total_power_w: 1,
        avg_voltage: 220,
        phase_current: { red: 1, yellow: 1, blue: null },
      },
    });
    render(
      <StaleDataBadge>
        <span>content</span>
      </StaleDataBadge>,
    );
    expect(screen.getByText('content').parentElement).toHaveClass('stale-wrap--stale');
    expect(screen.getByRole('status')).toHaveAccessibleName('Building totals: no reading in the last 30 seconds');
  });
});

/**
 * RM-045. On a floor plan a pin is about 24px wide and the word "STALE" is wider than the whole
 * pin, so the flag covered the very puck it described. MEASURED on the office kiosk (800x480,
 * 2026-09-02): four stale outlets rendered four pills that hid CO1 and CO4 completely and most
 * of the plan with them.
 *
 * The compact variant is a MARKER, not a shorter word — and the thing that must not change is
 * what assistive technology hears. The dimming and the marker are the sighted signal; the live
 * region still announces the same full sentence it always did.
 */
describe('the compact variant, for a floor plan', () => {
  it('still announces the same sentence, which is the half that must not shrink', () => {
    render(<StaleDataBadge deviceId="co1" label="Outlet 1" variant="dot"><span>puck</span></StaleDataBadge>);
    const flag = screen.getByRole('status');
    expect(flag).toHaveAttribute('aria-label', expect.stringContaining('Outlet 1'));
    expect(flag).toHaveAttribute('aria-label', expect.stringContaining('no reading in the last'));
  });

  it('renders no visible word, so it cannot cover the pin it describes', () => {
    render(<StaleDataBadge deviceId="co1" label="Outlet 1" variant="dot"><span>puck</span></StaleDataBadge>);
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
  });

  it('is marked as the compact variant, so the plan can size it as a dot', () => {
    render(<StaleDataBadge deviceId="co1" label="Outlet 1" variant="dot"><span>puck</span></StaleDataBadge>);
    expect(screen.getByRole('status').className).toMatch(/stale-flag--dot/);
  });

  it('still shows the word everywhere else, where there is room for it', () => {
    // The lists and the alerts popover keep the flag they have. A monitoring dashboard should
    // say "stale" out loud wherever saying it does not cost the reader the thing being described.
    render(<StaleDataBadge deviceId="co1" label="Outlet 1"><span>row</span></StaleDataBadge>);
    expect(screen.getByRole('status')).toHaveTextContent('stale');
    expect(screen.getByRole('status').className).not.toMatch(/--dot/);
  });

  it('shows nothing at all when the reading is fresh, in either variant', () => {
    useDeviceStore.setState({
      latestReadings: { co1: { device_id: 'co1', ts: new Date().toISOString(), online: true, state: 'on' } },
    });
    render(<StaleDataBadge deviceId="co1" label="Outlet 1" variant="dot"><span>puck</span></StaleDataBadge>);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
