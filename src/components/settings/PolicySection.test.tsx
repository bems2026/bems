import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { PolicySection } from './PolicySection';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';
import { useAuthStore } from '@/stores/authStore';

/**
 * RM-038. The property most of these defend: **this screen shows the floor that is IN FORCE**,
 * not the one that is stored and not the one this bundle was built with. A settings page that
 * displayed a rule nobody was enforcing would be worse than not showing it at all.
 */

vi.mock('@/config/supabase', () => ({ supabase: { rpc: vi.fn() } }));
const setAcuMinSetpoint = vi.fn();
vi.mock('@/lib/supabasePolicy', async (orig) => ({
  ...(await orig<typeof import('@/lib/supabasePolicy')>()),
  setAcuMinSetpoint: (...args: unknown[]) => setAcuMinSetpoint(...args),
}));

const load = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  setAcuMinSetpoint.mockReset().mockResolvedValue(24);
  load.mockClear();
  useAuthStore.setState({ status: 'authenticated', mode: 'supabase', email: 'operator@example.test' });
  useCapabilitiesStore.setState({ acuMinSetpointC: 25, policySource: 'database', load });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const field = () => screen.getByLabelText(/Coldest aircon setpoint/i) as HTMLInputElement;

describe('PolicySection', () => {
  it('shows the floor the bridge is actually applying', () => {
    render(<PolicySection />);
    expect(field().value).toBe('25');
  });

  it('follows the live value while nobody has typed, so a change by someone else is not overwritten', async () => {
    // The field is DERIVED from what is in force until it is touched. Holding a stale number and
    // then saving it would silently revert another operator's change.
    render(<PolicySection />);
    useCapabilitiesStore.setState({ acuMinSetpointC: 22 });
    await waitFor(() => expect(field().value).toBe('22'));
  });

  it('stops following once it has been typed in, so an edit is not yanked away mid-keystroke', async () => {
    render(<PolicySection />);
    fireEvent.change(field(), { target: { value: '18' } });
    useCapabilitiesStore.setState({ acuMinSetpointC: 22 });
    await waitFor(() => expect(field().value).toBe('18'));
  });

  it('saves the typed floor and re-reads what the bridge then reports', async () => {
    render(<PolicySection />);
    fireEvent.change(field(), { target: { value: '24' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(setAcuMinSetpoint).toHaveBeenCalledWith(24));
    // Not trusted from the write: the floor that matters is the one the PROXY now applies, and
    // that is a different process with its own cache.
    expect(load).toHaveBeenCalled();
  });

  it('sends null for an empty field, which is "no floor" and not zero', async () => {
    render(<PolicySection />);
    fireEvent.change(field(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(setAcuMinSetpoint).toHaveBeenCalledWith(null));
  });

  it('refuses a value the hardware has no code for, before asking the server', () => {
    render(<PolicySection />);
    fireEvent.change(field(), { target: { value: '12' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/between 16 and 30/);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(setAcuMinSetpoint).not.toHaveBeenCalled();
  });

  it('will not save what is already in force', () => {
    render(<PolicySection />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('says so when the bridge is applying its build value rather than the stored one', () => {
    // THE ONE THAT STOPS THIS SCREEN LYING. During a Supabase outage the proxy falls back to
    // what it was built with; presenting that as the current rule, with an editable field beside
    // it, would invite a change that silently does nothing.
    useCapabilitiesStore.setState({ policySource: 'build' });
    render(<PolicySection />);
    expect(screen.getByText(/could not read the stored policy/i)).toBeInTheDocument();
  });

  it('does not offer the edit to a break-glass session, which has no identity to attribute it to', () => {
    useAuthStore.setState({ mode: 'local', email: null });
    render(<PolicySection />);
    expect(field()).toBeDisabled();
    expect(screen.getByText(/needs a signed-in account/i)).toBeInTheDocument();
  });

  it('surfaces a refusal from the database instead of looking like it worked', async () => {
    setAcuMinSetpoint.mockRejectedValue(new Error('permission denied for function set_acu_min_setpoint'));
    render(<PolicySection />);
    fireEvent.change(field(), { target: { value: '24' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/permission denied/));
  });
});
