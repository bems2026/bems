import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { PageCardsPanel } from './PageCardsPanel';
import { useSiteUiStore } from '@/stores/siteUiStore';
import { SITE_UI_DEFAULTS } from '@/lib/siteUi';

afterEach(() => {
  // vite.config.ts sets `globals: false`, so RTL's automatic cleanup never registers.
  cleanup();
  vi.restoreAllMocks();
  useSiteUiStore.setState({ prefs: { ...SITE_UI_DEFAULTS }, raw: null, canEdit: true, saving: false, error: null });
});

describe('PageCardsPanel', () => {
  it('reflects the stored preferences as switch state, for a screen reader as well as a sighted user', () => {
    useSiteUiStore.setState({ prefs: { controlPlanCard: false, overviewSceneCard: true } });
    render(<PageCardsPanel onClose={() => {}} />);
    expect(screen.getByRole('switch', { name: /Lighting & outlet plan/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: /3D model/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('flipping a switch saves that one preference and leaves the other alone', () => {
    const setPref = vi.fn();
    useSiteUiStore.setState({ setPref });
    render(<PageCardsPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('switch', { name: /3D model/ }));
    expect(setPref).toHaveBeenCalledWith('overviewSceneCard', false);
    expect(setPref).toHaveBeenCalledTimes(1);
  });

  /**
   * Local dev against `npm run mock` has no Supabase and never will. A panel that offers a
   * switch there is promising something it cannot do — the same distinction `spaceTreeStore`
   * draws with `canEdit`, and one that was found in a browser rather than by a test.
   */
  it('disables the switches and says why when Supabase is not configured', () => {
    useSiteUiStore.setState({ canEdit: false });
    render(<PageCardsPanel onClose={() => {}} />);
    expect(screen.getByRole('switch', { name: /3D model/ })).toBeDisabled();
    expect(screen.getByText(/not configured/i)).toBeInTheDocument();
  });

  it('surfaces a save failure rather than leaving the switch looking successful', () => {
    useSiteUiStore.setState({ error: 'permission denied' });
    render(<PageCardsPanel onClose={() => {}} />);
    expect(screen.getByText(/Could not save: permission denied/)).toBeInTheDocument();
  });

  it('says the setting is shared, because a kiosk that quietly differs is a support call', () => {
    render(<PageCardsPanel onClose={() => {}} />);
    expect(screen.getByText(/including the office kiosk/i)).toBeInTheDocument();
  });

  /**
   * The panel's copy is the only place an operator learns that hiding the plan is safe. If it
   * ever stops saying so, somebody will avoid a setting they were entitled to use — or worse,
   * use it and then wonder what else went with it.
   */
  it('tells the operator that hiding the plan costs no control', () => {
    render(<PageCardsPanel onClose={() => {}} />);
    expect(screen.getByText(/removes the picture and no control/i)).toBeInTheDocument();
  });

  it('closes without saving anything', () => {
    const onClose = vi.fn();
    const setPref = vi.fn();
    useSiteUiStore.setState({ setPref });
    render(<PageCardsPanel onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    expect(setPref).not.toHaveBeenCalled();
  });
});
