/**
 * The plan for correcting the shared dual-channel meter's stored rows after the device traded
 * its channels (RM-123) — pure, so the dry run and the apply compute the same thing and
 * `scrubMeterSwap.test.mjs` can hold it to a fixture.
 *
 * WHAT IS CORRECTED, AND HOW IT IS DECIDED. The same classifier the live demux runs
 * (`shared/channelDemux.mjs`) is replayed over the two devices' rows in time order, with the same
 * two-sample debounce, from the same two physical facts. Every minute it calls `swapped` is a
 * minute whose two rows carry each other's clamp: the measurements (volts, amps, watts), the
 * per-channel register columns (`total_energy_kwh`, `warn_power_w`, `power_type`) and the decoded
 * capability codes are traded back, codes renamed to the channel each logical device declares.
 * `online` is the row's own fact and is carried through unchanged; `net_state` and `fault` are
 * device-wide and are left alone.
 *
 * WHY ENERGY IS RE-INTEGRATED RATHER THAN TRADED. The reports credit each hour's RISE of
 * `energy_kwh_today` (phase42), and on a day with a swap the stored counter is a running total that
 * mixes correct minutes with traded ones — trading the column between the rows would trade the
 * mixture, not fix it. The device's own registers are no help: they froze on the idle side and
 * jumped by thousands of kWh at each flip (see `shared/channelDemux.mjs`). So on every local day
 * that contains a swapped minute, BOTH devices' `energy_kwh_today` is restated as the running
 * integral of the corrected online power from local midnight — the "second opinion this system
 * already had" (EX-158) — and every such row says so in `capabilities.scrub`. Days with no swapped
 * minute are not touched at all.
 *
 * Integration is left-Riemann on the previous online power, bridged across an offline row at the
 * next online one, and cut at `MAX_INTEGRATION_GAP_MS` (the parsers' own rule): a gap nobody
 * watched is not energy.
 *
 * THE DEBOUNCE COSTS ONE MINUTE PER FLIP. The first contradicting sample on each side stays under
 * the previous assignment, exactly as the live node leaves it — so a boundary minute carries the
 * other clamp's value, at most the outlet load for sixty seconds. `scrubMeterSwap.test.mjs` states
 * that arithmetic rather than hiding it.
 */
import { nextChannelState, swapChannelCodes } from '../shared/channelDemux.mjs';
import { MAX_INTEGRATION_GAP_MS } from '../node-red-bridge/dpParserPlan.mjs';

/**
 * The columns every update carries, as a bulk upsert requires the same keys on every row. `online`
 * is NOT rewritten — it is the row's own value, carried because PostgREST's upsert evaluates the
 * INSERT tuple's NOT NULL constraints before the conflict path reaches the existing row: without it
 * the first batch failed with 23502 and nothing was written (2026-09-22).
 */
export const SCRUB_COLUMNS = Object.freeze([
  'device_id', 'ts', 'voltage', 'current', 'power_w', 'energy_kwh_today', 'online',
  'total_energy_kwh', 'warn_power_w', 'power_type', 'capabilities',
]);

/** `YYYY-MM-DD` of an instant in the site's own day. */
export function localDayOf(ts, offsetMinutes) {
  return new Date(Date.parse(ts) + offsetMinutes * 60000).toISOString().slice(0, 10);
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (v === null || v === undefined ? null : Number(v)));

/** The classifier's view of one stored row. */
function channelOf(r, n) {
  if (!r || !r.online) return null;
  const caps = r.capabilities && typeof r.capabilities === 'object' ? r.capabilities : {};
  return { p: num(r.power_w), c: num(r.current), state: caps[`device_state${n}`] ?? null };
}

/**
 * One device's rows of one local day, in time order -> the same rows with `energy_kwh_today`
 * restated as the running integral of their online power.
 */
