import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { EnrollWizard } from './EnrollWizard';
import { useDeviceStore } from '@/stores/deviceStore';
import type { Device } from '@/lib/types';

const cloudFleet = vi.hoisted(() => ({ value: { byId: {}, status: 'ready' } as Record<string, unknown>, refresh: vi.fn() }));
vi.mock('@/hooks/useCloudFleet', () => ({ useCloudFleet: () => ({ refresh: cloudFleet.refresh, ...cloudFleet.value }) }));

const credentials = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/lib/credentials', () => ({ importCredentials: credentials.fn }));

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
  credentials.fn.mockReset();
  cloudFleet.refresh.mockReset();
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

  it('keeps working from imported keys when the vendor cloud is unavailable, and says where each source stands', () => {
    // 2026-09-17: this panel used to give up when the cloud did. The subscription lapses by design now,
    // and the keys come from an import — so the form stays, and the cloud's state is one line of three.
    cloudFleet.value = {
      status: 'ready',
      claimedKnown: true,
      orphanNodes: [],
      byId: { 'vendor-new': { id: 'vendor-new', name: 'New Outlet', online: null, category: 'pc', credential_source: 'imported', on_lan: true, lan_version: '3.4' } },
      sources: {
        cloud: { status: 'unavailable', detail: 'code 28841002: IoT Core subscription expired' },
        imported: { count: 1, last_complete_at: null },
        lan: { listening_since: '2026-09-22T00:00:00.000Z' },
      },
    };
    render(<EnrollWizard onClose={() => {}} />);
    expect(screen.getByRole('option', { name: /New Outlet · on network/ })).toBeInTheDocument();
    const sources = screen.getByRole('list', { name: 'Device sources' });
    expect(sources).toHaveTextContent(/Vendor cloud.*unavailable.*IoT Core subscription expired/);
    expect(sources).toHaveTextContent(/Imported keys.*1 device/);
    expect(sources).toHaveTextContent(/Device network.*listening/);
  });

  it('still explains itself against a proxy that predates key import', () => {
    cloudFleet.value = { status: 'unconfigured', byId: {} };
    render(<EnrollWizard onClose={() => {}} />);
    expect(screen.getByText(/restart ibems-proxy/)).toBeInTheDocument();
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

  it('a device heard on the network with no key asks for one, and is not offered for enrolment', () => {
    cloudFleet.value = {
      ...cloudFleet.value,
      byId: { fresh: { id: 'fresh', name: null, online: null, category: null, credential_source: null, on_lan: true, lan_version: '3.5' } },
    };
    render(<EnrollWizard onClose={() => {}} />);
    expect(screen.queryByRole('option', { name: /fresh/ })).not.toBeInTheDocument();
    const row = screen.getByText('fresh').closest('li') as HTMLElement;
    expect(row).toHaveTextContent('Needs its key');
    expect(row).toHaveTextContent('on network · v3.5');
    expect(row).toHaveTextContent('no key');
    // The import panel opens by itself: there is a device waiting on it.
    expect(screen.getByText('Import keys from a key tool').closest('details')).toHaveAttribute('open');
  });

  it('says where each detected device gets its key', () => {
    cloudFleet.value = {
      ...cloudFleet.value,
      byId: {
        a: { id: 'a', name: 'Imported Outlet', category: 'pc', credential_source: 'imported', on_lan: true, lan_version: '3.4' },
        b: { id: 'b', name: 'Cloud Outlet', online: true, category: 'pc', credential_source: 'cloud', on_lan: false },
      },
    };
    render(<EnrollWizard onClose={() => {}} />);
    expect(screen.getByText('Imported Outlet').closest('li')).toHaveTextContent('key imported');
    expect(screen.getByText('Cloud Outlet').closest('li')).toHaveTextContent('key from cloud');
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

// ---------------------------------------------------------------------------
// Import keys — 2026-09-17. Onboarding without an IoT Core subscription: the operator exports the
// account's devices with a key tool and hands the file to the Pi through this panel.
// ---------------------------------------------------------------------------

describe('EnrollWizard — import keys', () => {
  const EXPORT = '[{"id":"bf01","name":"Outlet 9","local_key":"0123456789abcdef","category":"pc"}]';

  const openImport = () => {
    fireEvent.click(screen.getByText('Import keys from a key tool'));
    return screen.getByLabelText(/paste it/i) as HTMLTextAreaElement;
  };

  it('sends the pasted export with the complete flag, reports counts, clears the paste and refreshes the list', async () => {
    credentials.fn.mockResolvedValue({ ok: true, format: 'json', added: 1, updated: 0, total: 1, complete: true, problems: [] });
    render(<EnrollWizard onClose={() => {}} />);
    const paste = openImport();
    fireEvent.change(paste, { target: { value: EXPORT } });
    fireEvent.click(screen.getByRole('checkbox', { name: /lists every device/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Import keys' }));

    expect(credentials.fn).toHaveBeenCalledWith(EXPORT, true);
    expect(await screen.findByText(/Imported: 1 added, 0 updated/)).toBeInTheDocument();
    expect(paste.value).toBe('');
    expect(cloudFleet.refresh).toHaveBeenCalled();
  });

  it('shows a refused import with its reasons, and keeps the paste so it can be fixed', async () => {
    credentials.fn.mockResolvedValue({ ok: false, format: null, added: 0, updated: 0, total: 0, complete: false, problems: ['not a recognised export'] });
    render(<EnrollWizard onClose={() => {}} />);
    const paste = openImport();
    fireEvent.change(paste, { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import keys' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('not a recognised export');
    expect(paste.value).toBe('hello');
    expect(cloudFleet.refresh).not.toHaveBeenCalled();
  });

  it('keeps the panel open after an import that leaves nothing needing a key, so its result stays visible', async () => {
    // Found in the browser preview: the panel opened itself for a keyless device, the import gave that
    // device its key, the list refreshed — and the panel closed, hiding the "Imported" confirmation.
    cloudFleet.value = { ...cloudFleet.value, byId: { fresh: { id: 'fresh', name: null, category: null, credential_source: null, on_lan: true } } };
    credentials.fn.mockResolvedValue({ ok: true, format: 'json', added: 1, updated: 0, total: 1, complete: false, problems: [] });
    const { rerender } = render(<EnrollWizard onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/paste it/i), { target: { value: EXPORT } });
    fireEvent.click(screen.getByRole('button', { name: 'Import keys' }));
    await screen.findByText(/Imported: 1 added/);

    cloudFleet.value = { ...cloudFleet.value, byId: { fresh: { id: 'fresh', name: 'Outlet 9', category: 'pc', credential_source: 'imported', on_lan: true } } };
    rerender(<EnrollWizard onClose={() => {}} />);
    expect(screen.getByText('Import keys from a key tool').closest('details')).toHaveAttribute('open');
  });

  it('will not send an empty paste', () => {
    render(<EnrollWizard onClose={() => {}} />);
    openImport();
    expect(screen.getByRole('button', { name: 'Import keys' })).toBeDisabled();
  });

  it('lists skipped rows beside a successful import, so a missing key is not a silent omission', async () => {
    credentials.fn.mockResolvedValue({ ok: true, format: 'csv', added: 1, updated: 0, total: 1, complete: false, problems: ['BLE lock: no local key (a Bluetooth-only device has none)'] });
    render(<EnrollWizard onClose={() => {}} />);
    fireEvent.change(openImport(), { target: { value: EXPORT } });
    fireEvent.click(screen.getByRole('button', { name: 'Import keys' }));
    expect(await screen.findByText(/BLE lock: no local key/)).toBeInTheDocument();
  });
});
