/**
 * Turning a per-minute reading series into the few moments worth reading.
 *
 * phase28 stores what a device reports beyond volts, amps and watts, and its migration names the
 * four questions that were previously unanswerable. Three of them are about WHEN something
 * changed:
 *
 *   - "Which branch tripped its power warning, and when?"
 *   - "Did this outlet report a fault before it went dark?"
 *   - "Was the device on the cloud or the local network when it stopped answering?"
 *
 * THE SHAPE OF THE ANSWER IS NOT A ROW LIST. `readings` holds one row per device per minute —
 * 1,440 a day each, and on a healthy fleet every one of them says the same thing. A query that
 * returns rows returns thousands of identical answers to "when did this go wrong". What a person
 * asking that question wants is the EPISODE: it started here, ended here, lasted this long.
 *
 * SO THE ONLY REAL DECISION IS WHERE ONE EPISODE ENDS AND THE NEXT BEGINS, and it is not simply
 * "the value changed". A device that reports a fault, goes off the air for two hours, comes back
 * still faulted and is fixed an hour later did not have one three-hour fault — it had two
 * episodes with a hole between them, and the hole is part of the story. Consecutive samples more
 * than `EPISODE_GAP_MS` apart therefore split, the same reasoning as the bridge's
 * `MAX_INTEGRATION_GAP_MS` and phase31's weight cap: past some spacing, joining two observations
 * asserts something nobody measured.
 *
 * NOTHING ABNORMAL EXISTS ON THIS FLEET YET — checked 2026-09-08, zero rows with `power_type =
 * warn`, zero with `fault <> 0`, zero with `net_state <> cloud_net`. So every fixture here is
 * constructed, and the empty result is a first-class case: "nothing since Tuesday" is an answer,
 * not a blank.
 */
import { describe, it, expect } from 'vitest';
import { CAPABILITY_PROFILES } from '@shared/deviceCapabilities.mjs';
import {
  foldEpisodes, describeEpisode, EPISODE_GAP_MS, FAULT_BIT_LABELS,
  type EpisodeSample, type CapabilityEpisode,
} from './capabilityEpisodes';

const t = (minutes: number) => new Date(Date.parse('2026-09-08T09:00:00Z') + minutes * 60_000).toISOString();
const s = (minutes: number, value: EpisodeSample['value'], device_id = 'co5'): EpisodeSample =>
  ({ device_id, ts: t(minutes), value });

describe('folding samples into episodes', () => {
  it('returns nothing for nothing — the healthy answer', () => {
    expect(foldEpisodes([], 'fault')).toEqual([]);
  });

  it('collapses a run of identical samples into one episode', () => {
    const out = foldEpisodes([s(0, 4), s(1, 4), s(2, 4)], 'fault');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ device_id: 'co5', kind: 'fault', value: 4, from: t(0), to: t(2), samples: 3 });
  });

  it('a single sample is still an episode, and starts and ends at itself', () => {
    // One minute of a fault is the case most likely to be dismissed as noise, and is exactly
    // what "did it report anything before it went dark" is asking about.
    const out = foldEpisodes([s(0, 1)], 'fault');
    expect(out).toEqual([{ device_id: 'co5', kind: 'fault', value: 1, from: t(0), to: t(0), samples: 1 }]);
  });

  it('splits when the value changes', () => {
    // Over-current then under-voltage is two different faults, not one long one.
    const out = foldEpisodes([s(0, 1), s(1, 1), s(2, 32), s(3, 32)], 'fault');
    expect(out.map((e) => e.value)).toEqual([1, 32]);
    expect(out[0].to).toBe(t(1));
    expect(out[1].from).toBe(t(2));
  });

  it('splits when the device goes quiet for longer than the gap, even at the same value', () => {
    // THE DECISION THIS FILE EXISTS FOR. Joining these would report one continuous fault across
    // a period nobody observed, which is a claim the data does not support.
    const gapMinutes = EPISODE_GAP_MS / 60_000 + 5;
    const out = foldEpisodes([s(0, 1), s(1, 1), s(gapMinutes, 1), s(gapMinutes + 1, 1)], 'fault');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ from: t(0), to: t(1), samples: 2 });
    expect(out[1]).toMatchObject({ from: t(gapMinutes), to: t(gapMinutes + 1), samples: 2 });
  });

  it('a gap just inside the threshold keeps one episode', () => {
    const within = EPISODE_GAP_MS / 60_000 - 1;
    expect(foldEpisodes([s(0, 1), s(within, 1)], 'fault')).toHaveLength(1);
  });

  it('never joins two devices into one episode', () => {
    // The rows come back ordered by time, so two devices interleave. Folding on value alone
    // would attribute one outlet's fault to another.
    const out = foldEpisodes([s(0, 1, 'co5'), s(0, 1, 'co6'), s(1, 1, 'co5'), s(1, 1, 'co6')], 'fault');
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.device_id).sort()).toEqual(['co5', 'co6']);
    for (const e of out) expect(e.samples).toBe(2);
  });

  it('handles string values, for net_state and power_type', () => {
    const out = foldEpisodes([s(0, 'no_net'), s(1, 'no_net'), s(2, 'local_net')], 'net_degraded');
    expect(out.map((e) => e.value)).toEqual(['no_net', 'local_net']);
    expect(out[0].kind).toBe('net_degraded');
  });

  it('carries the kind onto every episode', () => {
    for (const kind of ['fault', 'power_warn', 'net_degraded'] as const) {
      expect(foldEpisodes([s(0, 1)], kind)[0].kind).toBe(kind);
    }
  });

  it('is stable when samples arrive out of order', () => {
    // PostgREST is asked for `order=ts.asc`, but a fold that silently depends on that produces
    // nonsense episodes if the order is ever changed — a caller reading `order=ts.desc` for a
    // "most recent first" list is a plausible next edit.
    const ordered = foldEpisodes([s(0, 1), s(1, 1), s(2, 1)], 'fault');
    const shuffled = foldEpisodes([s(2, 1), s(0, 1), s(1, 1)], 'fault');
    expect(shuffled).toEqual(ordered);
  });

  it('ignores a sample with no usable timestamp rather than guessing at one', () => {
    const out = foldEpisodes(
      [{ device_id: 'co5', ts: 'not a date', value: 1 }, s(0, 1), s(1, 1)],
      'fault',
    );
    expect(out).toHaveLength(1);
    expect(out[0].samples).toBe(2);
  });

  it('the gap is wide enough for the real cadence and narrow enough to mean something', () => {
    // Devices report about once a minute and the staleness backstop is ten. A gap under the
    // report interval would split every episode into single samples; one over an hour would
    // join across an outage.
    expect(EPISODE_GAP_MS).toBeGreaterThanOrEqual(5 * 60_000);
    expect(EPISODE_GAP_MS).toBeLessThanOrEqual(30 * 60_000);
  });
});

