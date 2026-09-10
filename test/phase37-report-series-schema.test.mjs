/**
 * Guards supabase/phase37_report_series.sql — the series behind the reports' charts.
 *
 * File-text tests, not live-database ones: no migration runner, no test Supabase project, same
 * reasoning as phase9-history-schema.test.mjs. `supabase/rehearse.sh` is what proves the SQL
 * runs; this is what proves it still MEANS what it was written to mean.
 *
 * Most of these are honesty assertions rather than shape ones, because every way this file can
 * be wrong is quiet. A missing `generate_series` loses an outage from a document. A `security
 * definer` slipped in during a later edit hands every reading to anyone who can call the
 * function. A `coalesce(…, 0)` on a statistic turns "nobody was watching" into "the building
 * drew nothing". None of the three produces an error, and all three produce a plausible chart.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(ROOT, 'supabase', 'phase37_report_series.sql'), 'utf8');

/** Negative assertions run against statements only — a comment saying "never security definer"
 *  must not be what satisfies a test looking for the absence of `security definer`. */
const sql = raw.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const FUNCTIONS = [
  'report_window',
  'report_resolution',
  'report_daily_series',
  'report_hour_profile',
  'report_hour_matrix',
  'report_demand_curve',
  'report_demand_summary',
];

// --- security ---------------------------------------------------------------------------------

test('every function is security INVOKER, so RLS still applies to the caller', () => {
  // A definer function runs as its owner. These read `readings` and `building_totals`, so one
  // of them made definer would serve every row in the building to anyone who can execute it —
  // undoing phase5_lockdown_rls.sql without touching a policy.
  assert.equal(/security\s+definer/i.test(sql), false, 'phase37 must contain no security definer function');
  const invokers = sql.match(/security\s+invoker/gi) ?? [];
  assert.equal(invokers.length, FUNCTIONS.length);
});

test('every function is declared read-only to the planner', () => {
  // `stable` is the honest declaration and it is also what lets PostgREST accept these on a GET.
  // A `volatile` reader would be a lie the planner believes.
  assert.equal(/^\s*volatile\s*$/im.test(sql), false);
  assert.equal((sql.match(/\bstable\b/gi) ?? []).length, FUNCTIONS.length);
});

test('execute is revoked from public AND from anon by name, then granted to authenticated', () => {
  for (const fn of FUNCTIONS) {
    const revoke = new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\)\\s+from public,\\s*anon`, 'i');
    // Naming `anon` explicitly is not belt-and-braces. Revoking from PUBLIC does not remove a
    // privilege Supabase granted `anon` directly — phase5 learned that once already.
    assert.match(sql, revoke, `${fn} must revoke from public AND anon`);
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s+to authenticated`, 'i'));
  }
});

test('nothing is granted to anon', () => {
  assert.equal(/grant[^;]*\bto\b[^;]*\banon\b/i.test(sql), false);
});

// --- the honesty rules ------------------------------------------------------------------------

test('every bucketed series is built from generate_series, so a gap cannot go missing', () => {
  // This is the assertion that matters most in the file. An aggregate GROUP BY produces rows
  // only for days that have data, so an outage becomes an absent row rather than a marked gap —
  // and an absent row is invisible in a chart. server/baselineReport.mjs found exactly this in
  // its first real output: "2026-08-18 sat between the 17th and the 19th and simply was not
  // there". Here the calendar is generated and the data is joined onto it.
  for (const fn of ['report_daily_series', 'report_hour_profile', 'report_hour_matrix']) {
    const body = bodyOf(fn);
    assert.match(body, /generate_series/i, `${fn} must generate its buckets, not group into them`);
    assert.match(body, /left join/i, `${fn} must LEFT JOIN observations onto its buckets`);
  }
});

test('the hour profile returns all 24 hours whether or not they were observed', () => {
  assert.match(bodyOf('report_hour_profile'), /generate_series\(0,\s*23\)/i);
});

test('an unobserved bucket yields NULL statistics, never zero', () => {
  // A COUNT may be coalesced to 0 — nobody observed it zero times, and that is true. A
  // MEASUREMENT may not: the building did not draw nothing at 03:00, nobody was watching at
  // 03:00, and collapsing those two is the error this whole system is built to refuse.
  //
  // Stated as the rule rather than as a list of allowed names, so renaming a column cannot
  // quietly move it out of the guard's scope — which is what a whitelist did on the first pass.
  // `minutes` is a duration and may legitimately be zero — an hour nobody saw contributed zero
  // observed minutes, which is a count of time and not a claim about demand.
  const MEASUREMENTS = /_w\b|_kwh\b|power|energy|voltage|current|p50|p95|p99|\bavg|\bmax|\bmin(?!utes)|gap/i;
  for (const m of sql.match(/coalesce\s*\([^)]*\)/gi) ?? []) {
    assert.equal(
      MEASUREMENTS.test(m),
      false,
      `coalesce may zero a count but never a measurement; found: ${m}`
    );
  }
});

