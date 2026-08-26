import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { SegmentPresenceNote } from './SegmentPresenceNote';
import { PRESENCE_ON_SEGMENT, PRESENCE_ABSENT } from '@/lib/devicePresence';

const reply = (body: unknown, status = 200) =>
  vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body, text: async () => String(status) });

beforeEach(() => vi.stubGlobal('fetch', reply({ devices: [], arp_readable: true })));

/**
 * Renders and drains the fetch -> json -> setState chain before returning.
 *
 * Written the obvious way — `render` then `waitFor(() => expect(...).toBeNull())` — two of the
 * tests below passed with the code they were guarding deleted. `waitFor` is satisfied by the
 * FIRST render, which returns null because the request has not come back yet, so an assertion
 * that something is absent was answered before the component had a chance to show it. Every
 * "expect nothing" test needs the component to have settled first, or it proves nothing.
 */
async function renderSettled(ui: React.ReactElement) {
  const utils = render(ui);
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  return utils;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SegmentPresenceNote', () => {
  it('renders nothing when every dark device is accounted for', async () => {
    // A healthy fleet should not have to render a zero. Same rule as the unstable count in
    // the page header, which is omitted rather than shown as "0 unstable".
    const { container } = await renderSettled(<SegmentPresenceNote />);
    expect(container.querySelector('p')).toBeNull();
  });

  it('names the devices that need a person separately from the ones that do not', async () => {
    // The whole point. These two sentences send somebody to the office or save them the trip,
    // so they must never be merged into one count of "offline devices".
    vi.stubGlobal('fetch', reply({
      arp_readable: true,
      devices: [
        { id: 'a', name: 'CO4', cloud_online: false, presence: PRESENCE_ABSENT },
        { id: 'b', name: 'CO5', cloud_online: false, presence: PRESENCE_ON_SEGMENT, arp_state: 'STALE' },
      ],
    }));
    render(<SegmentPresenceNote />);
    expect(await screen.findByText(/CO4 off the network/)).toBeInTheDocument();
    expect(await screen.findByText(/CO5 still on the segment/)).toBeInTheDocument();
  });

  it('says it cannot tell, rather than going quiet, when there is no ARP table', async () => {
    // Silence here would be indistinguishable from "all clear". In this deployment the server
    // IS the Pi, so a server that cannot read a neighbour table is itself the news.
    vi.stubGlobal('fetch', reply({ arp_readable: false, devices: [{ id: 'a', name: 'CO4', cloud_online: false, presence: null }] }));
    render(<SegmentPresenceNote />);
    expect(await screen.findByText(/Segment presence unavailable/)).toBeInTheDocument();
  });

  it('stays silent when the deployment has no vendor credentials', async () => {
    // 501 is a configuration state, not a fault. A site never given credentials should not be
    // shown an error for a diagnostic it was never offered.
    vi.stubGlobal('fetch', reply({ error: 'tuya_not_configured' }, 501));
    const { container } = await renderSettled(<SegmentPresenceNote />);
    expect(container.querySelector('p')).toBeNull();
  });
});
