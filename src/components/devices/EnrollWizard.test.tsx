import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { EnrollWizard } from './EnrollWizard';
import { useDeviceStore } from '@/stores/deviceStore';
import type { Device } from '@/lib/types';

const cloudFleet = vi.hoisted(() => ({ value: { byId: {}, status: 'ready' } as Record<string, unknown> }));
vi.mock('@/hooks/useCloudFleet', () => ({ useCloudFleet: () => cloudFleet.value }));

const enroll = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/lib/enroll', () => ({ enrollDevice: enroll.fn }));

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
  cloudFleet.value = {
    status: 'ready',
    claimedKnown: true,
    byId: { 'vendor-new': { id: 'vendor-new', name: 'New Outlet', online: true }, 'vendor-co1': { id: 'vendor-co1', name: 'CO1', online: true, claimed: true } },
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
