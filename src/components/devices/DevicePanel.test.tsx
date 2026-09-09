import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { DevicePanel } from './DevicePanel';
import { useDeviceStore } from '@/stores/deviceStore';
import { useDeviceConfigStore } from '@/stores/deviceConfigStore';
import type { Device } from '@/lib/types';

vi.mock('@/config/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } }) } },
}));
vi.mock('@/lib/removeDevice', () => ({ removeDevice: vi.fn().mockResolvedValue({ ok: true, stage: 'dry-run', summary: {} }) }));

const outlet = (): Device => ({
  id: 'co1', display_name: 'Outlet 1', class: 'outlet_dual', room: null, dps_map: 'type_b',
  status: 'active', sockets: ['CO1_1', 'CO1_2'], branch_circuit: 'C.O Yellow',
});

const open = (over: Partial<Parameters<typeof DevicePanel>[0]> = {}) =>
  render(<DevicePanel device={outlet()} canRemove={false} onClose={vi.fn()} onRemoved={vi.fn()} {...over} />);

afterEach(() => {
  cleanup();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
  useDeviceConfigStore.setState({ saved: {}, draft: {}, status: 'idle', saveStatus: 'idle', saveError: null, lastSave: null });
});

describe('DevicePanel', () => {
  it('is one dialog named for the device, not one per question about it', () => {
    open();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName(/Outlet 1/);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('opens on Capabilities', () => {
    open();
    expect(screen.getByRole('tab', { name: 'Capabilities' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'device-tab-capabilities');
  });

  it('switches to the metadata form on click', () => {
    open();
    fireEvent.click(screen.getByRole('tab', { name: 'Metadata' }));
    expect(screen.getByLabelText('Room')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Metadata' })).toHaveAttribute('aria-selected', 'true');
  });

  /**
   * The Capabilities tab subscribes to a live reading and the Remove tab fires a dry-run preview
   * on mount. Neither should be running while the operator is typing in the other.
   */
  it('renders only the active tab, not all three behind display:none', () => {
    open();
    expect(screen.queryByLabelText('Room')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Metadata' }));
    expect(screen.getByLabelText('Room')).toBeInTheDocument();
  });

  it('hides Remove for a device that cannot be removed, rather than disabling it', () => {
    open({ canRemove: false });
    expect(screen.queryByRole('tab', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('offers Remove when the device is enrolled', () => {
    open({ canRemove: true });
    expect(screen.getByRole('tab', { name: 'Remove' })).toBeInTheDocument();
  });

  /**
   * `role="tablist"` promises arrow-key navigation and a single tab stop. Announcing yourself as
   * a tablist and then behaving like three loose buttons is worse than being three buttons.
   */
  it('moves between tabs with the arrow keys, wrapping at both ends', () => {
    open({ canRemove: true });
    const caps = screen.getByRole('tab', { name: 'Capabilities' });
    const meta = screen.getByRole('tab', { name: 'Metadata' });
    const rm = screen.getByRole('tab', { name: 'Remove' });

    caps.focus();
    fireEvent.keyDown(caps, { key: 'ArrowRight' });
    expect(meta).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(meta, { key: 'ArrowLeft' });
    expect(caps).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(caps, { key: 'ArrowLeft' });
    expect(rm).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(rm, { key: 'Home' });
    expect(caps).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(caps, { key: 'End' });
    expect(rm).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps exactly one tab stop in the tablist (roving tabindex)', () => {
    open({ canRemove: true });
    const tabs = screen.getAllByRole('tab');
    expect(tabs.filter((t) => t.tabIndex === 0)).toHaveLength(1);
    expect(tabs.filter((t) => t.tabIndex === -1)).toHaveLength(2);
  });

  it('closes on Escape when no confirm dialog is open', () => {
    const onClose = vi.fn();
    open({ onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * Moved here from `DeviceMetaEditor`, which used to own its own panel. The save gate is an
   * `aria-modal` alertdialog inside this panel; one Escape must dismiss the gate, not both it and
   * the form underneath.
   */
  it('lets Escape close the save confirmation first, without also closing the panel', () => {
    const onClose = vi.fn();
    open({ onClose });
    fireEvent.click(screen.getByRole('tab', { name: 'Metadata' }));
    fireEvent.change(screen.getByLabelText('Room'), { target: { value: 'Lab 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save metadata' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
