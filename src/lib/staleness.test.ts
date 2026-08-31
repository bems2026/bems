import { describe, it, expect } from 'vitest';
import { isReadingStale, isReadingExpired, measured, staleWindowLabel, staleWindowMs } from './staleness';
import type { Reading, Totals } from './types';

const now = 1_786_000_000_000;
const fresh = new Date(now - 1000).toISOString();
const old = new Date(now - 31_000).toISOString();

describe('isReadingStale', () => {
  it('is stale when there is no reading yet', () => {
    expect(isReadingStale(null, now)).toBe(true);
    expect(isReadingStale(undefined, now)).toBe(true);
  });

  it('is stale when the bridge reports the device offline, even with a fresh timestamp', () => {
    const r: Reading = { device_id: 'co3', ts: fresh, online: false, state: 'off' };
    expect(isReadingStale(r, now)).toBe(true);
  });

  it('is not stale when online and recently updated', () => {
    const r: Reading = { device_id: 'co3', ts: fresh, online: true, state: 'on' };
    expect(isReadingStale(r, now)).toBe(false);
  });

  it('is stale when online but the timestamp stopped advancing 30s+ ago', () => {
    const r: Reading = { device_id: 'co3', ts: old, online: true, state: 'on' };
    expect(isReadingStale(r, now)).toBe(true);
  });

  /**
   * The reported bug, as a test. Outlets are polled every 60 s by the bridge
   * (`node-red-bridge/outletPollPlan.mjs`), so a healthy outlet's timestamp reaches ~60 s of
   * age once a minute, every minute. Under one global 30 s budget that made every outlet read
   * "stale" for half of each minute while Node-RED reported it connected throughout — and the
   * flapping reached the Devices table, the alerts bell, the 3D scene and, worst, command
   * reconciliation. The budget now travels on the row from `shared/registry.mjs`.
   */
  it('honours the budget the bridge sent for this device, so a 55s-old outlet reading is not stale', () => {
    const betweenPolls = new Date(now - 55_000).toISOString();
    const r: Reading = { device_id: 'co3', ts: betweenPolls, online: true, state: 'on', stale_after_ms: 150_000 };
    expect(isReadingStale(r, now)).toBe(false);
  });

  it('still goes stale once even its own budget is exceeded', () => {
    const r: Reading = { device_id: 'co3', ts: new Date(now - 151_000).toISOString(), online: true, state: 'on', stale_after_ms: 150_000 };
    expect(isReadingStale(r, now)).toBe(true);
  });

  it('a longer budget never excuses an offline device — that is a refusal, not lateness', () => {
    // The safety property. `online: false` is the bridge saying it has no connection at all,
    // and no amount of budget may launder that into "fresh".
    const r: Reading = { device_id: 'co3', ts: fresh, online: false, state: 'off', stale_after_ms: 150_000 };
    expect(isReadingStale(r, now)).toBe(true);
  });

  it('falls back to the 30s default when the bridge sent no budget', () => {
    // An older bridge, or the `_totals` row, which is not a device and has no cadence.
    const r: Reading = { device_id: 'co3', ts: old, online: true, state: 'on' };
    expect(isReadingStale(r, now)).toBe(true);
  });

  it('checks only the timestamp for the _totals row, which has no online field', () => {
    const freshTotals: Totals = {
      device_id: '_totals',
      ts: fresh,
      energy_kwh_today: 1,
      energy_kwh_week: 1,
      energy_kwh_month: 1,
      total_power_w: 1,
      avg_voltage: 220,
      phase_current: { red: 1, yellow: 1, blue: null },
    };
    const staleTotals: Totals = { ...freshTotals, ts: old };
    expect(isReadingStale(freshTotals, now)).toBe(false);
    expect(isReadingStale(staleTotals, now)).toBe(true);
  });
});

/**
 * Regression: outlets observed on site 2026-08-24 carrying a four-day-old voltage under a
 * timestamp stamped minutes earlier. The Outlet tab's parser refreshes `_last_time` on the
 * device's *connection* event while leaving the measurements untouched, so `online` stays
 * true, `ts` looks recent, and the numbers are memories. `isReadingStale` dims them;
 * nothing stopped them being rendered as figures.
 */