describe('describeEpisode', () => {
  const ep = (over: Partial<CapabilityEpisode> = {}): CapabilityEpisode => ({
    device_id: 'co5', kind: 'fault', value: 1,
    from: '2026-09-08T09:00:00Z', to: '2026-09-08T09:04:00Z', samples: 5, ...over,
  });

  it('decodes a fault bitmap into what actually went wrong', () => {
    // Bit 0 is ov_cr. A raw "1" on screen tells an operator nothing; "over-current" tells them
    // where to look. phase28's own column comment spells the order out.
    const { title, body } = describeEpisode(ep({ value: 1 }), 'Outlet 5');
    expect(title).toMatch(/Outlet 5/);
    expect(body).toMatch(/over-current/);
  });

  it('names every bit that is set, not just the first', () => {
    // 1 | 4 = ov_cr + ov_pwr. Reporting one of two faults would send somebody to fix half of it.
    const { body } = describeEpisode(ep({ value: 5 }), 'Outlet 5');
    expect(body).toMatch(/over-current/);
    expect(body).toMatch(/over-power/);
  });

  it('falls back to the raw value rather than inventing a name for an unknown bit', () => {
    const { body } = describeEpisode(ep({ value: 1 << 9 }), 'Outlet 5');
    expect(body).toMatch(/512/);
  });

  it('describes a power warning as the DEVICE’s verdict, not this system’s', () => {
    // The distinction matters: an anomaly row is a z-score this system computed, and this is the
    // meter saying it is over the threshold set on it. Where they disagree the device is the one
    // wired to the circuit.
    const { title, body } = describeEpisode(ep({ kind: 'power_warn', value: 'warn' }), 'C.O Yellow');
    expect(title).toMatch(/C\.O Yellow/);
    expect(`${title} ${body}`).toMatch(/its own|itself|the device/i);
  });

  it('describes a no_net spell as the device reporting no network', () => {
    const { title } = describeEpisode(ep({ kind: 'net_degraded', value: 'no_net' }), 'L.O Red');
    expect(title).toMatch(/L\.O Red/);
    expect(title.toLowerCase()).toMatch(/network/);
  });

  it('says how long it lasted, and when it ended', () => {
    const { body } = describeEpisode(ep({ from: '2026-09-08T09:00:00Z', to: '2026-09-08T09:04:00Z' }), 'Outlet 5');
    expect(body).toMatch(/4 min/);
  });

  it('a single-sample episode reads as a moment, not a zero-minute span', () => {
    // "reported for 0 minutes" is worse than useless — it reads as a bug in the report.
    const { body } = describeEpisode(ep({ from: 't', to: 't', samples: 1, value: 1 }), 'Outlet 5');
    expect(body).not.toMatch(/0 min/);
    expect(body).toMatch(/once|one reading/i);
  });

  it('the fault labels cover exactly the bits the catalogue declares', () => {
    // THE GUARD. A vendor adding a seventh bit, or renaming one, would otherwise render a raw
    // code to an operator. This fails instead — the same reasoning as the phase28 vocabulary
    // checks, and the reason the labels are a translation rather than a second source of truth.
    const declared = Object.values(
      CAPABILITY_PROFILES as unknown as Record<string, { capabilities: ReadonlyArray<{ code: string; bits?: readonly string[] }> }>,
    ).flatMap((p) => p.capabilities.filter((c) => c.code === 'fault').flatMap((c) => c.bits ?? []));
    expect(declared.length).toBeGreaterThan(0);
    for (const bit of declared) expect(FAULT_BIT_LABELS[bit]).toBeTruthy();
    expect(Object.keys(FAULT_BIT_LABELS).sort()).toEqual([...new Set(declared)].sort());
  });
});
