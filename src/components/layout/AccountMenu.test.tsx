import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AccountMenu } from './AccountMenu';
import { useAuthStore } from '@/stores/authStore';

vi.mock('@/config/supabase', () => ({ supabase: {} }));

// `globals: false` in vite.config.ts means Testing Library's auto-cleanup never registers —
// same convention as AppShell.test.tsx and ErrorBoundary.test.tsx.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAuthStore.setState({ status: 'checking', mode: null, email: null });
});

beforeEach(() => {
  useAuthStore.setState({ status: 'authenticated', mode: 'supabase', email: 'operator@example.test' });
});

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: /account/i }));
}

describe('AccountMenu', () => {
  it('keeps the menu shut until it is asked for', () => {
    render(<AccountMenu activeId="overview" />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /account/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('offers Reports and Sign out once opened', () => {
    render(<AccountMenu activeId="overview" />);
    openMenu();
    expect(screen.getByRole('menuitem', { name: /reports/i })).toHaveAttribute('href', '#reports');
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument();
  });

  it('closes on Escape, so the menu is never left covering the nav', () => {
    render(<AccountMenu activeId="overview" />);
    openMenu();
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes when Reports is chosen, rather than staying open over the page it opened', () => {
    render(<AccountMenu activeId="overview" />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /reports/i }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('marks the trigger as current when Reports is the open page', () => {
    // Reports has no tab in the nav bar any more, so without this there is nothing on
    // screen indicating which page you are on while viewing it.
    render(<AccountMenu activeId="reports" />);
    expect(screen.getByRole('button', { name: /account/i })).toHaveAttribute('aria-current', 'page');
  });

  it('shows who is signed in inside the menu, not on the open nav', () => {
    // The nav is on a screen in a shared office; the email is deliberately not printed
    // there. Behind a click it is useful rather than exposed.
    render(<AccountMenu activeId="overview" />);
    expect(screen.queryByText('operator@example.test')).not.toBeInTheDocument();
    openMenu();
    expect(screen.getByText('operator@example.test')).toBeInTheDocument();
  });

  it('calls signOut when Sign out is chosen', () => {
    const signOut = vi.fn();
    useAuthStore.setState({ signOut } as never);
    render(<AccountMenu activeId="overview" />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /sign out/i }));
    expect(signOut).toHaveBeenCalledOnce();
  });

  describe('break-glass (local) session', () => {
    beforeEach(() => {
      useAuthStore.setState({ status: 'authenticated', mode: 'local', email: null });
    });

    it('keeps the LOCAL warning visible on the nav, never hidden behind the menu', () => {
      // A local session is LAN-only and cannot issue commands. Burying that behind a click
      // would make a degraded session look like an ordinary one at a glance, which is the
      // one thing authStore's own comments insist must never happen.
      render(<AccountMenu activeId="overview" />);
      expect(screen.getByText('LOCAL')).toBeInTheDocument();
    });

    it('says what a local session cannot do, once opened', () => {
      render(<AccountMenu activeId="overview" />);
      openMenu();
      expect(screen.getByText(/LAN only/i)).toBeInTheDocument();
    });
  });

  describe('with no session at all', () => {
    beforeEach(() => {
      useAuthStore.setState({ status: 'checking', mode: null, email: null });
    });

    it('still reaches Reports, and offers no sign-out there is no session for', () => {
      // Reports left the tab bar, so if the menu vanished without a session the page would
      // become unreachable from the UI entirely.
      render(<AccountMenu activeId="overview" />);
      openMenu();
      expect(screen.getByRole('menuitem', { name: /reports/i })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /sign out/i })).not.toBeInTheDocument();
    });
  });
});
