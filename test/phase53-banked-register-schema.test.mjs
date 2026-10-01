/**
 * Guards supabase/phase53_banked_register.sql — RM-155.
 *
 * WHY THIS FILE EXISTS. phase42's rule credited each hour's rise of the register's HIGHEST reading, so
 * a register that fell inside an hour lost everything used between the top and the fall. On 2026-09-23
 * `mtr_co_yellow` fell 5.322 -> 0.290 kWh at 11:20 and the day was stored as 11.21 kWh against 14.22
 * integrated from its own power. phase53 banks the register across a fall: each hour is reduced to its
 * first reading, its last, and what it rose by between them, and the day is summed from those.
 *
 * File-text tests, like phase47's. `supabase/rehearse.sh` runs the banking, the rollup and the
 * restatement on a real Postgres; this checks what the rehearsal cannot see:
 *   - the two report functions and the rollup changed ONLY the lines that carry the register: undo
 *     those edits and each is phase47's text, byte for byte, so the cap, the clip and every power,
 *     minute and coverage figure are provably the rule they were;
 *   - the raw minutes and the rollup reduce an hour with the same filter, in the same order;
 *   - an hour rolled up before this file reads as phase42's rule;
 *   - the old figures are counted before any function is replaced, and the restatement touches only a
 *     row that still equals them;
 *   - the grants follow phase47's, and nothing is created a rehearsal would miss.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const PATH = join(ROOT, 'supabase', 'phase53_banked_register.sql');

const file = existsSync(PATH) ? read('supabase', 'phase53_banked_register.sql') : '';
/** Statements only — negative assertions must not trip over a comment that names what is avoided. */
const sql = file.replace(/--[^\n]*/g, '');
const phase47 = read('supabase', 'phase47_held_minutes.sql');

/** The text of one `create ... function` through its closing `<tag>;`. */
function functionText(text, name) {
  const start = text.search(new RegExp(`create (or replace )?function public\\.${name}\\(`, 'i'));
  assert.ok(start > -1, `${name} is not defined`);
  const tag = text.slice(start).match(/as (\$[a-z]*\$)/)[1];
  const open = text.indexOf(tag, start) + tag.length;
  const end = text.indexOf(`${tag};`, open);
  assert.ok(end > -1, `${name} has no closing ${tag};`);
  return text.slice(start, end + tag.length + 1);
}

/** Replaces exactly one occurrence, so an edit that vanished or doubled fails rather than passes. */
function undoAll(text, edits) {
  let now = text;
  for (const [after, before] of edits) {
    const n = now.split(after).length - 1;
    assert.equal(n, 1, `expected exactly one of: ${after.trim().split('\n')[0].slice(0, 90)} (found ${n})`);
    now = now.replace(after, () => before);
  }
  return now;
}

const REG = 'filter (where r.online and r.energy_kwh_today is not null)';

