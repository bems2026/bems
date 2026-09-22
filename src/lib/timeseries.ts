import { REGISTER_STALL } from '@shared/measurementFreeze.mjs';
import type { HistoryPoint } from './types';

/**
 * RM-076 — putting a device's history onto one time grid, and saying what each minute of it is.
 *
 * WHY THIS EXISTS. Three faults on the Analytics page, measured on 2026-09-14, were all the same
 * missing idea: nothing in the frontend knew WHEN a sample belonged, or WHAT KIND of sample it was.
 *
 *   - The bridge's ring buffer stamps each sample with the device's ARRIVAL time, not the tick that
 *     took it, so consecutive `mtr_lo_red` samples sit 1-29 s apart 298 times a day and 90-129 s
 *     apart 347 times. `buildChartRows` and `sumHistories` then paired devices BY ARRAY INDEX, so
 *     readings up to two minutes apart were drawn and added as one moment, and a device with one
 *     sample fewer (1,439 against 1,440 that morning) was off by a minute for the whole day.
 *   - A one-sample health-flag flicker and a five-minute Node-RED restart both rendered as the same
 *     unexplained blank strip, because the only states a point had were "plotted" and "not".
 *   - L.O Red's meter froze for fourteen hours on 2026-09-12, repeating 19.1 W / 228.2 V / 0.576 A
 *     while reporting `online: true`. Every chart drew that as a measurement.
 *
 * THE RULES, each decided rather than defaulted (ROADMAP RM-076, operator decision 2026-09-14):
 *
 *   - One sample per bridge tick gets one slot. Binning by floor(ts / step) invents 466 holes a day
 *     for `mtr_lo_red`, because a late arrival stamp lands in the previous minute; pushing a
 *     collision forward by at most two slots invents none, measured on every meter's full day.
 *   - A gap of at most two minutes between two real readings is bridged by a straight line and
 *     marked `interpolated`. Anything longer stays a gap and is reported as a window, so the chart
 *     can say "offline" rather than draw nothing. The limit is TIME, not slots: nothing is ever
 *     bridged on a 15-minute grid.
 *   - Power is never held forward. A held value is precisely how the frozen meter fabricated
 *     0.27 kWh, so a frozen stretch is `frozen`, drawn as such, and left out of every sum.
 *   - A reading outside the site's physical bounds is an `outlier`: excluded, never clamped.
 *   - Energy is never derived here. kWh come from the meters' own registers, at the bridge.
 */

export type SlotQuality = 'measured' | 'interpolated' | 'live' | 'frozen' | 'offline' | 'outlier' | 'missing';
export type SeriesParam = 'power' | 'voltage' | 'current';

const FIELD: Record<SeriesParam, 'power_w' | 'voltage' | 'current'> = { power: 'power_w', voltage: 'voltage', current: 'current' };

export interface Bound {
  min: number;
  max: number;
}
export type TelemetryBounds = Partial<Record<'power_w' | 'voltage' | 'current', Bound>>;

export interface Slot {
  /** Start of the slot, epoch ms. */
  t: number;
  /** What a chart may plot. Present for measured, interpolated, live and frozen slots only. */
  value?: number;
  /** What the device itself carried, when it carried anything — shown in a tooltip, never plotted. */
  raw?: number;
  /** The reading's own timestamp, which is not the slot's. */
  readingTs?: string;
  quality: SlotQuality;
  /** For an interpolated slot, what it was before it was bridged. */
  imputedFrom?: SlotQuality;
  /** For a coarsened slot: how many of its slots contributed a value, out of how many. */
  samples?: number;
  of?: number;
  /** For a stored bucket: how many of its raw samples were online, out of how many. */
  coverage?: { online: number; samples: number };
}

export interface FrozenRun {
  fromMs: number;
  /** The last identical sample, not the moment the values next changed. */
  toMs: number;
  samples: number;
  power_w: number;
  voltage?: number;
  current?: number;
}

export interface GapWindow {
  fromMs: number;
  toMs: number;
  kind: 'offline' | 'outlier' | 'missing';
  slots: number;
}

/**
 * Slot width per range. The stored ranges MATCH `supabaseHistory.ts`'s bucket widths exactly, and
 * `readings_buckets` floors on the epoch, so a slot and a stored bucket are the same interval —
 * `supabaseHistory.test.ts` pins the agreement.
 */
export const GRID_STEP_MS = { '24h': 60_000, '7d': 900_000, '30d': 3_600_000, '1y': 86_400_000 } as const;

