import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// `cleanup` explicitly: vite.config.ts sets `globals: false`, so RTL's automatic afterEach
// never registers and a previous test's DOM would otherwise still be mounted — which shows up
// as "found multiple elements" rather than as anything that looks like a leak.
import { render, screen, cleanup } from '@testing-library/react';
import { DispatchPathNote } from './DispatchPathNote';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';
import { useCommandStore } from '@/stores/commandStore';
import { useDeviceStore } from '@/stores/deviceStore';
import type { Device } from '@/lib/types';

const light = (n: number): Device => ({
  id: `l${n}`,
  display_name: `Light Switch ${n}`,
  class: 'switch',
  room: null,
  dps_map: null,
  status: 'active',
});

describe('DispatchPathNote', () => {
  beforeEach(() => {
    useCapabilitiesStore.setState({ dispatchPolicy: null, cloudFallbackConfigured: null });
    useCommandStore.setState({ cloudRecoveries: {} });
    useDeviceStore.setState({ devices: [light(1)] });
  });

  afterEach(() => {
    cleanup();
  });

  it('says nothing at all when the proxy has not reported a policy and nothing has needed the cloud', () => {
    // An older proxy is UNKNOWN, not local-first. Inventing a guarantee from an absent answer
    // is the mistake dispatchClasses already distinguishes against, and a false claim about
    // where a building control system sends its commands is a bad one to invent.
    const { container } = render(<DispatchPathNote />);
    expect(container).toBeEmptyDOMElement();
  });

  it('distinguishes local-first-with-a-fallback from local-first-with-none', () => {
    // Behaviourally identical today, completely different promises about tomorrow — so they
    // must not render the same sentence.
    useCapabilitiesStore.setState({ dispatchPolicy: 'local-first', cloudFallbackConfigured: true });
    const { unmount } = render(<DispatchPathNote />);
    expect(screen.getByText(/falling back to the vendor cloud/i)).toBeInTheDocument();
    unmount();

    useCapabilitiesStore.setState({ dispatchPolicy: 'local-first', cloudFallbackConfigured: false });
    render(<DispatchPathNote />);
    expect(screen.getByText(/no vendor fallback is configured/i)).toBeInTheDocument();
  });

  it('states local-only plainly, with no mention of a fallback that cannot happen', () => {
    useCapabilitiesStore.setState({ dispatchPolicy: 'local-only', cloudFallbackConfigured: true });
    render(<DispatchPathNote />);
    expect(screen.getByText(/local network only/i)).toBeInTheDocument();
    expect(screen.queryByText(/falling back/i)).not.toBeInTheDocument();
  });

  /**
   * The line this component is really for. A cloud-recovered command SUCCEEDED, so the operator
   * sees an ordinary success — while it means that device has stopped answering on the LAN.
   * That is the earliest warning available that a device is going bad, and it previously showed
   * only in the alerts bell and a database column.
   */
  it('names a device that answered only through the vendor cloud, by its display name', () => {
    useCapabilitiesStore.setState({ dispatchPolicy: 'local-first', cloudFallbackConfigured: true });
    useCommandStore.setState({ cloudRecoveries: { l1: Date.now() } });
    render(<DispatchPathNote />);
    expect(screen.getByText('Light Switch 1')).toBeInTheDocument();
    expect(screen.getByText(/no longer reachable on the local network/i)).toBeInTheDocument();
  });

  it('reports a cloud recovery even when the policy is unknown, because the fault does not depend on it', () => {
    useCommandStore.setState({ cloudRecoveries: { l1: Date.now() } });
    render(<DispatchPathNote />);
    expect(screen.getByText('Light Switch 1')).toBeInTheDocument();
  });
});
