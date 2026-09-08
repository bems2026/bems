/**
 * The parts of the phase28 history queries that make a decision.
 *
 * Same division as `supabaseHistory.test.ts`: the `supabase.from(...)` calls are not unit-tested
 * here — they are a column list and a filter, and mocking the query builder would test the mock.
 * What IS tested is everything with a judgement in it, because each of these has a wrong answer
 * that would look plausible on screen.
 */
import { describe, it, expect } from 'vitest';
import { energyBetween, DEGRADED_NET_STATES, TROUBLE_LOOKBACK_MS } from './supabaseCapabilityHistory';

describe('DEGRADED_NET_STATES', () => {
  it('does not treat local_net as trouble', () => {
    // THE ONE THAT WOULD BE BACKWARDS. `shared/sites/<id>/site.mjs` sets `dispatch: local-first`,
    // so the LAN is where this system WANTS its devices. Reporting it as degraded would make the
    // feature flag its own preferred state as a fault, on every meter, for ever.
    expect(DEGRADED_NET_STATES).not.toContain('local_net');
  });

  it('does not treat cloud_net as trouble either', () => {
    // Normal for a device that also talks to the vendor — and what all four meters report today,
    // so getting this wrong would put the whole fleet in the trouble list on day one.
    expect(DEGRADED_NET_STATES).not.toContain('cloud_net');
  });

  it('treats no_net as trouble', () => {
    expect(DEGRADED_NET_STATES).toContain('no_net');
  });

  it('names only values the vendor vocabulary actually has', () => {
    // phase28's CHECK constraint allows exactly these three; a fourth here would filter on a
    // value no row can hold and quietly return nothing for ever.
    for (const v of DEGRADED_NET_STATES) expect(['cloud_net', 'local_net', 'no_net']).toContain(v);
  });
});

describe('energyBetween', () => {
  const row = (ts: string, total_energy_kwh: number | null) => ({ ts, total_energy_kwh });

  it('differences the first and last lifetime reading', () => {
    const span = energyBetween([
      row('2026-09-08T09:00:00Z', 33184.4),
      row('2026-09-08T10:00:00Z', 33185.1),
      row('2026-09-08T11:00:00Z', 33186.0),
    ]);
    expect(span.kwh).toBeCloseTo(1.6, 6);
    expect(span.from).toBe('2026-09-08T09:00:00Z');
    expect(span.to).toBe('2026-09-08T11:00:00Z');
  });

  it('REFUSES to difference across a counter reset', () => {
    // phase28 stores this raw precisely because it is "monotonic except across a device reset".
    // A reset makes the difference not a quantity of electricity, and the two tempting answers —
    // a negative number, or its absolute value — are both fabrications. `null` with a reason is
    // the only honest output, and it is the same choice the scrub makes for an impossible field.
    const span = energyBetween([
      row('2026-09-08T09:00:00Z', 33184.4),
      row('2026-09-08T10:00:00Z', 12.5),
    ]);
    expect(span.kwh).toBeNull();
    expect(span.reason).toMatch(/reset/);
    expect(span.from).toBe('2026-09-08T09:00:00Z');
  });

  it('a flat counter is zero consumed, not a refusal', () => {
    // An idle circuit is a real answer. Only a DECREASE is impossible.
    const span = energyBetween([row('t1', 100), row('t2', 100)]);
    expect(span.kwh).toBe(0);
    expect(span.reason).toBeUndefined();
  });

  it('needs two readings, and says so rather than returning zero', () => {
    // Zero would read as "this meter used nothing", which is a measurement. It made none.
    expect(energyBetween([]).kwh).toBeNull();
    expect(energyBetween([row('t1', 100)]).kwh).toBeNull();
    expect(energyBetween([row('t1', 100)]).reason).toMatch(/not enough/);
  });

  it('ignores rows with no lifetime value rather than treating them as zero', () => {
    // Every outlet and every switch has `total_energy_kwh: null` on every row. Coercing those
    // would difference against a counter that does not exist.
    const span = energyBetween([
      row('2026-09-08T09:00:00Z', null),
      row('2026-09-08T10:00:00Z', 500),
      row('2026-09-08T11:00:00Z', null),
      row('2026-09-08T12:00:00Z', 502),
    ]);
    expect(span.kwh).toBe(2);
    expect(span.from).toBe('2026-09-08T10:00:00Z');
    expect(span.to).toBe('2026-09-08T12:00:00Z');
  });

  it('a device that reports nothing at all yields null, not an error', () => {
    expect(energyBetween([row('t1', null), row('t2', null)]).kwh).toBeNull();
  });

  it('does not depend on the caller ordering the rows', () => {
    const span = energyBetween([row('2026-09-08T11:00:00Z', 110), row('2026-09-08T09:00:00Z', 100)]);
    expect(span.kwh).toBe(10);
    expect(span.from).toBe('2026-09-08T09:00:00Z');
  });
});

describe('the lookback window', () => {
  it('is a week — long enough to cover a weekend plus a public holiday', () => {
    expect(TROUBLE_LOOKBACK_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