/** The longest gap bridged by a straight line. Two bridge samples. */
export const MAX_IMPUTE_MS = 120_000;

/**
 * HOW LONG A READING MUST HOLD STILL BEFORE IT IS CALLED FROZEN, measured rather than chosen — and
 * measured twice, because the first measurement looked at the wrong devices.
 *
 * It shipped at one hour, sized on the four meters alone: over the seven days to 2026-09-14 the
 * longest byte-identical power/voltage/current run above zero on a healthy METER was 33 minutes.
 * Run over the live buffers after that deploy, it flagged two OUTLETS as frozen, and both were
 * metering: the outlets refresh power, voltage and current about once an hour, and co1's own
 * `add_ele` advanced twice inside its flagged hour. Across all eleven metered devices over the same
 * seven days, healthy identical runs reached 61 minutes (co1 did 60 or more nineteen times) and
 * never 120. The faults were 540, 657 and 942 minutes (`mtr_lo_red`).
 *
 * Three hours sits about 3x above the longest healthy run and under a third of the shortest fault,
 * and it needs no idea of device class — which matters for the next building. A two-hour freeze will
 * go unnamed; an outlet that misses one hourly refresh will not be called frozen. Zero watts is
 * excluded outright: an idle channel legitimately reports on change only, and `mtr_lo_yellow` sat at
 * 0 W for 690 healthy minutes.
 */
export const FROZEN_MIN_SAMPLES = 180;
export const FROZEN_MIN_DURATION_MS = 175 * 60_000;

/** A gap this many slots long or longer is reported as a window, not bridged. */
export const GAP_WINDOW_MIN_SLOTS = 3;

/** How far a late arrival stamp may be pushed forward to find its own tick's slot. */
const MAX_PUSH_SLOTS = 2;

const GAP_QUALITIES: ReadonlySet<SlotQuality> = new Set(['offline', 'missing', 'outlier']);
const VALUE_QUALITIES: ReadonlySet<SlotQuality> = new Set(['measured', 'interpolated', 'live']);
/** Worst first, for naming why a combined slot has no value. */
const SEVERITY: SlotQuality[] = ['frozen', 'offline', 'outlier', 'missing'];

const isGap = (s: Slot) => GAP_QUALITIES.has(s.quality);
const hasValue = (s: Slot) => VALUE_QUALITIES.has(s.quality) && s.value !== undefined;
const worst = (qualities: SlotQuality[]): SlotQuality => SEVERITY.find((q) => qualities.includes(q)) ?? 'missing';

/**
 * Parseable points, oldest first; of two at the same instant the later one in the input wins.
 *
 * A point is placed by the bridge TICK that took it (`sample_ts`, RM-079) when it carries one, and by
 * the device's own `ts` otherwise. The tick is exact; `ts` is when the device last reported, which a
 * device that went quiet repeats on every sample.
 */
function ordered(points: HistoryPoint[]): { ms: number; point: HistoryPoint }[] {
  const withMs: { ms: number; point: HistoryPoint }[] = [];
  for (const point of points) {
    const tick = point.sample_ts !== undefined ? Date.parse(point.sample_ts) : Number.NaN;
    const ms = Number.isFinite(tick) ? tick : Date.parse(point.ts);
    if (Number.isFinite(ms)) withMs.push({ ms, point });
  }
  withMs.sort((a, b) => a.ms - b.ms);
  const out: { ms: number; point: HistoryPoint }[] = [];
  for (const entry of withMs) {
    if (out.length > 0 && out[out.length - 1].ms === entry.ms) out[out.length - 1] = entry;
    else out.push(entry);
  }
  return out;
}

export interface FrozenRunOptions {
  /**
   * This channel's voltage is one measurement shared with another clamp — the dual-channel meter
   * (`voltageIsShared`). Its run is then keyed on its OWN measurements, power and current: RM-133
   * found channel 2's voltage dp following channel 1's through a hold, and a shared voltage moving is
   * no evidence that this clamp is measuring. A single-channel device keeps the voltage in the key —
   * there it is the device's own reading, and over seven days to 2026-09-22 dropping it would have
   * doubled the outlets' longest healthy run (60 → 119 min) against the three-hour threshold.
   */
  sharedVoltage?: boolean;
}

