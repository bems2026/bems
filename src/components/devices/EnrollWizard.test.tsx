import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { EnrollWizard } from './EnrollWizard';
import { useDeviceStore } from '@/stores/deviceStore';
import type { Device } from '@/lib/types';

const cloudFleet = vi.hoisted(() => ({ value: { byId: {}, status: 'ready' } as Record<string, unknown> }));
vi.mock('@/hooks/useCloudFleet', () => ({ useCloudFleet: () => cloudFleet.value }));

const enroll = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/lib/enroll', () => ({ enrollDevice: enroll.fn }));

const rebind = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/lib/rebind', () => ({ rebindDevice: rebind.fn }));

const device = (id: string): Device =>
  ({ id, display_name: id, class: 'outlet_dual', room: null, status: 'active' }) as Device;

const okResult = {
  ok: true,
  stage: 'dry-run',
  problems: [],
  summary: {
    deviceId: 'co8', displayName: 'Outlet 8', deviceClass: 'outlet_dual', ctx: 'co8', dpsMap: 'type_b',
    vendorName: 'New Outlet', vendorOnline: true, tuyaVersion: '3.4', localKeyLength: 16,
    nodesBefore: 269, nodesAfter: 271,
  },
};

beforeEach(() => {
  cleanup();
  enroll.fn.mockReset();
  rebind.fn.mockReset();
  cloudFleet.value = {
    status: 'ready',
    claimedKnown: true,
    byId: { 'vendor-new': { id: 'vendor-new', name: 'New Outlet', online: true, category: 'pc' }, 'vendor-co1': { id: 'vendor-co1', name: 'CO1', online: true, category: 'pc', claimed: true, claimed_by: 'CO1' } },
    orphanNodes: [],
  };
  useDeviceStore.setState({ devices: [device('co1')] });
});

