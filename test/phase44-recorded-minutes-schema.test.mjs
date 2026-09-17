/**
 * Guards supabase/phase44_recorded_minutes.sql — RM-073 and RM-111.
 *
 * WHY THIS FILE EXISTS. The stored reports' `online_sample_count` counted rows. A meter that stopped
 * observing kept writing rows with no reading in them, so the week of 2026-08-17 was stored as "Complete ·
 * 98%" while 1,640 of its 10,080 minutes held a reading. And a row is not always its own minute: every
 * ingest restart writes a second one. phase44 counts distinct minutes that hold a reading, in the two
 * generators and in the page's summary, and restates the stored figures with a note (decided 2026-09-17).
 *
 * File-text tests, like phase42's. `supabase/rehearse.sh` runs the counts and the restatement on a real
 * Postgres; this checks what the rehearsal cannot see:
 *   - the generators and the summary changed ONLY their counts: undo the listed substitutions and each is
 *     the earlier file's text, byte for byte, so no energy, peak or average can have moved;
 *   - the restatement writes the count and its note, in the four tables named, and nothing else;
 *   - the helpers are for the service role, and the summary stays the signed-in reader's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

const file = read('supabase', 'phase44_recorded_minutes.sql');
const phase42 = read('supabase', 'phase42_bounded_device_energy.sql');
const phase37 = read('supabase', 'phase37_report_series.sql');

/** Statements only — negative assertions must not trip over a comment that names what is avoided. */
const sql = file.replace(/--[^\n]*/g, '');

/** The text of one `create ... function` through its closing `$fn$;`. */
function functionText(text, name) {
  const start = text.search(new RegExp(`create (or replace )?function public\\.${name}\\(`, 'i'));
  assert.ok(start > -1, `${name} is not defined`);
  const end = text.indexOf('$fn$;', text.indexOf('$fn$', start) + 4);
  assert.ok(end > -1, `${name} has no closing $fn$;`);
  return text.slice(start, end + 5);
}

/** Undo one substitution, which must be present exactly once. */
function undo(text, now, before, label) {
  const n = text.split(now).length - 1;
  assert.equal(n, 1, `${label}: expected the phase44 text once, found ${n}`);
  return text.replace(now, () => before);
}

const PER_DEVICE = `  per_device as (
    select h.device_id,
           max(h.power_w_max) as peak_power_w,`;
const recorded = (start, end) => `  -- RM-073: the minutes that hold a reading, counted once each — never rows. See phase44's header.
  recorded as materialized (
    select m.device_id as dev, m.minutes
      from public.report_recorded_minutes_devices(${start}, ${end}) m
  ),
${PER_DEVICE}`;

for (const [name, start, end, conflict] of [
  ['generate_period_report', 'win_start', 'win_end', '(period, period_start, device_id)'],
  ['generate_monthly_report', 'month_start', 'month_end', '(month, device_id)'],
]) {
  test(`${name}: only its two coverage counts differ from phase42's text`, () => {
    let text = functionText(file, name);
    text = undo(text, recorded(start, end), PER_DEVICE, 'the recorded CTE');
    text = undo(text, '         coalesce(rm.minutes, 0),\n         expected,', '         d.online_sample_count,\n         expected,', 'the device count');
    text = undo(
      text,
      `    left join bounded bd on bd.dev = d.device_id\n    left join recorded rm on rm.dev = d.device_id\n  on conflict ${conflict} do update set`,
      `    left join bounded bd on bd.dev = d.device_id\n  on conflict ${conflict} do update set`,
      'the recorded join'
    );
    text = undo(
      text,
      `         public.report_recorded_minutes_building(${start}, ${end}),`,
      '         coalesce((select sum(sample_count)::int from totals_hours), 0),',
      'the building count'
    );
    assert.equal(text, functionText(phase42, name));
  });
}

test('report_demand_summary: only its observations differ from phase37’s text — one per minute, an hour at most 60', () => {
  let text = functionText(file, 'report_demand_summary');
  const rawNow = text.slice(text.indexOf('    -- phase44 (RM-111)'), text.indexOf("     group by date_trunc('minute', t.ts)\n") + "     group by date_trunc('minute', t.ts)\n".length);
  assert.match(rawNow, /select date_trunc\('minute', t\.ts\) as start_at/);
  assert.match(rawNow, /case when count\(t\.total_power_w\) = 0 then 0 else 1 end as usable, avg\(t\.total_power_w\) as v/);
  text = undo(
    text,
    rawNow,
    `    select t.ts as start_at, t.ts + interval '1 minute' as end_at, 1 as minutes,
           case when t.total_power_w is null then 0 else 1 end as usable, t.total_power_w as v
      from building_totals t
     where t.ts >= w.win_start and t.ts < w.win_end
`,
    'the raw observations'
  );
  text = undo(
    text,
    `    select b.hour, b.hour + interval '1 hour', least(coalesce(b.sample_count, 0), 60),
           case when b.total_power_w_avg is null then 0 else least(coalesce(b.sample_count, 0), 60) end,`,
    `    select b.hour, b.hour + interval '1 hour', coalesce(b.sample_count, 0),
           case when b.total_power_w_avg is null then 0 else coalesce(b.sample_count, 0) end,`,
    'the hourly observations'
  );
  assert.equal(text, functionText(phase37, 'report_demand_summary'));
});

