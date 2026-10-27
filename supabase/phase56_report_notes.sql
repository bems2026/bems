-- RM-164: notes people write on the Reports page — one per day, and one per report.
--
-- REQUIRES supabase/phase19_sites.sql (every row belongs to a site).
--
-- WHY. The operator asked (2026-10-27) for the "Energy per day" table to carry a note for each day — why a
-- day's energy was low, high or unusual — and for a report to carry remarks of its own, in the page and in
-- the exported document. These are words a person writes about the building's record; they change nothing
-- the system measures or does.
--
-- ONE TABLE, keyed by what the note is about:
--   kind = 'day'                    start = that local day                 the day's note
--   kind = 'week' | 'month' | 'year' start = the period's first local day  that report's remarks
--
-- Apply once, by hand, in the Supabase SQL editor. Rehearse with supabase/rehearse.sh first.
--
-- RE-RUNNING IS SAFE: `create table if not exists`, and every policy is dropped before it is created.

create table if not exists report_notes (
  site_id    text not null references sites(id) on delete cascade,
  kind       text not null check (kind in ('day', 'week', 'month', 'year')),
  start      date not null,
  -- A note, not a document: a long paragraph at most. An empty note is a cleared one (see below).
  note       text not null default '' check (char_length(note) <= 2000),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  -- The key IS what the note is about, so supabase-js's upsert can name it in ON CONFLICT.
  primary key (site_id, kind, start)
);

comment on table report_notes is
  'Notes written on the Reports page: one per local day (kind = day) and one per report (kind = week/month/year, start = its first day). RM-164.';
comment on column report_notes.note is
  'Free text, up to 2,000 characters. An empty note is a cleared one: the row stays, so who cleared it is kept.';

alter table report_notes enable row level security;

-- The access model of site_ui_prefs and device_config: signed-in users read and write, nobody else.
-- NO DELETE POLICY, deliberately: clearing a note writes '' and keeps `updated_by`, the only record of
-- who changed what a report says.
drop policy if exists report_notes_select_authenticated on report_notes;
create policy report_notes_select_authenticated on report_notes
  for select using (auth.role() = 'authenticated');
drop policy if exists report_notes_insert_authenticated on report_notes;
create policy report_notes_insert_authenticated on report_notes
  for insert with check (auth.role() = 'authenticated');
drop policy if exists report_notes_update_authenticated on report_notes;
create policy report_notes_update_authenticated on report_notes
  for update using (auth.role() = 'authenticated');

-- Order matters: revoke first, then grant, or the grant is undone.
revoke all on report_notes from public, anon, authenticated;
grant select, insert, update on report_notes to authenticated;
