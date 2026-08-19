import { describe, it, expect, vi, afterEach } from 'vitest';
import { useAnomaliesStore } from './anomaliesStore';
import * as supabaseAnomalies from '@/lib/supabaseAnomalies';

vi.mock('@/config/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/supabaseAnomalies', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabaseAnomalies')>();
  return { ...actual, fetchRecentAnomalies: vi.fn() };
});

const anomalyRow = (deviceId: string) => ({
  device_id: deviceId, ts: '2026-08-19T09:00:00Z', metric: 'power_w', value: 400,
  baseline_mean: 100, baseline_stddev: 10, z_score: 30, iqr_lower: 70, iqr_upper: 130,
  method: 'both' as const, sample_count: 20,
});

afterEach(() => {
  // mockReset, not restoreAllMocks — restoreAllMocks only rewinds vi.spyOn spies back to
  // their original implementation; a plain vi.fn() built inside this file's vi.mock()
  // factory keeps its last mockResolvedValue/mockRejectedValue AND its call history across
  // tests otherwise (already caught once this session, in deviceConfigStore.test.ts).
  vi.mocked(supabaseAnomalies.fetchRecentAnomalies).mockReset();
  useAnomaliesStore.setState({ rows: [], status: 'idle' });
});

describe('useAnomaliesStore.load', () => {
  it('populates rows from a successful fetch', async () => {
    vi.mocked(supabaseAnomalies.fetchRecentAnomalies).mockResolvedValue([anomalyRow('co3')]);

    await useAnomaliesStore.getState().load();

    const { rows, status } = useAnomaliesStore.getState();
    expect(status).toBe('ready');
    expect(rows).toEqual([anomalyRow('co3')]);
  });
});
