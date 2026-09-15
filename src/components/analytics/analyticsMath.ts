import { SITE } from '@shared/siteConfig.mjs';
import {
  GRID_STEP_MS,
  buildSeries,
  coarsen,
  gapWindows,
  sumSlotSeries,
  summarizeQuality,
  type FrozenRun,
  type GapWindow,
  type LiveSample,
  type Slot,
  type SlotQuality,
  type TelemetryBounds,
} from '@/lib/timeseries';
import { measured } from '@/lib/staleness';
import type { HistoryPoint, Reading } from '@/lib/types';
import { CHART_PARAMS, type ChartParam } from './chartParams';

/**
 * Analytics' charts, built on one time grid — RM-076.
 *
 * This file used to downsample each device on its own and then zip the results BY ARRAY INDEX, on
 * the stated assumption that "every metered device's history is seeded/sampled on the same tick, so
 * same-index points share a timestamp". On the live bridge that assumption does not hold: each
 * sample carries the device's arrival time, and on 2026-09-14 one meter had 1,439 samples against
 * the others' 1,440, so every row of the day paired it with its neighbours' previous minute. Every
 * series now lands on the same slots first (`lib/timeseries.ts`) and devices are joined by slot.
 *
 * WHAT A ROW CARRIES. For each device three numeric keys, so a chart can draw each kind of stretch
 * its own way without a second data pass:
 *
 *   - `<id>` — measured or live, the solid line;
 *   - `<id>:interpolated` — a bridged gap of at most two minutes, drawn dashed;
 *   - `<id>:frozen` — a stretch the meter held identical for three hours or more, drawn muted.
 *
 * The two variant keys also carry the measured value either side of their stretch, so a dashed or
 * muted segment is drawn joined to the solid line it interrupts rather than floating free of it.
 * A parallel `meta` array says, per row and device, what the slot was and what the device itself
 * carried — which is what a tooltip reads.
 */

export type ChartRange = keyof typeof GRID_STEP_MS;

export const RANGE_WINDOW_MS: Record<ChartRange, number> = {
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
  '1y': 365 * 86_400_000,
};

const BOUNDS = SITE.telemetry_bounds as TelemetryBounds;

export type SeriesVariant = 'interpolated' | 'frozen';

export function seriesKey(id: string, variant: SeriesVariant): string {
  return `${id}:${variant}`;
}

/** One line in a chart's tooltip. */
export interface TooltipSeries {
  key: string;
  name: string;
  color: string;
}

/**
 * A device's newest live reading as a chart tail, or nothing once it has expired or the bridge
 * calls the device offline — `staleness.measured` decides, the same rule every live tile follows.
 */
export function liveSampleOf(reading: Reading | undefined, param: ChartParam, nowMs: number): LiveSample | undefined {
  if (!reading) return undefined;
  const field = CHART_PARAMS[param].field as 'power_w' | 'voltage' | 'current';
  const value = measured(reading[field], reading, nowMs);
  return typeof value === 'number' ? { ts: reading.ts, value, online: reading.online, frozen: reading.measurement_frozen === true } : undefined;
}

export type ChartRow = Record<string, number | undefined>;
export type SlotMeta = Pick<Slot, 'quality' | 'raw' | 'readingTs' | 'imputedFrom' | 'samples' | 'of' | 'coverage'>;

export interface ChartOptions {
  range: ChartRange;
  nowMs: number;
  /** Defaults to the whole range. */
  windowMs?: number;
  /** Each device's newest live reading, already checked for freshness. */
  live?: Record<string, LiveSample | undefined>;
}

export interface ChartModel {
  rows: ChartRow[];
  meta: Record<string, SlotMeta>[];
  /** Per device, on the uncoarsened grid, so a short outage is not averaged out of existence. */
  gaps: Record<string, GapWindow[]>;
  frozen: Record<string, FrozenRun[]>;
  quality: Record<string, Record<SlotQuality, number>>;
  /** The width of one drawn row, after coarsening. */
  stepMs: number;
}

interface Grid {
  stepMs: number;
  startMs: number;
  endMs: number;
}

function gridFor(range: ChartRange, nowMs: number, windowMs?: number): Grid {
  const stepMs = GRID_STEP_MS[range];
  // The slot containing `now` is the last one, so a live tail has somewhere to go.
  const endMs = (Math.floor(nowMs / stepMs) + 1) * stepMs;
  return { stepMs, endMs, startMs: endMs - (windowMs ?? RANGE_WINDOW_MS[range]) };
}

function baseSeries(points: HistoryPoint[], param: ChartParam, range: ChartRange, grid: Grid, live?: LiveSample) {
  // Freeze detection only on the bridge's own samples: a stored bucket is an average, and an
  // average repeating is not the same evidence as a raw reading repeating.
  return buildSeries(points, { ...grid, param, bounds: BOUNDS, detectFrozen: range === '24h', live });
}