test('longest_gap_minutes is NULL rather than 0 when nothing at all was observed', () => {
  // At that point the gap is the whole window, and calling it zero would be the most
  // reassuring possible way to report an outage nobody can see any more.
  const body = bodyOf('report_demand_summary');
  assert.match(body, /count\(\*\)\s*from obs\)\s*=\s*0\s+then null/i);
});

test('the longest gap is bounded by the window, not by the first observation in it', () => {
  // Without the two boundary sentinels, a period that BEGINS dark reports no gap for that
  // darkness — the first observation has no predecessor, so the stretch before it is never
  // differenced. Read back against the live project, August 2026 reported a NINE MINUTE longest
  // gap while sitting dark for its first sixteen days. No fixture produced that; only real data
  // that starts mid-month did.
  const body = bodyOf('report_demand_summary');
  assert.match(body, /bounded as \(/i, 'the gap series must carry the window edges');
  assert.match(body, /select w\.win_start as start_at, w\.win_start as end_at/i);
  assert.match(body, /least\(w\.win_end, now\(\)\)/i, 'hours that have not happened are not a gap');
  assert.match(body, /from bounded/i, 'gaps must be taken over the bounded series');
});

test('resolution says what the data is MADE OF, not how much of it there is', () => {
  // The first version compared raw hours against the window's ELAPSED hours, so a month that was
  // entirely raw minute samples but half dark reported 'mixed' — a resolution downgrade
  // describing a coverage gap. Coverage already answers "how much", beside every figure.
  const body = bodyOf('report_resolution');
  assert.match(body, /raw_hours = 0 and rolled_hours = 0 then null/i, 'no data means no resolution to claim');
  assert.match(body, /rolled_hours = 0 then 'minute'/i);
  assert.match(body, /raw_hours = 0\s+then 'hour'/i);
  // The elapsed-time comparison that caused it must not come back.
  assert.equal(/p_win_end - p_win_start/.test(body), false, 'resolution must not measure the window length');
});

test('the resolution is computed once per call, not once per row', () => {
  // Inline in a select list it runs per OUTPUT ROW — 744 of them for a month's matrix, each a
  // scan of building_totals counting distinct hours. That is a statement timeout against the
  // live project on the month while the week returns in milliseconds, and it looks like a
  // row-count problem rather than a repetition one.
  for (const fn of ['report_daily_series', 'report_hour_profile', 'report_hour_matrix', 'report_demand_curve', 'report_demand_summary']) {
    const body = bodyOf(fn);
    assert.match(body, /res\s+text;/i, `${fn} must hold the resolution in a local`);
    assert.match(body, /res\s*:=\s*public\.report_resolution\(/i, `${fn} must compute it once`);
    assert.equal(
      (body.match(/public\.report_resolution\(/g) ?? []).length,
      1,
      `${fn} calls report_resolution more than once; it belongs in the declare block`
    );
  }
});

test('an observation is an interval, not an instant', () => {
  // Both of the bugs `supabase/rehearse.sh` caught here were the same mistake, and both erred
  // in the reassuring direction:
  //
  //   - an hourly bucket counted as ONE observed minute, so a fully observed month that had
  //     been rolled up reported 1.7% coverage — qualifying every true figure in the document;
  //   - the longest gap measured across raw rows alone, so a fixture dark for eight days
  //     reported a one-minute gap, because the dark stretch lay in the pruned half.
  //
  // The fix for both is that a raw row covers its minute and an hourly bucket covers its hour,
  // carrying the count of minutes actually seen inside it.
  const body = bodyOf('report_demand_summary');
  assert.match(body, /t\.ts\s*\+\s*interval\s*'1 minute'/i, 'a raw sample must span its minute');
  assert.match(body, /b\.hour\s*\+\s*interval\s*'1 hour'/i, 'an hourly bucket must span its hour');
  assert.match(body, /coalesce\(b\.sample_count,\s*0\)/i, 'a bucket contributes the minutes it saw');
  assert.match(body, /sum\(minutes\)/i, 'observed_minutes sums spans, it does not count rows');
  // The gap is computed over BOTH kinds of observation, not just the raw ones.
  assert.match(body, /lag\(end_at\)\s*over\s*\(\s*order by start_at\s*\)/i);
});

test('energy is the increment of the monotonic month counter, never the daily maxima', () => {
  // phase27 records the measurement: building_totals has no `online` column, so a frozen meter
  // repeats its last reading and summing daily maxima counted it again. On the week of
  // 2026-08-17 that produced 34.219 kWh against a counter that had advanced ~19.5.
  const body = bodyOf('report_daily_series');
  assert.match(body, /lag\(day_max\)\s*over\s*\(\s*order by d\s*\)/i);
  assert.match(body, /day_max\s*-\s*\w*\.?prev_max/i);
  assert.equal(/max\(\s*energy_kwh_today/i.test(body), false, 'the daily counter is the trap, not the source');
});

test('the daily series reaches one day before the window, so day one has a predecessor', () => {
  // Without it, the first day of a period reports its whole month-to-date as its own
  // consumption — a number that is large, plausible, and wrong only on the 1st.
  assert.match(bodyOf('report_daily_series'), /win_start\s*-\s*interval\s*'1 day'/i);
});

test('a month rollover is treated as a reset rather than a negative day', () => {
  assert.match(bodyOf('report_daily_series'), /when\s+i\.day_max\s*>=\s*i\.prev_max/i);
});

// --- the row-count cap ------------------------------------------------------------------------

test('the matrix raises rather than letting PostgREST truncate it', () => {
  // The cap is silent. phase9_history_buckets.sql records what that cost: a "7 day" chart that
  // held 17h39m and "rendered with axes and a plausible curve, and wrong".
  const body = bodyOf('report_hour_matrix');
  assert.match(body, /raise exception/i);
  assert.match(body, /900/);
  assert.match(body, /program_limit_exceeded/i);
});

test('the duration curve returns a fixed row count and bounds its own argument', () => {
  const body = bodyOf('report_demand_curve');
  assert.match(body, /p_points\s*<\s*2\s*or\s*p_points\s*>\s*501/i);
  assert.match(body, /raise exception/i);
  assert.match(body, /percentile_cont\(fractions\.f\)\s*within group\s*\(\s*order by\s+s\.v\s+desc/i);
});

// --- the seam and the timezone ----------------------------------------------------------------

test('the rollup wins the raw/hourly seam everywhere the two are unioned', () => {
  // An overlap is possible while a rollup pass is mid-flight; counting an hour twice is worse
  // than preferring one copy of it. phase10_history_archive.sql argues this at length.
  const unions = (sql.match(/union all/gi) ?? []).length;
  const guards = (sql.match(/not exists\s*\(\s*select 1/gi) ?? []).length;
  assert.ok(unions >= 5, `expected the raw/hourly union in several functions, found ${unions}`);
  assert.ok(guards >= 5, `every seam union needs its dedup guard; ${unions} unions, ${guards} guards`);
});

test('every day and hour bucket is computed in the building own timezone', () => {
  // The recomputation is where a timezone gets lost, and a day boundary an hour out moves
  // energy between two days without changing the total — so the month still reconciles.
  for (const fn of ['report_daily_series', 'report_hour_matrix', 'report_hour_profile']) {
    assert.match(bodyOf(fn), /at time zone p_tz/i, `${fn} must bucket in the site's zone`);
  }
});

test('the window is truncated to the period, so a mid-period date cannot produce a third answer', () => {
  const body = bodyOf('report_window');
  assert.match(body, /date_trunc\('week'/i);
  assert.match(body, /date_trunc\('month'/i);
  assert.match(body, /raise exception/i);
});

test('expected_minutes is derived from the window, not from a constant', () => {
  // A month is not 30 days, and a week spanning a DST change is not 168 hours. Asia/Manila has
  // no DST, which is precisely why a hardcoded figure would survive here and fail on the first
  // site the replication framework reaches that does.
  const body = bodyOf('report_window');
  assert.match(body, /extract\(epoch from \(we - ws\)\)\s*\/\s*60/i);
  assert.equal(/\b(1440|10080|44640)\b/.test(body), false, 'no hardcoded period length');
});

// --- resolution -------------------------------------------------------------------------------

test('every series function reports what resolution its numbers were computed at', () => {
  // building_totals is pruned at 30 days, so the same query returns a quieter answer every
  // month with no error and no event. A p95 from hourly means cannot reach the peaks the
  // samples had. Rendered beside the figure, the way coverage already is.
  for (const fn of ['report_daily_series', 'report_hour_profile', 'report_hour_matrix', 'report_demand_curve', 'report_demand_summary']) {
    assert.match(bodyOf(fn), /report_resolution\(/i, `${fn} must return its resolution`);
    assert.match(bodyOf(fn), /resolution\s+text/i, `${fn} must declare a resolution column`);
  }
  assert.match(bodyOf('report_resolution'), /'minute'/);
  assert.match(bodyOf('report_resolution'), /'hour'/);
  assert.match(bodyOf('report_resolution'), /'mixed'/);
});

// --- re-runnability ---------------------------------------------------------------------------

test('every function is create-or-replace, so the file is safe to paste twice', () => {
  // Migrations here are applied by hand into a SQL editor. "Did that one already run?" is a
  // question this file must never make expensive.
  assert.equal((sql.match(/create or replace function/gi) ?? []).length, FUNCTIONS.length);
  assert.equal(/create table/i.test(sql), false, 'phase37 adds no tables; it is read-only');
});

/** Body of one function, from its CREATE to the closing `$fn$;`. */
function bodyOf(name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `${name} is not defined in phase37`);
  const end = sql.indexOf('$fn$;', start);
  assert.notEqual(end, -1, `${name} has no terminated body`);
  return sql.slice(start, end);
}