export function reintegrateDay(rows, { maxGapMs = MAX_INTEGRATION_GAP_MS } = {}) {
  let kwh = 0;
  let lastOnline = null; // { t, p } — the last row that measured anything
  return rows.map((r) => {
    const t = Date.parse(r.ts);
    const p = num(r.power_w);
    // Only an online row advances the total, and only over the gap back to the last online one.
    // An offline row restates the running total and adds nothing: its values are ingest's copy
    // of the last reading, not a measurement. A gap longer than the parsers' own limit is not
    // integrated — nobody was watching.
    if (r.online && p !== null) {
      if (lastOnline && t - lastOnline.t <= maxGapMs) kwh += (lastOnline.p * (t - lastOnline.t)) / 3600000 / 1000;
      lastOnline = { t, p };
    }
    return { ...r, energy_kwh_today: Math.round(kwh * 1e6) / 1e6 };
  });
}

/**
 * @param {{ co: object[], lo: object[], profile: object, rules: {ceiling_w:number},
 *           offsetMinutes: number, at: string }} args — `co` is channel 1's rows, `lo` channel 2's.
 */
export function planScrub({ co, lo, profile, rules, offsetMinutes, at }) {
  const loByTs = new Map(lo.map((r) => [r.ts, r]));
  const pairs = co
    .filter((r) => loByTs.has(r.ts))
    .map((r) => ({ ts: r.ts, co: r, lo: loByTs.get(r.ts) }))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

  // Replay the classifier. `swappedAt` is the verdict per minute; windows are its runs.
  let state = null;
  const swappedAt = new Map();
  const windows = [];
  let open = null;
  for (const pr of pairs) {
    state = nextChannelState(state, { ts: Date.parse(pr.ts), ch1: channelOf(pr.co, 1), ch2: channelOf(pr.lo, 2) }, rules);
    const swapped = state.assignment === 'swapped';
    if (swapped) swappedAt.set(pr.ts, state.rule);
    if (swapped && !open) open = { from: pr.ts, to: pr.ts, rule: state.rule, samples: 0 };
    if (swapped) { open.to = pr.ts; open.samples += 1; }
    if (!swapped && open) { open.to = pr.ts; windows.push(open); open = null; }
  }
  if (open) { open.to = null; windows.push(open); }

  const affectedDays = [...new Set([...swappedAt.keys()].map((t) => localDayOf(t, offsetMinutes)))].sort();
  if (!affectedDays.length) return { windows, affectedDays, updates: [], pairs: pairs.length };

  const affected = new Set(affectedDays);
  const updates = [];
  const coByTs = new Map(co.map((r) => [r.ts, r]));
  for (const [own, other] of [[co, loByTs], [lo, coByTs]]) {
    const byDay = new Map();
    for (const r of own) {
      const d = localDayOf(r.ts, offsetMinutes);
      if (!affected.has(d)) continue;
      (byDay.get(d) || byDay.set(d, []).get(d)).push(r);
    }
    for (const rows of byDay.values()) {
      rows.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
      // First trade the measurements back where the minute was swapped, then integrate the result.
      const corrected = rows.map((r) => {
        const rule = swappedAt.get(r.ts);
        const twin = other.get(r.ts);
        if (!rule || !twin) return { ...r, _scrub: { energy: 'reintegrated', at } };
        const twinCaps = twin.capabilities && typeof twin.capabilities === 'object' ? twin.capabilities : {};
        return {
          ...r,
          voltage: twin.voltage ?? null,
          current: twin.current ?? null,
          power_w: twin.power_w ?? null,
          total_energy_kwh: twin.total_energy_kwh ?? null,
          warn_power_w: twin.warn_power_w ?? null,
          power_type: twin.power_type ?? null,
          capabilities: swapChannelCodes(twinCaps, profile),
          _scrub: { swapped: true, rule, energy: 'reintegrated', at },
        };
      });
      for (const r of reintegrateDay(corrected)) {
        const caps = r.capabilities && typeof r.capabilities === 'object' ? { ...r.capabilities } : {};
        caps.scrub = r._scrub;
        const u = {};
        for (const col of SCRUB_COLUMNS) u[col] = col === 'capabilities' ? caps : (r[col] ?? null);
        updates.push(u);
      }
    }
  }

  return { windows, affectedDays, updates, pairs: pairs.length };
}