/**
 * Runs of byte-identical readings with power above zero, long enough that no healthy meter here has
 * ever produced one — or containing a sample the bridge itself flagged frozen.
 *
 * RM-134 (2026-09-22) found three things splitting a real hold, none of them the meter measuring:
 *   - OFFLINE SAMPLES are skipped, not treated as a break. The reconnect blips at 07:45, 07:59 and
 *     08:13 each cut L.O Yellow's six-hour hold, and a value that survives a reconnect identical is
 *     precisely a value nobody re-read. They are still never part of a run on their own: an offline
 *     stretch is already a different, louder fact.
 *   - THE SHARED VOLTAGE, per `sharedVoltage` above.
 *   - THE BRIDGE'S OWN FLAG (`frozen: true`, RM-079/RM-133) switching on mid-run. A run holding a
 *     flagged sample is frozen below the length thresholds: the bridge's register rule decides from facts
 *     the ring does not carry. But not below the bridge's own shortest rule (`REGISTER_STALL.afterMs`,
 *     half an hour of a still register): a true flag cannot sit on a shorter run of identical readings,
 *     and on 2026-09-22 15:38 a clock that ran while the circuit drew nothing flagged a two-minute
 *     lights-on (RM-136).
 */
export function detectFrozenRuns(points: HistoryPoint[], opts: FrozenRunOptions = {}): FrozenRun[] {
  const shared = opts.sharedVoltage === true;
  const list = ordered(points).filter((e) => e.point.online !== false);
  const key = (p: HistoryPoint) =>
    typeof p.power_w === 'number' && Number.isFinite(p.power_w) && p.power_w > 0 && (shared || typeof p.voltage === 'number')
      ? shared ? `${p.power_w}|${p.current}` : `${p.power_w}|${p.voltage}|${p.current}`
      : null;
  const runs: FrozenRun[] = [];
  let start = 0;
  let flagged = list.length > 0 && list[0].point.frozen === true;
  for (let i = 1; i <= list.length; i++) {
    const startKey = key(list[start].point);
    if (i < list.length && startKey !== null && key(list[i].point) === startKey) {
      if (list[i].point.frozen === true) flagged = true;
      continue;
    }
    const samples = i - start;
    const fromMs = list[start].ms;
    const toMs = list[i - 1].ms;
    const flaggedLongEnough = flagged && toMs - fromMs >= REGISTER_STALL.afterMs;
    if (startKey !== null && (flaggedLongEnough || (samples >= FROZEN_MIN_SAMPLES && toMs - fromMs >= FROZEN_MIN_DURATION_MS))) {
      const p = list[start].point;
      runs.push({ fromMs, toMs, samples, power_w: p.power_w, ...(shared ? {} : { voltage: p.voltage }), current: p.current });
    }
    start = i;
    flagged = i < list.length && list[i].point.frozen === true;
  }
  return runs;
}

export interface AlignOptions {
  stepMs: number;
  startMs: number;
  endMs: number;
  param: SeriesParam;
  bounds?: TelemetryBounds;
  frozenRuns?: FrozenRun[];
}

function classify(point: HistoryPoint, ms: number, param: SeriesParam, bounds: TelemetryBounds | undefined, frozenRuns: FrozenRun[]): Omit<Slot, 't'> {
  const field = FIELD[param];
  const v: unknown = point[field];
  const readingTs = point.ts;
  const raw = typeof v === 'number' ? v : undefined;
  if (point.online === false) return { quality: 'offline', raw, readingTs };
  if (v === undefined || v === null) return { quality: 'missing', readingTs };
  if (typeof v !== 'number' || !Number.isFinite(v)) return { quality: 'outlier', raw, readingTs };
  const bound = bounds?.[field];
  if (bound && (v < bound.min || v > bound.max)) return { quality: 'outlier', raw: v, readingTs };
  // Frozen either because the bridge flagged this sample (RM-079) or because its run is long enough to
  // find here — the bridge flags only from the three-hour mark on, and this marks the whole run.
  if (point.frozen === true || frozenRuns.some((r) => ms >= r.fromMs && ms <= r.toMs)) return { quality: 'frozen', value: v, raw: v, readingTs };
  return { quality: 'measured', value: v, raw: v, readingTs };
}

/** One slot per `stepMs` across [startMs, endMs). An empty slot is `missing`, never zero. */
export function alignToGrid(points: HistoryPoint[], opts: AlignOptions): Slot[] {
  const { stepMs, startMs, endMs, param, bounds, frozenRuns = [] } = opts;
  const startSlot = Math.floor(startMs / stepMs);
  const length = Math.max(0, Math.ceil(endMs / stepMs) - startSlot);
  const slots: Slot[] = Array.from({ length }, (_, i) => ({ t: (startSlot + i) * stepMs, quality: 'missing' as SlotQuality }));
  if (length === 0) return slots;

  let prev = -Infinity;
  for (const { ms, point } of ordered(points)) {
    let slot = Math.floor(ms / stepMs);
    if (slot <= prev && prev + 1 - slot <= MAX_PUSH_SLOTS) slot = prev + 1;
    if (slot <= prev) slot = prev;
    prev = slot;
    const index = slot - startSlot;
    if (index < 0) continue;
    const i = Math.min(index, length - 1);
    const classified: Slot = { t: slots[i].t, ...classify(point, ms, param, bounds, frozenRuns) };
    if (point.coverage) classified.coverage = point.coverage;
    slots[i] = classified;
  }
  return slots;
}