/** phase53's lines -> phase47's, for both report functions. */
const REPORT_EDITS = [
  ['  with hrs (dev, bucket, avg_w, max_w, e_first, e_last, e_gain, n_on, from_raw) as (\n',
   '  with hrs (dev, bucket, avg_w, max_w, e_max, n_on, from_raw) as (\n'],
  ['    -- An hour rolled up before phase53 kept only its highest reading. Read as its first and its last alike,\n' +
   '    -- with nothing risen inside it, it banks to exactly phase42\'s rule.\n' +
   '    select h.device_id, h.hour, h.power_w_avg, h.power_w_max,\n' +
   '           coalesce(h.energy_kwh_today_first, h.energy_kwh_today_max),\n' +
   '           coalesce(h.energy_kwh_today_last,  h.energy_kwh_today_max),\n' +
   '           coalesce(h.energy_kwh_gain, 0),\n' +
   '           h.online_sample_count, false\n',
   '    select h.device_id, h.hour, h.power_w_avg, h.power_w_max, h.energy_kwh_today_max, h.online_sample_count, false\n'],
  [`           (array_agg(r.energy_kwh_today order by r.ts)      ${REG})[1],\n` +
   `           (array_agg(r.energy_kwh_today order by r.ts desc) ${REG})[1],\n` +
   `           public.register_gain(array_agg(r.energy_kwh_today order by r.ts) ${REG}),\n`,
   '           max(r.energy_kwh_today) filter (where r.online),\n'],
  ['  -- RM-155: the register BANKED across a fall, per device and local day, over the hours that carry it:\n' +
   '  -- each hour adds what it rose by inside itself, plus any rise from the hour before\'s last reading to\n' +
   '  -- its first. A fall adds nothing and counting goes on from the lower value. A register that never\n' +
   '  -- falls banks to exactly its highest reading, so `e_max` below is what it always was.\n' +
   '  registers as (\n' +
   '    select q.dev, q.bucket,\n' +
   '           sum(greatest(q.e_first - coalesce(q.prev_last, 0), 0) + q.e_gain)\n' +
   '             over (partition by q.dev, q.d order by q.bucket) as e_banked\n' +
   '      from (\n' +
   '        select x.dev, x.bucket, x.e_first, x.e_gain,\n' +
   '               (x.bucket at time zone p_tz)::date as d,\n' +
   '               lag(x.e_last) over (partition by x.dev, (x.bucket at time zone p_tz)::date order by x.bucket) as prev_last\n' +
   '          from hrs x\n' +
   '         where x.e_last is not null\n' +
   '      ) q\n' +
   '  ),\n' +
   '  dayed as (\n' +
   '    select x.dev, x.bucket, x.avg_w, x.max_w, bk.e_banked as e_max, x.n_on, x.from_raw,\n' +
   '           (x.bucket at time zone p_tz)::date as d\n' +
   '      from hrs x\n' +
   '      left join registers bk on bk.dev = x.dev and bk.bucket = x.bucket\n' +
   '  ),\n',
   '  dayed as (\n' +
   '    select x.dev, x.bucket, x.avg_w, x.max_w, x.e_max, x.n_on, x.from_raw,\n' +
   '           (x.bucket at time zone p_tz)::date as d\n' +
   '      from hrs x\n' +
   '  ),\n'],
];

const SREG = 'filter (where s.online and s.energy_kwh_today is not null)';

/** phase53's rollup lines -> phase47's. */
const ROLLUP_EDITS = [
  ['    energy_kwh_today_max, sample_count, online_sample_count, held_sample_count,\n' +
   '    energy_kwh_today_first, energy_kwh_today_last, energy_kwh_gain\n',
   '    energy_kwh_today_max, sample_count, online_sample_count, held_sample_count\n'],
  ['         count(*) filter (where s.online and not s.measured)::int,\n' +
   '         -- RM-155: the register as banking reads an hour, in time order: first, last, and what it rose by.\n' +
   `         (array_agg(s.energy_kwh_today order by s.ts)      ${SREG})[1],\n` +
   `         (array_agg(s.energy_kwh_today order by s.ts desc) ${SREG})[1],\n` +
   `         public.register_gain(array_agg(s.energy_kwh_today order by s.ts) ${SREG})\n`,
   '         count(*) filter (where s.online and not s.measured)::int\n'],
];

test('phase53 exists', () => {
  assert.ok(file.length > 0, 'supabase/phase53_banked_register.sql is missing');
});

for (const name of ['report_device_daily_energy', 'report_hour_energy']) {
  test(`${name}: only the register lines changed from phase47`, () => {
    assert.equal(undoAll(functionText(file, name), REPORT_EDITS), functionText(phase47, name));
  });
}

test('roll_up_and_prune_readings: only the register lines changed from phase47', () => {
  assert.equal(undoAll(functionText(file, 'roll_up_and_prune_readings'), ROLLUP_EDITS), functionText(phase47, 'roll_up_and_prune_readings'));
});

