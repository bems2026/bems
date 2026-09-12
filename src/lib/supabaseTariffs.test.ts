import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
vi.mock('@/config/supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }));

import { getTariffs, getEmissionFactors } from './supabaseTariffs';

/** A chainable stub ending in the awaited result. */
const result = (value: { data: unknown; error: unknown }) => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => Promise.resolve(value),
  };
  return chain;
};

beforeEach(() => from.mockReset());

describe('a database that has not reached phase38', () => {
  it('reads as "no rate entered" rather than failing the page', async () => {
    // The gap between deploying a bundle and pasting a migration is real, and so is a
    // replication site that has not run every step yet. A Reports page that fails to load
    // because a tariff table is absent would be reporting the wrong problem.
    from.mockReturnValue(result({ data: null, error: { code: '42P01', message: 'relation does not exist' } }));
    await expect(getTariffs()).resolves.toEqual([]);
    await expect(getEmissionFactors()).resolves.toEqual([]);
  });

  it('still throws on anything else, because those mean something different', async () => {
    // A permission failure is not "no tariff configured". Swallowing it would have the page
    // quietly say no rate is entered when one is, and nobody would know to look.
    from.mockReturnValue(result({ data: null, error: { code: '42501', message: 'permission denied' } }));
    await expect(getTariffs()).rejects.toThrow(/permission denied/);
  });
});