describe('isReadingExpired', () => {
  const minutes = (n: number) => new Date(now - n * 60_000).toISOString();

  it('has not expired while the reading is merely stale', () => {
    const r: Reading = { device_id: 'co1', ts: old, online: true, voltage: 235.9, state: 'off' };
    expect(isReadingStale(r, now)).toBe(true);
    expect(isReadingExpired(r, now)).toBe(false);
  });

  it('expires a reading whose timestamp stopped advancing long ago', () => {
    const r: Reading = { device_id: 'co1', ts: minutes(15), online: true, voltage: 235.9, state: 'off' };
    expect(isReadingExpired(r, now)).toBe(true);
  });

  it('expires a missing reading', () => {
    expect(isReadingExpired(null, now)).toBe(true);
    expect(isReadingExpired(undefined, now)).toBe(true);
  });

  /**
   * This originally asserted the opposite — that `online: false` alone must NOT expire a
   * reading, on the reasoning that a device which dropped a second after reporting still has a
   * real last value. That reasoning was wrong, for a reason not understood when it was written:
   * `shared/buildLatest.mjs` stamps `ts = now` and only overrides it when the device reports
   * its own time, so **an offline device's timestamp is synthesized**. Its age is therefore not
   * evidence of anything, and the age rule can never fire for it.
   *
   * Observed 2026-08-24: `co5` rendered `OFFLINE` beside `230.4 V / 2.23 A / 514 W`, values of
   * genuinely unknown age shown as current. That is the frozen-value failure in miniature.
   */
  it('expires an offline reading however fresh its timestamp looks, because that timestamp is synthesized', () => {
    const r: Reading = { device_id: 'co1', ts: fresh, online: false, voltage: 224.9, state: 'off' };
    expect(isReadingExpired(r, now)).toBe(true);
  });

  it('still keys on age for an online device, so a merely-late reading is not blanked', () => {
    const r: Reading = { device_id: 'co1', ts: old, online: true, voltage: 224.9, state: 'off' };
    expect(isReadingExpired(r, now)).toBe(false);
  });
});

describe('measured', () => {
  const minutes = (n: number) => new Date(now - n * 60_000).toISOString();

  it('passes the value through while the reading is still a measurement', () => {
    const r: Reading = { device_id: 'co1', ts: fresh, online: true, voltage: 224.9, state: 'off' };
    expect(measured(r.voltage, r, now)).toBe(224.9);
  });

  it('withholds the value once the reading has expired, so it formats as — and not as a figure', () => {
    const r: Reading = { device_id: 'co1', ts: minutes(15), online: true, voltage: 235.9, state: 'off' };
    expect(measured(r.voltage, r, now)).toBeUndefined();
  });

  it('withholds a zero just as readily as a number — a stale 0 W is the exact reading that looks idle', () => {
    const r: Reading = { device_id: 'co1', ts: minutes(15), online: true, power_w: 0, state: 'off' };
    expect(measured(r.power_w, r, now)).toBeUndefined();
  });
});

/**
 * The copy that quotes the window must quote the RIGHT window.
 *
 * Six places said "30 seconds" — true of a switch, wrong by a factor of five for an outlet, and
 * therefore a sentence that explained the badge by misdescribing it. A tooltip reading "no
 * reading in the last 30 seconds" beside a device the bridge polls once a minute teaches the
 * reader to distrust the flag rather than the device.
 */
describe('staleWindowLabel', () => {
  it('quotes the budget the bridge actually sent for this device', () => {
    const outlet: Reading = { device_id: 'co1', ts: fresh, online: true, state: 'on', stale_after_ms: 150_000 };
    expect(staleWindowLabel(outlet)).toBe('2.5 minutes');
  });

  it('stays in seconds while that reads naturally', () => {
    const light: Reading = { device_id: 'l1', ts: fresh, online: true, state: 'on', stale_after_ms: 30_000 };
    expect(staleWindowLabel(light)).toBe('30 seconds');
  });

  it('falls back to the 30s default for a row carrying no budget', () => {
    const legacy: Reading = { device_id: 'l1', ts: fresh, online: true, state: 'on' };
    expect(staleWindowLabel(legacy)).toBe('30 seconds');
    expect(staleWindowMs(legacy)).toBe(30_000);
  });
});
