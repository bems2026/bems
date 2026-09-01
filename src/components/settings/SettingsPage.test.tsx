import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { SettingsPage } from './SettingsPage';
import { AccountSection } from './AccountSection';
import { useAuthStore } from '@/stores/authStore';
import { useSpaceTreeStore } from '@/stores/spaceTreeStore';

afterEach(() => {
  // vite.config.ts sets `globals: false`, so RTL's automatic cleanup never registers.
  cleanup();
  useAuthStore.setState({ mode: null, email: null });
  useSpaceTreeStore.setState({ nodes: [], canEdit: false, error: null, mutating: false });
});

describe('SettingsPage', () => {
  it('opens on the section list rather than guessing which section was wanted', () => {
    render(<SettingsPage />);
    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument();
    expect(screen.getByText(/Choose a section/)).toBeInTheDocument();
  });

  it('offers exactly the sections this deployment can actually configure', () => {
    render(<SettingsPage />);
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect([...nav.querySelectorAll('.settings__item-label')].map((e) => e.textContent)).toEqual([
      'Account',
      'Spaces',
      'Floor plan',
      'Page cards',
      'Deployment',
    ]);
  });

  it('opens a section and marks it current for assistive technology, not just visually', () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByText('Deployment'));
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    const active = within(nav).getByRole('button', { current: 'page' });
    expect(active).toHaveTextContent('Deployment');
  });

  it('offers a way back only once a section is open', () => {
    // On a phone the list is hidden while a section is open, so this button is the only way out.
    // Rendering it on the list itself would be a control that goes nowhere.
    render(<SettingsPage />);
    expect(screen.queryByRole('button', { name: /All settings/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Deployment'));
    fireEvent.click(screen.getByRole('button', { name: /All settings/ }));
    expect(screen.getByText(/Choose a section/)).toBeInTheDocument();
  });

  it('renders the moved panels without a Close button, because they are sections and not overlays', () => {
    // `onClose` is optional precisely so one component can be both a panel and a section. A
    // Close button here would suggest an overlay that can be dismissed back to something.
    render(<SettingsPage />);
    fireEvent.click(screen.getByText('Spaces'));
    expect(screen.getByRole('heading', { name: 'Spaces' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });
});

/**
 * The account section's job is to say what the SESSION can do, not who is signed in. A
 * break-glass session is view-only — `handleCommand` refuses it outright, because there is no
 * real user id to attribute an audit row to. Someone who does not know which kind they hold will
 * read a refused command as a broken system.
 */
describe('AccountSection', () => {
  it('says a break-glass session cannot switch anything, and why', () => {
    useAuthStore.setState({ mode: 'local', email: null });
    render(<AccountSection />);
    expect(screen.getByText(/view only/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot be reached/i)).toBeInTheDocument();
  });

  it('shows the account a full session is attributed to', () => {
    useAuthStore.setState({ mode: 'supabase', email: 'operator@example.org' });
    render(<AccountSection />);
    expect(screen.getByText('operator@example.org')).toBeInTheDocument();
    expect(screen.queryByText(/view only/i)).not.toBeInTheDocument();
  });

  it('offers no password field, on a screen that lives in a shared office', () => {
    useAuthStore.setState({ mode: 'supabase', email: 'operator@example.org' });
    const { container } = render(<AccountSection />);
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });

  it('offers no sign-out when there is no session to end', () => {
    render(<AccountSection />);
    expect(screen.queryByRole('button', { name: /Sign out/ })).not.toBeInTheDocument();
  });
});