/** The first slot that carries anything — no chart draws a day of nothing before its data began. */
function firstData(slots: Slot[]): number {
  const i = slots.findIndex((s) => s.quality !== 'missing');
  return i === -1 ? slots.length : i;
}

function factorFor(length: number, maxPoints: number): number {
  return Math.max(1, Math.ceil(length / Math.max(1, maxPoints)));
}

const solid = (s: Slot | undefined) => s?.quality === 'measured' || s?.quality === 'live';

function variantValue(slots: Slot[], i: number, variant: SeriesVariant): number | undefined {
  const s = slots[i];
  if (s.quality === variant) return s.value;
  if (solid(s) && (slots[i - 1]?.quality === variant || slots[i + 1]?.quality === variant)) return s.value;
  return undefined;
}

function metaOf(s: Slot): SlotMeta {
  const meta: SlotMeta = { quality: s.quality };
  if (s.raw !== undefined) meta.raw = s.raw;
  if (s.readingTs !== undefined) meta.readingTs = s.readingTs;
  if (s.imputedFrom !== undefined) meta.imputedFrom = s.imputedFrom;
  if (s.samples !== undefined) meta.samples = s.samples;
  if (s.of !== undefined) meta.of = s.of;
  if (s.coverage !== undefined) meta.coverage = s.coverage;
  return meta;
}

function assemble(ids: string[], slotsById: Record<string, Slot[]>): { rows: ChartRow[]; meta: Record<string, SlotMeta>[] } {
  const reference = ids.map((id) => slotsById[id]).find((s) => s && s.length > 0);
  if (!reference) return { rows: [], meta: [] };
  const rows: ChartRow[] = [];
  const meta: Record<string, SlotMeta>[] = [];
  for (let i = 0; i < reference.length; i++) {
    const row: ChartRow = { t: reference[i].t };
    const metaRow: Record<string, SlotMeta> = {};
    for (const id of ids) {
      const slots = slotsById[id];
      const s = slots?.[i];
      if (!s) continue;
      metaRow[id] = metaOf(s);
      row[id] = solid(s) ? s.value : undefined;
      row[seriesKey(id, 'interpolated')] = variantValue(slots, i, 'interpolated');
      row[seriesKey(id, 'frozen')] = variantValue(slots, i, 'frozen');
    }
    rows.push(row);
    meta.push(metaRow);
  }
  return { rows, meta };
}

/** The multi-device chart: every device on the same slots, trimmed to where the first data begins. */
export function buildChartRows(deviceIds: string[], historyByDevice: Record<string, HistoryPoint[]>, maxPoints: number, param: ChartParam, opts: ChartOptions): ChartModel {
  const grid = gridFor(opts.range, opts.nowMs, opts.windowMs);
  const base: Record<string, Slot[]> = {};
  const frozen: Record<string, FrozenRun[]> = {};
  for (const id of deviceIds) {
    const built = baseSeries(historyByDevice[id] ?? [], param, opts.range, grid, opts.live?.[id]);
    base[id] = built.slots;
    frozen[id] = built.frozen;
  }
  const start = deviceIds.length > 0 ? Math.min(...deviceIds.map((id) => firstData(base[id]))) : 0;

  const gaps: Record<string, GapWindow[]> = {};
  const quality: Record<string, Record<SlotQuality, number>> = {};
  let length = 0;
  for (const id of deviceIds) {
    const trimmed = base[id].slice(start);
    gaps[id] = gapWindows(trimmed, grid.stepMs);
    quality[id] = summarizeQuality(trimmed);
    length = trimmed.length;
  }
  const factor = factorFor(length, maxPoints);
  const display: Record<string, Slot[]> = {};
  for (const id of deviceIds) display[id] = coarsen(base[id].slice(start), factor);

  return { ...assemble(deviceIds, display), gaps, frozen, quality, stepMs: grid.stepMs * factor };
}

export interface SeriesOptions {
  range: ChartRange;
  nowMs: number;
  maxPoints: number;
  windowMs?: number;
  live?: LiveSample;
}

export interface PreparedSeries {
  rows: ChartRow[];
  meta: SlotMeta[];
  gaps: GapWindow[];
  frozen: FrozenRun[];
  quality: Record<SlotQuality, number>;
  stepMs: number;
}

/** Key under which a single prepared series is drawn. */
export const SINGLE = 'v';

function prepare(base: Slot[], frozen: FrozenRun[], grid: Grid, maxPoints: number): PreparedSeries {
  const trimmed = base.slice(firstData(base));
  const factor = factorFor(trimmed.length, maxPoints);
  const { rows, meta } = assemble([SINGLE], { [SINGLE]: coarsen(trimmed, factor) });
  return { rows, meta: meta.map((m) => m[SINGLE]), gaps: gapWindows(trimmed, grid.stepMs), frozen, quality: summarizeQuality(trimmed), stepMs: grid.stepMs * factor };
}