test('the summary stays the signed-in reader’s, and the generators the service role’s', () => {
  assert.match(sql, /revoke execute on function public\.report_demand_summary\(text, date, text\) from public, anon;/);
  assert.match(sql, /grant\s+execute on function public\.report_demand_summary\(text, date, text\) to authenticated;/);
  assert.match(sql, /grant\s+execute on function public\.generate_period_report\(text, date, text\) to service_role;/);
  assert.match(sql, /grant\s+execute on function public\.generate_monthly_report\(date, text\) to service_role;/);
});

for (const [name, signature] of [
  ['report_recorded_minutes_building', '(timestamptz, timestamptz)'],
  ['report_recorded_minutes_devices', '(timestamptz, timestamptz)'],
]) {
  test(`${name}: dropped by its signature first, runs as its caller, and is the service role’s alone`, () => {
    const esc = signature.replace(/[()]/g, '\\$&');
    const drop = sql.search(new RegExp(`drop function if exists public\\.${name}${esc};`));
    const create = sql.search(new RegExp(`create function public\\.${name}\\(`));
    assert.ok(drop > -1 && create > drop, 'drop by exact signature, then create');
    const text = functionText(sql, name);
    assert.match(text, /\bstable\b/);
    assert.match(text, /security invoker/);
    assert.match(sql, new RegExp(`revoke execute on function public\\.${name}${esc} from public, anon;`));
    assert.match(sql, new RegExp(`grant\\s+execute on function public\\.${name}${esc} to service_role;`));
    assert.doesNotMatch(sql, new RegExp(`grant\\s+execute on function public\\.${name}${esc} to [^;]*\\b(authenticated|anon)\\b`));
  });
}

test('the helpers count distinct minutes that hold a reading, and a rolled-up hour never more than 60', () => {
  const building = functionText(sql, 'report_recorded_minutes_building');
  assert.match(building, /count\(distinct date_trunc\('minute', t\.ts\)\) filter \(where t\.total_power_w is not null\)/);
  assert.match(building, /case when b\.total_power_w_avg is null then 0 else least\(coalesce\(b\.sample_count, 0\), 60\) end/);
  assert.match(building, /not exists \(select 1 from raw_hours r where r\.hour = b\.hour\)/);

  const devices = functionText(sql, 'report_recorded_minutes_devices');
  assert.match(devices, /count\(distinct date_trunc\('minute', r\.ts\)\) filter \(where r\.online\)/);
  assert.match(devices, /least\(coalesce\(h\.online_sample_count, 0\), 60\)/);
  assert.match(devices, /not exists \(select 1 from raw_hours r where r\.dev = h\.device_id and r\.hour = h\.hour\)/);
});

test('the note columns are added to both period tables, only if missing', () => {
  for (const table of ['period_building_reports', 'period_reports']) {
    assert.match(sql, new RegExp(`alter table ${table} add column if not exists online_sample_count_before int;`));
    assert.match(sql, new RegExp(`alter table ${table} add column if not exists coverage_restated_at timestamptz;`));
  }
});

test('the restatement writes the count and its note, in four tables, skips what is done, and deletes nothing', () => {
  const block = sql.slice(sql.indexOf('do $$'), sql.indexOf('end $$;'));
  assert.ok(block.length > 0, 'the restatement block is missing');
  assert.doesNotMatch(block, /\b(delete|insert|truncate)\b/i);

  const updates = [...block.matchAll(/update (\w+) (\w+)\s+set ([\s\S]*?)\n\s+where ([\s\S]*?);/g)];
  assert.deepEqual(updates.map((u) => u[1]).sort(), ['monthly_building_reports', 'monthly_reports', 'period_building_reports', 'period_reports']);
  for (const [, table, , set, where] of updates) {
    const columns = set.split(/,\n/).map((s) => s.trim().split(/\s*=/)[0]).sort();
    if (table.startsWith('period_')) {
      assert.deepEqual(columns, ['coverage_restated_at', 'online_sample_count', 'online_sample_count_before'], `${table} SET list`);
      assert.match(where, /coverage_restated_at is null/, `${table} skips a restated row`);
      // The old count is copied in the same statement that replaces it, so the note always holds what the row said.
      assert.match(set, /online_sample_count_before = \w+\.online_sample_count/);
    } else {
      assert.deepEqual(columns, ['online_sample_count'], `${table} SET list`);
    }
    assert.match(where, /online_sample_count is distinct from/, `${table} leaves a right count alone`);
  }
});

test('it tells the API about the new columns', () => {
  assert.match(sql.trimEnd(), /notify pgrst, 'reload schema';$/);
});
