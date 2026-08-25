import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { RemoveDevicePanel } from './RemoveDevicePanel';
import type { Device } from '@/lib/types';

const remove = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/lib/removeDevice', () => ({ removeDevice: remove.fn }));

const device = (id: string, display_name: string): Device =>
  ({ id, display_name, class: 'outlet_dual', room: null, status: 'active' }) as Device;

const okDryRun = {
  ok: true,
  stage: 'dry-run',
  problems: [],
  summary: {
    deviceId: 'co8',
    displayName: 'Outlet 8',
    deviceClass: 'outlet_dual',
    removedNodes: ['Outlet 8', 'Outlet 8 Unified Parser'],
    nodesBefore: 271,
    nodesAfter: 269,
  },
};

beforeEach(() => {
  cleanup();
  remove.fn.mockReset();
});

describe('RemoveDevicePanel', () => {
  it('previews on open, so nothing is ever removed without showing what goes first', async () => {
    remove.fn.mockResolvedValue(okDryRun);
    render(<RemoveDevicePanel device={device('co8', 'Outlet 8')} onClose={() => {}} onRemoved={() => {}} />);
    expect(remove.fn).toHaveBeenCalledWith('co8', false);
    expect(await screen.findByText(/271 → 269/)).toBeInTheDocument();
  });

  it('names the flow nodes that would disappear rather than only counting them', async () => {
    remove.fn.mockResolvedValue(okDryRun);
    render(<RemoveDevicePanel device={device('co8', 'Outlet 8')} onClose={() => {}} onRemoved={() => {}} />);
    expect(await screen.findByText(/Outlet 8 Unified Parser/)).toBeInTheDocument();
  });

  it('states plainly that history survives, because that is the question people actually have', async () => {
    // `readings` is keyed by device_id, so removal does not delete what the device measured.
    // Someone hesitating over this button is usually hesitating about exactly that.
    remove.fn.mockResolvedValue(okDryRun);
    render(<RemoveDevicePanel device={device('co8', 'Outlet 8')} onClose={() => {}} onRemoved={() => {}} />);
    expect(await screen.findByText(/readings are keyed by device id/i)).toHaveTextContent(/kept/i);
  });

  it('will not remove until a preview has actually succeeded', async () => {
    remove.fn.mockResolvedValue({ ok: false, stage: 'plan', problems: ['co8 has no enrolled nodes in this flow'], summary: null });
    render(<RemoveDevicePanel device={device('co8', 'Outlet 8')} onClose={() => {}} onRemoved={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/plan step/);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
  });

  it('refuses a built-in device with the reason, not a bare failure', async () => {
    remove.fn.mockResolvedValue({
      ok: false,
      stage: 'validate',
      problems: ['"co1" is a built-in device, hand-written in shared/registry.mjs — only enrolled devices can be removed from here'],
      summary: null,
    });
    render(<RemoveDevicePanel device={device('co1', 'Outlet 1')} onClose={() => {}} onRemoved={() => {}} />);
    expect(await screen.findByText(/built-in device/)).toBeInTheDocument();
  });

  it('applies only after confirmation, and reports back when it is done', async () => {
    remove.fn.mockResolvedValue(okDryRun);
    const onRemoved = vi.fn();
    render(<RemoveDevicePanel device={device('co8', 'Outlet 8')} onClose={() => {}} onRemoved={onRemoved} />);
    await screen.findByText(/271 → 269/);

    remove.fn.mockResolvedValue({ ...okDryRun, stage: 'applied' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove device' }));

    expect(remove.fn).toHaveBeenLastCalledWith('co8', true);
    expect(await screen.findByText(/Removed\./)).toBeInTheDocument();
    expect(onRemoved).toHaveBeenCalled();
  });

  it('does not call the server at all when the confirmation is dismissed', async () => {
    remove.fn.mockResolvedValue(okDryRun);
    render(<RemoveDevicePanel device={device('co8', 'Outlet 8')} onClose={() => {}} onRemoved={() => {}} />);
    await screen.findByText(/271 → 269/);
    remove.fn.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(remove.fn).not.toHaveBeenCalled();
  });
});
