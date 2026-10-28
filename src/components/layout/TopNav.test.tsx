import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TopNav } from './TopNav';
import { useEdgeStatusStore } from '@/stores/edgeStatusStore';
import { useAlertsPanelStore } from '@/stores/alertsPanelStore';

/*
 * RM-165. The live pill measures the proxy, which answers with or without the internet; from 15 to 28 October
 * the page looked live while the edge logged on its own and 566,000 rows waited. A chip beside it says so.
 */

afterEach(() => {
  cleanup();
  useEdgeStatusStore.setState({ status: null });
  useAlertsPanelStore.setState({ open: false });
});

const status = (state: 'online' | 'offline', waiting: number) => ({ state, waiting, lastUploadOkAt: null, lastUploadFailAt: null, frozen: [] });

describe('TopNav — the site link chip', () => {
  it('says the edge is logging offline, and opens the bell for why', () => {
    useEdgeStatusStore.setState({ status: status('offline', 566184) });
    render(<TopNav activeId="overview" />);
    const chip = screen.getByRole('button', { name: /No internet at the site/ });
    expect(chip.textContent).toBe('Offline logging');
    fireEvent.click(chip);
    expect(useAlertsPanelStore.getState().open).toBe(true);
  });

  it('counts down while catching up, and is gone once caught up or unknown', () => {
    useEdgeStatusStore.setState({ status: status('online', 205799) });
    render(<TopNav activeId="overview" />);
    expect(screen.getByRole('button', { name: /catching up/ }).textContent).toBe('Syncing 205,799');
    cleanup();
    useEdgeStatusStore.setState({ status: status('online', 80) });
    render(<TopNav activeId="overview" />);
    expect(screen.queryByRole('button', { name: /No internet|catching up/ })).toBeNull();
    cleanup();
    useEdgeStatusStore.setState({ status: null });
    render(<TopNav activeId="overview" />);
    expect(screen.queryByRole('button', { name: /No internet|catching up/ })).toBeNull();
  });
});
