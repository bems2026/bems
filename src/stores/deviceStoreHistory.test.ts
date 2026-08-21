import { describe, it, expect, beforeEach } from 'vitest';
import { useDeviceStore, historyFor } from './deviceStore';
import type { HistoryPoint } from '@/lib/types';

const pts = (n: number): HistoryPoint[] =>
  Array.from({ length: n }, (_, i) => ({ ts: `t${i}`, power_w: i }));

describe('range-tagged history', () => {
  beforeEach(() => useDeviceStore.setState({ history: {} }));

  it('returns the points when the stored range matches', () => {
    useDeviceStore.getState().setHistory('mtr_a', pts(3), '7d');
    expect(historyFor(useDeviceStore.getState().history, 'mtr_a', '7d')).toHaveLength(3);
  });

  it('returns nothing when the stored series was fetched for a different range', () => {
    // The bug: one untagged map was shared by writers asking for different windows, so
    // 24h points were charted under a 7d label — the same class of fault as the
    // supabaseHistory truncation, a confident chart over data that isn't what it says.
    useDeviceStore.getState().setHistory('mtr_a', pts(3), '24h');
    expect(historyFor(useDeviceStore.getState().history, 'mtr_a', '7d')).toEqual([]);
  });

  it('keeps stale points off screen when the new range FAILS to load', () => {
    // useAnalyticsHistory only writes on success and never clears. Before tagging, a failed
    // 7d fetch left the 24h points rendering indefinitely, because the page's "history
    // unavailable" message only appears when there are no rows at all.
    useDeviceStore.getState().setHistory('mtr_a', pts(5), '24h');
    // ...user switches to 7d, the RPC errors, nothing is written...
    expect(historyFor(useDeviceStore.getState().history, 'mtr_a', '7d')).toEqual([]);
  });

  it("does not let Overview's 24h fetch overwrite what Analytics is showing at 7d", () => {
    // EnergyFlowCard writes into the same map and always asks for 24h, so visiting Overview
    // and coming back used to re-stamp every meter's series.
    useDeviceStore.getState().setHistory('mtr_a', pts(9), '7d');
    useDeviceStore.getState().setHistory('mtr_a', pts(2), '24h');
    expect(historyFor(useDeviceStore.getState().history, 'mtr_a', '7d')).toEqual([]);
    expect(historyFor(useDeviceStore.getState().history, 'mtr_a', '24h')).toHaveLength(2);
  });

  it('returns nothing for a device that has no history at all', () => {
    expect(historyFor(useDeviceStore.getState().history, 'nobody', '24h')).toEqual([]);
  });

  it('returns a stable empty reference, so a selector cannot churn its subscriber', () => {
    // historyFor runs inside zustand selectors; a fresh [] each call would re-render the
    // subscriber on every unrelated store change.
    const a = historyFor(useDeviceStore.getState().history, 'nobody', '24h');
    const b = historyFor(useDeviceStore.getState().history, 'nobody', '24h');
    expect(a).toBe(b);
  });

  it('keeps each device independent', () => {
    useDeviceStore.getState().setHistory('mtr_a', pts(3), '7d');
    useDeviceStore.getState().setHistory('mtr_b', pts(4), '24h');
    expect(historyFor(useDeviceStore.getState().history, 'mtr_a', '7d')).toHaveLength(3);
    expect(historyFor(useDeviceStore.getState().history, 'mtr_b', '24h')).toHaveLength(4);
    expect(historyFor(useDeviceStore.getState().history, 'mtr_b', '7d')).toEqual([]);
  });
});
