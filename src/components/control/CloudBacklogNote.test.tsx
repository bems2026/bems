import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { CloudBacklogNote } from './CloudBacklogNote';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';

/**
 * RM-163 (2026-10-14). A week offline left 200,000 readings on the Pi while the Reports page showed those
 * days empty, with nothing on screen saying the data was safe and on its way.
 */

const NOW = Date.parse('2026-10-14T04:00:00Z');
const set = (b: { since: string | null; rows: number } | null) => useCapabilitiesStore.setState({ cloudBacklog: b ? { ...b, checkedAtMs: NOW } : null });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  set(null);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('CloudBacklogNote', () => {
  it('says logging is live on the Pi, how far behind the cloud is, and that reports wait', () => {
    set({ since: '2026-10-07T07:29:00Z', rows: 203_123 });
    const { container } = render(<CloudBacklogNote />);
    const text = container.textContent ?? '';
    expect(text).toMatch(/logging on the Pi is live/i);
    expect(text).toContain('6 days');
    expect(text).toContain('203,123');
    expect(text).toMatch(/reports for those days wait/i);
  });

  it('counts hours when it is less than a day behind', () => {
    set({ since: '2026-10-14T01:00:00Z', rows: 4_000 });
    const { container } = render(<CloudBacklogNote />);
    expect(container.textContent).toContain('3 hours');
  });

  it('stays silent within the normal upload cycle — a few minutes behind is not news', () => {
    set({ since: '2026-10-14T03:52:00Z', rows: 100 });
    const { container } = render(<CloudBacklogNote />);
    expect(container.querySelector('p')).toBeNull();
  });

  it('stays silent when the cloud has everything, and when the proxy never said', () => {
    set({ since: null, rows: 0 });
    expect(render(<CloudBacklogNote />).container.querySelector('p')).toBeNull();
    cleanup();
    set(null);
    expect(render(<CloudBacklogNote />).container.querySelector('p')).toBeNull();
  });
});