/** One device's series, drawn under the key `SINGLE`. */
export function prepareSeries(points: HistoryPoint[], param: ChartParam, opts: SeriesOptions): PreparedSeries {
  const grid = gridFor(opts.range, opts.nowMs, opts.windowMs);
  const { slots, frozen } = baseSeries(points, param, opts.range, grid, opts.live);
  return prepare(slots, frozen, grid, opts.maxPoints);
}

/** Several devices added minute by minute into one series, drawn under the key `SINGLE`. */
export function prepareSummedSeries(histories: HistoryPoint[][], param: ChartParam, opts: SeriesOptions): PreparedSeries {
  const grid = gridFor(opts.range, opts.nowMs, opts.windowMs);
  const built = histories.map((h) => baseSeries(h, param, opts.range, grid));
  return prepare(sumSlotSeries(built.map((b) => b.slots)), built.flatMap((b) => b.frozen), grid, opts.maxPoints);
}

export interface PairedRow {
  t: number;
  totalKw: number | undefined;
  meteredKw: number | undefined;
  /** A stretch where a contributing meter froze: the held sum, drawn muted, joined to either side. */
  totalFrozenKw: number | undefined;
  meteredFrozenKw: number | undefined;
}

export interface PairedModel {
  rows: PairedRow[];
  meta: { total: SlotMeta; metered: SlotMeta }[];
  quality: { total: Record<SlotQuality, number>; metered: Record<SlotQuality, number> };
  gaps: { total: GapWindow[]; metered: GapWindow[] };
  /** The width of one drawn row, after coarsening — what a tooltip's time span is. */
  stepMs: number;
}

const kw = (s: Slot | undefined) => (s && (s.quality === 'measured' || s.quality === 'live' || s.quality === 'interpolated') && s.value !== undefined ? s.value / 1000 : undefined);

/** The frozen stretch of a summed side, in kW, carrying the solid value either side so it joins up. */
function frozenKw(slots: Slot[], i: number): number | undefined {
  const s = slots[i];
  if (s?.quality === 'frozen' && s.value !== undefined) return s.value / 1000;
  if (kw(s) !== undefined && (slots[i - 1]?.quality === 'frozen' || slots[i + 1]?.quality === 'frozen')) return kw(s);
  return undefined;
}

/**
 * The panel total (the branch meters, summed) against the outlet-metered total, minute by minute.
 * The two sides are suppressed INDEPENDENTLY: an offline outlet must not blank the panel total,
 * which is still perfectly well known.
 */
export function pairTotalAndMetered(branchHistories: HistoryPoint[][], outletHistories: HistoryPoint[][], opts: Omit<SeriesOptions, 'live'>): PairedModel {
  const empty = { rows: [], meta: [], quality: { total: summarizeQuality([]), metered: summarizeQuality([]) }, gaps: { total: [], metered: [] }, stepMs: GRID_STEP_MS[opts.range] };
  if (branchHistories.length === 0 && outletHistories.length === 0) return empty;
  const grid = gridFor(opts.range, opts.nowMs, opts.windowMs);
  const side = (histories: HistoryPoint[][]) =>
    histories.length > 0
      ? sumSlotSeries(histories.map((h) => baseSeries(h, 'power', opts.range, grid).slots))
      : alignMissing(grid);
  const total = side(branchHistories);
  const metered = side(outletHistories);
  const start = Math.min(firstData(total), firstData(metered));
  const totalTrim = total.slice(start);
  const meteredTrim = metered.slice(start);
  if (totalTrim.length === 0) return empty;
  const factor = factorFor(totalTrim.length, opts.maxPoints);
  const totalDisplay = coarsen(totalTrim, factor);
  const meteredDisplay = coarsen(meteredTrim, factor);
  return {
    rows: totalDisplay.map((s, i) => ({
      t: s.t,
      totalKw: kw(s),
      meteredKw: kw(meteredDisplay[i]),
      totalFrozenKw: frozenKw(totalDisplay, i),
      meteredFrozenKw: frozenKw(meteredDisplay, i),
    })),
    meta: totalDisplay.map((s, i) => ({ total: metaOf(s), metered: metaOf(meteredDisplay[i]) })),
    quality: { total: summarizeQuality(totalTrim), metered: summarizeQuality(meteredTrim) },
    gaps: { total: gapWindows(totalTrim, grid.stepMs), metered: gapWindows(meteredTrim, grid.stepMs) },
    stepMs: grid.stepMs * factor,
  };
}

function alignMissing(grid: Grid): Slot[] {
  const startSlot = Math.floor(grid.startMs / grid.stepMs);
  const length = Math.ceil(grid.endMs / grid.stepMs) - startSlot;
  return Array.from({ length }, (_, i) => ({ t: (startSlot + i) * grid.stepMs, quality: 'missing' as SlotQuality }));
}
