import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { DeviceMetaEditor } from './DeviceMetaEditor';
import { useDeviceConfigStore } from '@/stores/deviceConfigStore';
import { useSpaceTreeStore } from '@/stores/spaceTreeStore';
import * as supabaseDeviceConfig from '@/lib/supabaseDeviceConfig';
import { emptyDeviceConfig } from '@/lib/deviceConfig';
import type { Device } from '@/lib/types';

vi.mock('@/config/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } }) } },
}));
vi.mock('@/lib/supabaseDeviceConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabaseDeviceConfig')>();
  return { ...actual, fetchDeviceConfigs: vi.fn(), writeDeviceConfig: vi.fn() };
});

const outlet = (): Device => ({ id: 'co1', display_name: 'Outlet 1', class: 'outlet_dual', room: null, dps_map: 'type_b', status: 'active', sockets: ['CO1_1', 'CO1_2'], branch_circuit: 'C.O Yellow' });

afterEach(() => {
  cleanup();
  vi.mocked(supabaseDeviceConfig.fetchDeviceConfigs).mockReset();
  vi.mocked(supabaseDeviceConfig.writeDeviceConfig).mockReset();
  useDeviceConfigStore.setState({ saved: {}, draft: {}, status: 'idle', saveStatus: 'idle', saveError: null, lastSave: null });
  useSpaceTreeStore.setState({ nodes: [], status: 'idle', mutating: false, error: null });
});

describe('DeviceMetaEditor', () => {
  /**
   * RM-028 — a device is placed in the space tree, not described by a typed string.
   *
   * `Room` stays as the free-text fallback for a site whose tree has not been built yet, which
   * is why both fields exist here rather than one replacing the other.
   */
  describe('space placement', () => {
    const seedTree = () =>
      useSpaceTreeStore.setState({
        nodes: [
          { id: 'b', site_id: 's', parent_id: null, kind: 'building', name: 'NBERIC', sort_order: 0, attrs: {} },
          { id: 'r', site_id: 's', parent_id: 'b', kind: 'room', name: 'CARE Office', sort_order: 0, attrs: {} },
        ],
        status: 'ready',
        canEdit: true,
      });

    it('offers every node by full path, so two rooms with one name stay distinguishable', () => {
      seedTree();
      render(<DeviceMetaEditor device={outlet()} onClose={vi.fn()} />);
      const select = screen.getByLabelText('Space');
      expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
        'Not placed',
        'NBERIC',
        'NBERIC / CARE Office',
      ]);
    });

    it('staging a placement enables Save', () => {
      seedTree();
      render(<DeviceMetaEditor device={outlet()} onClose={vi.fn()} />);
      fireEvent.change(screen.getByLabelText('Space'), { target: { value: 'r' } });
      expect(screen.getByRole('button', { name: 'Save metadata' })).toBeEnabled();
    });

    it('says so when there is no tree yet, rather than showing an empty picker', () => {
      useSpaceTreeStore.setState({ nodes: [], status: 'ready', canEdit: true });
      render(<DeviceMetaEditor device={outlet()} onClose={vi.fn()} />);
      expect(screen.getByLabelText('Space')).toBeDisabled();
      expect(screen.getByText(/no spaces defined/i)).toBeInTheDocument();
    });
  });

  it('pre-fills fields from the saved config and focuses the heading', () => {
    useDeviceConfigStore.setState({ saved: { co1: { ...emptyDeviceConfig('co1'), room: 'CARE Office', category: 'outlet' } } });
    render(<DeviceMetaEditor device={outlet()} onClose={vi.fn()} />);

    expect(screen.getByLabelText('Room')).toHaveValue('CARE Office');
    expect(screen.getByLabelText('Category')).toHaveValue('outlet');
    expect(screen.getByRole('heading', { name: /Outlet 1/ })).toHaveFocus();
  });

  it('disables Save until a field is actually edited', () => {
    render(<DeviceMetaEditor device={outlet()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Save metadata' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Room'), { target: { value: 'Lab 2' } });
    expect(screen.getByRole('button', { name: 'Save metadata' })).not.toBeDisabled();
  });

  it('asks for confirmation naming the device, then writes and reports success', async () => {
    vi.mocked(supabaseDeviceConfig.writeDeviceConfig).mockResolvedValue(undefined);
    render(<DeviceMetaEditor device={outlet()} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Room'), { target: { value: 'Lab 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save metadata' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Outlet 1');
    expect(dialog).toHaveTextContent('co1');

    // Two "Save metadata" buttons exist once the dialog is open: the panel's own (now
    // behind the dialog) and the dialog's confirm button — the confirm button is the second.
    fireEvent.click(screen.getAllByRole('button', { name: 'Save metadata' })[1]);

    await vi.waitFor(() => expect(supabaseDeviceConfig.writeDeviceConfig).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'co1', room: 'Lab 2' }), 'user-1'));
    expect(useDeviceConfigStore.getState().saved.co1.room).toBe('Lab 2');
  });

  it('shows the store save error inline when the write fails', async () => {
    vi.mocked(supabaseDeviceConfig.writeDeviceConfig).mockRejectedValue(new Error('affected 0 rows'));
    render(<DeviceMetaEditor device={outlet()} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Room'), { target: { value: 'Lab 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save metadata' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Save metadata' })[1]);

    expect(await screen.findByRole('alert')).toHaveTextContent('affected 0 rows');
  });

  it('closes on Escape when no confirm dialog is open', () => {
    const onClose = vi.fn();
    render(<DeviceMetaEditor device={outlet()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('lets Escape close the confirm dialog first, without also closing the editor underneath it', () => {
    const onClose = vi.fn();
    render(<DeviceMetaEditor device={outlet()} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Room'), { target: { value: 'Lab 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save metadata' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