/** Bridges gaps of at most `maxImputeMs` that have a measured reading on both sides. */
export function imputeShortGaps(slots: Slot[], stepMs: number, maxImputeMs: number = MAX_IMPUTE_MS): Slot[] {
  const out = slots.map((s) => ({ ...s }));
  const maxSlots = Math.floor(maxImputeMs / stepMs);
  if (maxSlots < 1) return out;
  let i = 0;
  while (i < out.length) {
    if (!isGap(out[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && isGap(out[j])) j++;
    const left = out[i - 1];
    const right = out[j];
    // A live tail may close a bridge on the right, so a chart's line reaches the live reading
    // rather than stopping a minute short of it and leaving the newest value drawn as nothing.
    const bracketed = left?.quality === 'measured' && (right?.quality === 'measured' || right?.quality === 'live');
    if (j - i <= maxSlots && bracketed && left.value !== undefined && right.value !== undefined) {
      for (let k = i; k < j; k++) {
        // Multiply before dividing, so a whole-number step between whole-number readings stays exact.
        const value = left.value + ((right.value - left.value) * (out[k].t - left.t)) / (right.t - left.t);
        out[k] = { ...out[k], value, quality: 'interpolated', imputedFrom: out[k].quality };
      }
    }
    i = j;
  }
  return out;
}

/** Runs of unbridged gap, long enough to be named on the chart. */
export function gapWindows(slots: Slot[], stepMs: number, minSlots: number = GAP_WINDOW_MIN_SLOTS): GapWindow[] {
  const windows: GapWindow[] = [];
  let i = 0;
  while (i < slots.length) {
    if (!isGap(slots[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < slots.length && isGap(slots[j])) j++;
    if (j - i >= minSlots) {
      const run = slots.slice(i, j).map((s) => s.quality);
      const kind = run.includes('offline') ? 'offline' : run.includes('outlier') ? 'outlier' : 'missing';
      windows.push({ fromMs: slots[i].t, toMs: slots[j - 1].t + stepMs, kind, slots: j - i });
    }
    i = j;
  }
  return windows;
}

/**
 * Merges every `factor` slots into one, for drawing a long series into a small card. Averages only
 * what was measured, bridged or live, and keeps the count, so a tooltip can say "22 of 24".
 */
export function coarsen(slots: Slot[], factor: number): Slot[] {
  if (factor <= 1) return slots.map((s) => ({ ...s }));
  const out: Slot[] = [];
  for (let b = 0; b < slots.length; b += factor) {
    const bucket = slots.slice(b, b + factor);
    const t = bucket[0].t;
    const valued = bucket.filter(hasValue);
    if (valued.length === 0) {
      const frozen = bucket.filter((s) => s.quality === 'frozen' && s.value !== undefined);
      if (frozen.length > 0) {
        out.push({ t, quality: 'frozen', value: mean(frozen), samples: frozen.length, of: bucket.length });
      } else {
        out.push({ t, quality: worst(bucket.map((s) => s.quality)), samples: 0, of: bucket.length });
      }
      continue;
    }
    const interpolated = valued.filter((s) => s.quality === 'interpolated').length;
    const live = valued.some((s) => s.quality === 'live');
    const measured = valued.length - interpolated - (live ? 1 : 0);
    const quality: SlotQuality = live ? 'live' : interpolated > measured ? 'interpolated' : 'measured';
    const single = valued.length === 1 ? valued[0] : undefined;
    out.push({
      t,
      quality,
      value: mean(valued),
      ...(single ? { raw: single.raw, readingTs: single.readingTs } : { readingTs: valued[valued.length - 1].readingTs }),
      samples: valued.length,
      of: bucket.length,
    });
  }
  return out;
}

function mean(slots: Slot[]): number {
  let sum = 0;
  for (const s of slots) sum += s.value as number;
  return sum / slots.length;
}

/**
 * Adds slot-aligned series minute by minute.
 *
 * A slot where any contributor has NO value — offline, missing, rejected — is a gap in the sum,
 * named by the most serious of those reasons: adding a missing value would state a total nobody
 * measured.
 *
 * A slot where a contributor is FROZEN is different, and this is a correction found in the browser
 * on 2026-09-14. A frozen reading does have a value, it just is not a measurement. Treating it as a
 * gap drew Overview's Energy Flow with a ninety-minute blank and no band — exactly the unexplained
 * blank this module exists to remove. So the sum carries the held figure and is marked `frozen`,
 * which every chart draws muted and dotted, the same way it draws one frozen device.
 */
export function sumSlotSeries(seriesList: Slot[][]): Slot[] {
  if (seriesList.length === 0) return [];
  const length = Math.min(...seriesList.map((s) => s.length));
  const out: Slot[] = [];
  for (let i = 0; i < length; i++) {
    const parts = seriesList.map((s) => s[i]);
    const heldFrozen = (p: Slot) => p.quality === 'frozen' && p.value !== undefined;
    const gaps = parts.filter((p) => !hasValue(p) && !heldFrozen(p));
    if (gaps.length > 0) {
      out.push({ t: parts[0].t, quality: worst(gaps.map((p) => p.quality)) });
      continue;
    }
    let value = 0;
    for (const p of parts) value += p.value as number;
    const quality: SlotQuality = parts.some(heldFrozen)
      ? 'frozen'
      : parts.some((p) => p.quality === 'interpolated')
        ? 'interpolated'
        : parts.some((p) => p.quality === 'live')
          ? 'live'
          : 'measured';
    out.push({ t: parts[0].t, value, quality });
  }
  return out;
}

export interface LiveSample {
  ts: string;
  value: number | undefined;
  online?: boolean;
  /** The bridge flagged the reading `measurement_frozen` (RM-079). */
  frozen?: boolean;
}

/**
 * Places the newest live reading in its own slot, so a chart ends where the live tiles are rather
 * than up to a minute behind them. Never replaces a stored sample at least as new, and never adds a
 * reading the bridge calls offline. Freshness is the caller's call (`staleness.measured`).
 */
export function appendLiveTail(slots: Slot[], live: LiveSample, stepMs: number): Slot[] {
  const out = slots.map((s) => ({ ...s }));
  if (out.length === 0 || live.online === false || typeof live.value !== 'number' || !Number.isFinite(live.value)) return out;
  const ms = Date.parse(live.ts);
  if (!Number.isFinite(ms)) return out;
  const index = Math.floor(ms / stepMs) - Math.floor(out[0].t / stepMs);
  if (index < 0) return out;
  const i = Math.min(index, out.length - 1);
  for (let k = i; k < out.length; k++) {
    const rts = out[k].readingTs;
    if (rts !== undefined && Date.parse(rts) >= ms) return out;
  }
  out[i] = { t: out[i].t, value: live.value, raw: live.value, readingTs: live.ts, quality: live.frozen ? 'frozen' : 'live' };
  return out;
}

export function summarizeQuality(slots: Slot[]): Record<SlotQuality, number> {
  const counts: Record<SlotQuality, number> = { measured: 0, interpolated: 0, live: 0, frozen: 0, offline: 0, outlier: 0, missing: 0 };
  for (const s of slots) counts[s.quality]++;
  return counts;
}

export interface BuildSeriesOptions extends Omit<AlignOptions, 'frozenRuns'> {
  /** Only meaningful on the bridge's own samples. A stored bucket is an average, and an average
   * repeating exactly is not the same evidence as a raw reading doing so. */
  detectFrozen?: boolean;
  /** The device's voltage is shared with another clamp — see `FrozenRunOptions`. */
  sharedVoltage?: boolean;
  maxImputeMs?: number;
  /** The newest live reading, already checked for freshness by the caller. */
  live?: LiveSample;
}

/** The whole pipeline: find freezes, align, add the live tail, then bridge what is short enough. */
export function buildSeries(points: HistoryPoint[], opts: BuildSeriesOptions): { slots: Slot[]; frozen: FrozenRun[] } {
  const { detectFrozen = false, sharedVoltage = false, maxImputeMs = MAX_IMPUTE_MS, live, ...align } = opts;
  const frozen = detectFrozen ? detectFrozenRuns(points, { sharedVoltage }) : [];
  let aligned = alignToGrid(points, { ...align, frozenRuns: frozen });
  if (live) aligned = appendLiveTail(aligned, live, align.stepMs);
  const slots = imputeShortGaps(aligned, align.stepMs, maxImputeMs);
  return { slots, frozen };
}
