-- RM-037: where a switch's lamps are, so a lighting layout can be drawn from data.
--
-- REQUIRES supabase/phase23_plan_coords.sql (the single-point columns these sit beside).
--
-- WHAT THIS REPLACES. `src/components/control/plans/carePlan.ts` gives every lighting circuit
-- exactly three ceiling cells at coordinates surveyed in one office. A second site inherits that
-- geometry and is drawn incorrectly while looking entirely correct — the same failure RM-032
-- refused to fall back to the old floor plan for. It is also simply wrong for any room that does
-- not have three fixtures per circuit.
--
-- POINTS, NOT GRID CELL INDICES. This is the decision worth defending.
--
-- The editor paints lamps onto a grid, so storing "cells 3, 4 and 7" is the obvious encoding.
-- It is wrong: a cell index means nothing without the grid that produced it, so resizing a room
-- from 4x3 to 5x3 would silently relocate every luminaire in the building — while nothing had
-- physically moved. The grid is an INPUT METHOD, not a storage format.
--
-- Normalised 0..1 points survive a resize, need no coupling to `space_nodes.attrs.plan`, and
-- reuse the convention `plan_x`/`plan_y` already established. Same reasoning phase23 gives for
-- normalising in the first place: pixels bind a placement to one viewBox, and metres would claim
-- a survey nobody has done.
--
-- WHY NOT REUSE plan_x/plan_y. Those say where a device IS. This says where the several things
-- one device controls are. An outlet has a position; a lighting circuit has a set of them.
-- Collapsing both into one nullable array would make every consumer ask "is this one thing or
-- many?" before it could render either.
--
-- APPLY THIS BEFORE DEPLOYING THE FRONTEND THAT READS IT. `readDeviceConfigs` names every column
-- in one `select`, so against a database without `plan_fixtures` PostgREST fails the whole query
-- (42703) rather than omitting the column — and that query is what carries rooms, categories,
-- shed groups and plan positions. Deploying first does not degrade the plan; it takes the whole
-- device-config layer down until this runs.
--
-- Apply once, by hand, in the Supabase SQL editor. Rehearse with supabase/rehearse.sh first.
--
-- RE-RUNNING IS SAFE. `add column if not exists` guards itself and the constraint is dropped
-- before it is added — `alter table ... add constraint` has no `if not exists`, the same gap
-- that made `create policy` a scar in phase21. `test/migration-idempotency.test.mjs` fails any
-- file that makes this promise without earning it.

alter table device_config add column if not exists plan_fixtures jsonb;

comment on column device_config.plan_fixtures is
  'For a device that occupies several places at once — today, a lighting circuit and its lamps. An array of {"x":0..1,"y":0..1} points in the same frame as plan_x/plan_y. NOT grid cell indices: an index is meaningless without the grid that made it, so a grid resize would relocate every luminaire while nothing had moved. NULL means "no lamps described", which is different from an empty array meaning "this circuit controls nothing here".';

-- A jsonb column accepts a number, a string or an object just as happily as the array this is
-- meant to hold, and every one of those would reach the frontend as a lighting layout. The
-- parser tolerates junk (`src/lib/lightingGrid.ts`), but a constraint stops it being stored in
-- the first place — cheaper than discovering it on a plan that renders nothing.
--
-- Deliberately NOT validating the points themselves. Postgres can say "this is an array"; saying
-- "every element is an object with two numeric keys in 0..1" is a check expression nobody will
-- read and which would reject a future field added alongside x and y.
alter table device_config drop constraint if exists device_config_plan_fixtures_is_array;
alter table device_config add constraint device_config_plan_fixtures_is_array
  check (plan_fixtures is null or jsonb_typeof(plan_fixtures) = 'array');