describe('EnrollWizard', () => {
  it('offers only devices the flow does not already poll', () => {
    render(<EnrollWizard onClose={() => {}} />);
    expect(screen.getByRole('option', { name: /New Outlet/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^CO1/ })).not.toBeInTheDocument();
  });

  it('says so plainly when every cloud device is already enrolled', () => {
    cloudFleet.value = { status: 'ready', byId: { 'vendor-co1': { id: 'vendor-co1', name: 'CO1', online: true, claimed: true } } };
    render(<EnrollWizard onClose={() => {}} />);
    expect(screen.getByText(/already enrolled/)).toBeInTheDocument();
  });

  /**
   * The claimed set is read server-side from the live flow, and that read can fail on its own
   * — it needs Node-RED admin credentials the Tuya call does not. When it did fail it was
   * swallowed, so `claimed` was false for everything and this list offered all 19 enrolled
   * devices as available. A wrong list that looks right is worse than a missing one, so the
   * server now reports whether it knows, and an unknown answer is stated rather than implied.
   */
  it('says the already-enrolled filter is unavailable rather than silently offering everything', () => {
    cloudFleet.value = {
      status: 'ready',
      claimedKnown: false,
      byId: { 'vendor-co1': { id: 'vendor-co1', name: 'CO1', online: true } },
    };
    render(<EnrollWizard onClose={() => {}} />);
    expect(screen.getByText(/could not be checked/i)).toBeInTheDocument();
  });

  it('stays quiet about the filter when the server did determine the claimed set', () => {
    render(<EnrollWizard onClose={() => {}} />);
    expect(screen.queryByText(/could not be checked/i)).not.toBeInTheDocument();
  });

  it('explains itself rather than half-working when the cloud is not configured', () => {
    // Without the cloud there is no local key, so enrolment genuinely cannot proceed here.
    cloudFleet.value = { status: 'unconfigured', byId: {} };
    render(<EnrollWizard onClose={() => {}} />);
    expect(screen.getByText(/needs the vendor cloud/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('shows the same validation the server will apply, as you type', async () => {
    // A form that accepts input the backend then rejects teaches people to ignore it.
    render(<EnrollWizard onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('co8'), { target: { value: 'CO8' } });
    expect(screen.getByText(/must be lowercase letters/)).toBeInTheDocument();
  });

  it('refuses a device id already in the registry', async () => {
    render(<EnrollWizard onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('co8'), { target: { value: 'co1' } });
    expect(screen.getByText(/already in the registry/)).toBeInTheDocument();
  });

  it('will not enrol before a preview has succeeded', async () => {
    // Enrolling without seeing what it would do is what this panel exists to prevent.
    render(<EnrollWizard onClose={() => {}} />);
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'vendor-new' } });
    fireEvent.change(screen.getByPlaceholderText('co8'), { target: { value: 'co8' } });
    fireEvent.change(screen.getByPlaceholderText('Outlet 8'), { target: { value: 'Outlet 8' } });
    expect(screen.getByRole('button', { name: 'Enrol' })).toBeDisabled();
  });

  it('previews without applying, and reports what would change', async () => {
    enroll.fn.mockResolvedValue(okResult);
    render(<EnrollWizard onClose={() => {}} />);
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'vendor-new' } });
    fireEvent.change(screen.getByPlaceholderText('co8'), { target: { value: 'co8' } });
    fireEvent.change(screen.getByPlaceholderText('Outlet 8'), { target: { value: 'Outlet 8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(enroll.fn).toHaveBeenCalledWith(expect.objectContaining({ apply: false }));
    expect(await screen.findByText(/nothing written yet/)).toBeInTheDocument();
    expect(screen.getByText(/269 → 271/)).toBeInTheDocument();
  });

  it('renders the key as a length, never a value', async () => {
    enroll.fn.mockResolvedValue(okResult);
    render(<EnrollWizard onClose={() => {}} />);
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'vendor-new' } });
    fireEvent.change(screen.getByPlaceholderText('co8'), { target: { value: 'co8' } });
    fireEvent.change(screen.getByPlaceholderText('Outlet 8'), { target: { value: 'Outlet 8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText(/present, 16 chars/)).toBeInTheDocument();
  });

  it('renders a refusal with the step it failed at, rather than a bare failure', async () => {
    enroll.fn.mockResolvedValue({ ok: false, stage: 'credentials', problems: ['the cloud did not return a local key'], summary: null });
    render(<EnrollWizard onClose={() => {}} />);
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'vendor-new' } });
    fireEvent.change(screen.getByPlaceholderText('co8'), { target: { value: 'co8' } });
    fireEvent.change(screen.getByPlaceholderText('Outlet 8'), { target: { value: 'Outlet 8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/credentials step/);
    expect(screen.getByText(/did not return a local key/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enrol' })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// IR hubs, aircon remotes and rebinding — 2026-09-17.
//
// When the IR blaster was re-paired, the dropdown gained "Air": a virtual aircon remote with no network
// presence, offered as enrollable as an outlet. And the node whose device the re-pair replaced could
// only be fixed by pasting a new id and key into the Node-RED editor by hand.
// ---------------------------------------------------------------------------

describe('EnrollWizard — detected devices', () => {
  const acuDevice = { id: 'acu_main', display_name: 'CARE ACU IR', class: 'acu_ir', room: null, status: 'active' } as Device;

  beforeEach(() => {
    useDeviceStore.setState({ devices: [device('co1'), acuDevice] });
    cloudFleet.value = {
      status: 'ready',
      claimedKnown: true,
      orphanNodes: [],
      byId: {
        hub: { id: 'hub', name: 'Smart IR', online: true, category: 'wnykq', claimed: true, claimed_by: 'NBRIC IR Blaster' },
        air: { id: 'air', name: 'Air', online: true, category: 'infrared_ac', sub: true, claimed: false, claimed_by: null },
        'vendor-new': { id: 'vendor-new', name: 'New Outlet', online: true, category: 'pc', claimed: false },
      },
    };
  });

  it('never offers the virtual aircon remote for enrolment, and says whose remote it is', () => {
    render(<EnrollWizard onClose={() => {}} />);
    expect(screen.queryByRole('option', { name: /^Air/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /New Outlet/ })).toBeInTheDocument();
    const row = screen.getByText('Air').closest('li') as HTMLElement;
    expect(row).toHaveTextContent('Aircon remote (virtual)');
    expect(row).toHaveTextContent(/CARE ACU IR's cloud aircon remote/);
  });

  it('names the flow node an IR hub is already enrolled as', () => {
    render(<EnrollWizard onClose={() => {}} />);
    const row = screen.getByText('Smart IR').closest('li') as HTMLElement;
    expect(row).toHaveTextContent(/IR hub/);
    expect(row).toHaveTextContent(/Already in the flow as "NBRIC IR Blaster"/);
  });

  it('offers a rebind when a node of the same kind lost its device, previews it, then confirms before writing', async () => {
    cloudFleet.value = {
      ...cloudFleet.value,
      orphanNodes: [{ name: 'NBRIC IR Blaster', class: 'acu_ir' }],
      byId: { hub2: { id: 'hub2', name: 'Smart IR', online: true, category: 'wnykq', claimed: false, claimed_by: null } },
    };
    const summary = {
      nodeName: 'NBRIC IR Blaster', vendorName: 'Smart IR', vendorOnline: true, kind: 'IR hub (temperature + humidity)',
      tuyaVersion: '3.3', declaredVersion: '3.3', versionMatchesDeclaration: true, localKeyLength: 16,
      fieldsChanged: ['deviceId', 'deviceKey', 'disableAutoStart'], notes: [],
    };
    rebind.fn.mockResolvedValueOnce({ ok: true, stage: 'dry-run', problems: [], summary });
    rebind.fn.mockResolvedValueOnce({ ok: true, stage: 'applied', problems: [], summary });
    render(<EnrollWizard onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /Rebind NBRIC IR Blaster/ }));
    expect(rebind.fn).toHaveBeenCalledWith({ nodeName: 'NBRIC IR Blaster', tuyaDeviceId: 'hub2', apply: false });
    expect(await screen.findByText(/present, 16 chars/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('v3.3 (as the device announces it; declared v3.3)');

    fireEvent.click(screen.getByRole('button', { name: 'Rebind' }));
    expect(rebind.fn).toHaveBeenCalledTimes(1); // gated behind the confirmation
    fireEvent.click(screen.getByRole('button', { name: 'Yes, rebind' }));
    expect(rebind.fn).toHaveBeenLastCalledWith({ nodeName: 'NBRIC IR Blaster', tuyaDeviceId: 'hub2', apply: true });
    expect(await screen.findByText('Rebound.')).toBeInTheDocument();
  });

  it('shows a refused rebind with the step it failed at', async () => {
    cloudFleet.value = {
      ...cloudFleet.value,
      orphanNodes: [{ name: 'NBRIC IR Blaster', class: 'acu_ir' }],
      byId: { hub2: { id: 'hub2', name: 'Smart IR', online: false, category: 'wnykq', claimed: false } },
    };
    rebind.fn.mockResolvedValue({ ok: false, stage: 'credentials', problems: ['the device did not announce itself on this network'], summary: null });
    render(<EnrollWizard onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Rebind NBRIC IR Blaster/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/credentials step/);
    expect(screen.getByText(/did not announce itself/)).toBeInTheDocument();
  });
});
