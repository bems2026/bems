import { describe, it, expect, vi, afterEach } from 'vitest';
import { useCapabilitiesStore } from './capabilitiesStore';
import * as bridgeClient from '@/lib/bridgeClient';

vi.mock('@/lib/bridgeClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bridgeClient')>();
  return { ...actual, getCapabilities: vi.fn() };
});

afterEach(() => {
  vi.restoreAllMocks();
  useCapabilitiesStore.setState({ hardwareDispatchEnabled: null, dispatchClasses: null });
});

describe('useCapabilitiesStore.load', () => {
  it('starts null (unknown), never defaulting to true before a real response confirms it', () => {
    expect(useCapabilitiesStore.getState().hardwareDispatchEnabled).toBeNull();
  });

  it('sets hardwareDispatchEnabled from a successful response', async () => {
    vi.mocked(bridgeClient.getCapabilities).mockResolvedValue({ hardware_dispatch_enabled: false, dispatch_classes: [] });
    await useCapabilitiesStore.getState().load();
    expect(useCapabilitiesStore.getState().hardwareDispatchEnabled).toBe(false);
  });

  it('reflects true once a real deployment opens the gate', async () => {
    vi.mocked(bridgeClient.getCapabilities).mockResolvedValue({ hardware_dispatch_enabled: true, dispatch_classes: ['switch'] });
    await useCapabilitiesStore.getState().load();
    expect(useCapabilitiesStore.getState().hardwareDispatchEnabled).toBe(true);
  });

  it('leaves the flag null (not false) on a failed load, so the UI keeps treating it as unconfirmed rather than a false "definitely closed" it never actually received', async () => {
    vi.mocked(bridgeClient.getCapabilities).mockRejectedValue(new Error('network error'));
    const loadPromise = useCapabilitiesStore.getState().load();
    await loadPromise;
    expect(useCapabilitiesStore.getState().hardwareDispatchEnabled).toBeNull();
  });

  it('carries dispatch_classes through, so the UI can say which controls are live rather than just that the gate is open', async () => {
    vi.mocked(bridgeClient.getCapabilities).mockResolvedValue({ hardware_dispatch_enabled: true, dispatch_classes: ['switch'] });
    await useCapabilitiesStore.getState().load();
    expect(useCapabilitiesStore.getState().dispatchClasses).toEqual(['switch']);
  });

  it('leaves dispatchClasses null on a failed load — an empty array would read as "confirmed: nothing dispatches", which is a claim it never received', async () => {
    vi.mocked(bridgeClient.getCapabilities).mockRejectedValue(new Error('network error'));
    await useCapabilitiesStore.getState().load();
    expect(useCapabilitiesStore.getState().dispatchClasses).toBeNull();
  });
});
