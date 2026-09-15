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

  it('draws CO6 on the right wall and CO7 on the partition, each label over its own pin — RM-080', () => {
    // The label is `CO{i+1}` from the row's INDEX, drawn 18 units above the row's own x/y. So this
    // pins both halves of the swap at once: the positions moved, and the rows were not reordered
    // (which would have relabelled the two pins back to where they started).
    render(<FloorPlanView />);
    const at = (label: string) => {
      const el = screen.getByText(label);
      return { x: el.getAttribute('x'), y: el.getAttribute('y') };
    };
    expect(at('CO6')).toEqual({ x: '285', y: String(190 - 18) });
    expect(at('CO7')).toEqual({ x: '235', y: String(115 - 18) });
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