test('raw minutes and the rollup reduce an hour the same way', () => {
  const reductions = (text, alias) =>
    text.split('\n').filter((l) => l.includes('energy_kwh_today order by')).map((l) => l.trim().replace(/,$/, '').split(`${alias}.`).join('x.'));
  const raw = reductions(REPORT_EDITS[2][0], 'r');
  assert.equal(raw.length, 3);
  assert.deepEqual(reductions(ROLLUP_EDITS[1][0], 's'), raw);
});

test('register_gain: what an ordered run rose by, falls adding nothing', () => {
  const text = functionText(file, 'register_gain');
  assert.match(text, /register_gain\(p_values numeric\[\]\)/);
  assert.match(text, /returns numeric/);
  assert.match(text, /language sql/);
  assert.match(text, /\bimmutable\b/);
  assert.match(text, /greatest\(p_values\[i\] - p_values\[i - 1\], 0\)/);
  assert.match(text, /cardinality\(p_values\) > 0/, 'no readings is NULL, not 0');
  assert.match(sql, /revoke execute on function public\.register_gain\(numeric\[\]\) from public, anon;/);
  assert.match(sql, /grant\s+execute on function public\.register_gain\(numeric\[\]\) to authenticated, service_role;/);
});

test('the columns', () => {
  for (const col of ['energy_kwh_today_first', 'energy_kwh_today_last', 'energy_kwh_gain']) {
    assert.match(sql, new RegExp(`alter table readings_hourly add column if not exists ${col}\\s+numeric;`), col);
  }
  assert.match(sql, /alter table period_reports\s+add column if not exists energy_kwh_before\s+numeric;/);
});

test('the grants are phase47\'s, restated', () => {
  for (const name of ['report_device_daily_energy', 'report_hour_energy', 'roll_up_and_prune_readings']) {
    const lines = phase47.split('\n').filter((l) => /^(revoke|grant)\s+execute on function/.test(l) && l.includes(`public.${name}(`));
    assert.ok(lines.length > 0, `phase47 has no grants for ${name}`);
    for (const l of lines) assert.ok(sql.includes(l.trim()), `phase53 does not restate: ${l.trim()}`);
  }
});

test('the old figures are counted before any function is replaced', () => {
  const snap = sql.indexOf('insert into phase53_before');
  assert.ok(snap > -1, 'no snapshot');
  for (const name of ['report_device_daily_energy', 'report_hour_energy', 'roll_up_and_prune_readings']) {
    assert.ok(snap < sql.indexOf(`create or replace function public.${name}(`), `${name} is replaced before the snapshot`);
  }
  assert.match(sql, /create temporary table phase53_before/);
  assert.match(sql, /exists \(select 1 from readings x where x\.ts >= w\.win_start and x\.ts < w\.win_end\)/, 'only periods that still hold raw minutes');
});

test('the restatement keeps the first figure, and touches only a row built by the old rule that banking changes', () => {
  const block = sql.slice(sql.lastIndexOf('do $$'));
  assert.match(block, /energy_kwh_before\s*=\s*coalesce\(p\.energy_kwh_before, p\.energy_kwh\)/);
  assert.match(block, /energy_restated_at\s*=\s*now\(\)/);
  assert.match(block, /abs\(p\.energy_kwh - b\.energy_kwh\) <= 0\.0005/, 'the stored row must still be the old rule\'s figure');
  assert.match(block, /abs\(f\.e - b\.energy_kwh\) > 0\.0005/, 'a row banking leaves alone is not restated');
  assert.doesNotMatch(block, /generated_at\s*=|online_sample_count\s*=|peak_power_w\s*=/);
  assert.match(sql, /drop table phase53_before;/);
  assert.match(sql, /notify pgrst, 'reload schema';\s*$/);
});

test('nothing a rehearsal would miss: no policy, trigger or rewrite of readings', () => {
  assert.doesNotMatch(sql, /create policy|create trigger/i);
  assert.doesNotMatch(sql, /alter table (public\.)?readings\b/i);
  assert.doesNotMatch(sql, /security definer/i, 'phase52 decides which report functions run as their owner');
});
