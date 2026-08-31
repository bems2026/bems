import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { FloorPlanView } from './FloorPlanView';
import { useDeviceStore } from '@/stores/deviceStore';

afterEach(() => {
  cleanup();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
});

describe('FloorPlanView', () => {
  it('renders all 7 lights and 7 outlets by their fixed labels', () => {
    render(<FloorPlanView />);
    for (let i = 1; i <= 7; i++) {
      expect(screen.getByText(`L${i}`)).toBeInTheDocument();
      expect(screen.getByText(`CO${i}`)).toBeInTheDocument();
    }
  });

  it('binds a reading to its own device id only — updating co3 never bleeds into co1 or co4', () => {
    useDeviceStore.setState({
      latestReadings: {
        co3: {
          device_id: 'co3',
          ts: new Date().toISOString(),
          online: true,
          state: 'on',
          socket_states: { 1: 'on', 2: 'off' },
        },
      },
    });
    render(<FloorPlanView />);
    // Exactly one ON and one OFF exist anywhere — co3's own two sockets. Every other
    // outlet has no reading yet, so it renders the stale "?" placeholder, not a
    // fabricated OFF.
    expect(screen.getAllByText('ON')).toHaveLength(1);
    expect(screen.getAllByText('OFF')).toHaveLength(1);
    expect(screen.getAllByText('?').length).toBeGreaterThan(0);
  });

  it('treats a device with no reading yet as unknown, not as off', () => {
    render(<FloorPlanView />);
    // 7 outlets x 2 sockets = 14 unknown markers when nothing has arrived yet.
    expect(screen.getAllByText('?')).toHaveLength(14);
  });

  it('has no interactive elements anywhere — Stage 1 is view-only', () => {
    render(<FloorPlanView />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
