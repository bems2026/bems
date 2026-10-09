import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { LoginPage } from './LoginPage';
import { useAuthStore } from '@/stores/authStore';

/**
 * 2026-10-09. The office Wi-Fi lost its internet and the kiosk landed on this page, where every
 * account sign-in failed with "Failed to fetch" and the local sign-in never appeared. The page's one
 * job in that state is to get somebody standing at the screen back in without the internet.
 */

vi.mock('@/config/supabase', () => ({ supabase: null }));

const signInWithPassword = vi.fn();
const signInLocal = vi.fn();

beforeEach(() => {
  signInWithPassword.mockReset();
  signInLocal.mockReset().mockResolvedValue({ ok: true });
  useAuthStore.setState({ status: 'unauthenticated', mode: null, email: null, accountServiceUnreachable: false, signInWithPassword, signInLocal });
});

afterEach(() => cleanup());

const password = () => screen.getByLabelText(/password/i) as HTMLInputElement;

describe('LoginPage', () => {
  it('always offers the local sign-in, so it never depends on the account service failing in a way the page recognises', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in locally/i })).toBeInTheDocument();
  });

  it('leads with the local sign-in, and says why, when the account service is unreachable', () => {
    useAuthStore.setState({ accountServiceUnreachable: true });
    render(<LoginPage />);
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/internet/i);
    expect(screen.getByRole('button', { name: /^sign in locally$/i })).toBeInTheDocument();
  });

  it('switches to the local sign-in when an account sign-in finds no internet', async () => {
    signInWithPassword.mockImplementation(async () => {
      useAuthStore.setState({ accountServiceUnreachable: true });
      return { ok: false, error: 'Cannot reach the account service — the internet connection may be down. Use local sign-in instead.', networkError: true };
    });
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'ops@care.test' } });
    fireEvent.change(password(), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent(/cannot reach the account service/i);
    // The account password is not the local one: the field starts empty.
    expect(password().value).toBe('');
  });

  it('signs in locally with the local password', async () => {
    useAuthStore.setState({ accountServiceUnreachable: true });
    render(<LoginPage />);
    fireEvent.change(password(), { target: { value: 'local-pw' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in locally$/i }));
    await waitFor(() => expect(signInLocal).toHaveBeenCalledWith('local-pw'));
  });

  it('can go back to the account sign-in from the local one', () => {
    useAuthStore.setState({ accountServiceUnreachable: true });
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /account instead/i }));
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });
});
