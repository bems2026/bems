-- RM-031: where a device sits INSIDE its space, so a floor plan can be drawn from data.
--
-- REQUIRES supabase/phase21_space_tree.sql (the placement column these coordinates qualify).
--
-- WHAT THIS REPLACES. `src/components/floorplan/FloorPlanView.tsx` holds an `OUTLET_LAYOUT`
-- array pinning `co1`..`co7` to literal SVG coordinates surveyed in one office, and derives its
-- lighting rows from a formula shared with that office's 3D scene. The plan is therefore
-- unusable at a second site, and worse than unusable: it would draw THAT site's devices at THIS
-- site's positions and look entirely correct while doing it. RM-032 refused to fall back to it
-- for exactly that reason. These two columns are what let the plan be drawn instead of written.
--
-- NORMALISED 0..1, NOT PIXELS AND NOT METRES.
--   * Pixels bind a placement to one viewBox. The 2D plan, a phone-sized render and a future
--     print of the same room would each need their own numbers for the same physical spot.
--   * Metres would be better still, and are a lie we cannot currently tell honestly: nothing in
--     this system has surveyed a room. `space_nodes.attrs` has room for real dimensions when
--     somebody measures them, and a normalised coordinate converts into that later without
--     being re-entered.
-- What 0..1 does assert is only what an operator actually knows by looking: this device is
-- about a quarter of the way along and three quarters of the way down THIS room. That is true
-- at any render size, and it is the whole claim.
--
-- Apply once, by hand, in the Supabase SQL editor. Rehearse with supabase/rehearse.sh first.
--
-- RE-RUNNING IS SAFE. Every statement is guarded — and unlike phase21's original claim, that
-- has been earned rather than asserted: the constraints are dropped before they are added, the
-- trigger is dropped before it is created (PostgreSQL has no `create trigger if not exists`,
-- the same gap that made `create policy` a scar), and `test/migration-idempotency.test.mjs`
-- fails any file that makes this promise while leaving either kind unguarded.

-- =============================================================================
-- The coordinates.
-- =============================================================================
alter table device_config add column if not exists plan_x numeric;
alter table device_config add column if not exists plan_y numeric;

comment on column device_config.plan_x is
  'Position across this device''s space node, 0..1 left to right. NULL means unplaced within the room, which is different from unplaced in the building (space_node_id).';
comment on column device_config.plan_y is
  'Position down this device''s space node, 0..1 top to bottom.';

-- =============================================================================
-- Three invariants, because a plan drawn from half-valid data still looks like a plan.
-- =============================================================================

-- 1. INSIDE THE FRAME. A coordinate outside 0..1 is not a position in this room; rendered, it
--    lands outside the drawing or is silently clamped to an edge nobody chose.
alter table device_config drop constraint if exists device_config_plan_x_range;
alter table device_config add  constraint device_config_plan_x_range check (plan_x is null or (plan_x >= 0 and plan_x <= 1));
alter table device_config drop constraint if exists device_config_plan_y_range;
alter table device_config add  constraint device_config_plan_y_range check (plan_y is null or (plan_y >= 0 and plan_y <= 1));

-- 2. BOTH OR NEITHER. Half a placement is the worst of the three states: the renderer must
--    invent the missing axis, and whatever it invents looks exactly as deliberate as a surveyed
--    position. Either the operator placed this device or they did not.
alter table device_config drop constraint if exists device_config_plan_both_axes;
alter table device_config add  constraint device_config_plan_both_axes check ((plan_x is null) = (plan_y is null));

-- 3. A POSITION NEEDS A ROOM TO BE A POSITION IN. "Three quarters of the way down" is
--    meaningless without naming what it is three quarters of the way down. This constraint is
--    only survivable because of the trigger below, which clears the coordinates BEFORE the
--    check runs — see its own note.
alter table device_config drop constraint if exists device_config_plan_needs_node;
alter table device_config add  constraint device_config_plan_needs_node check (plan_x is null or space_node_id is not null);

-- =============================================================================
-- Moving a device to another room discards where it was in the old one.
-- =============================================================================
-- THE BUG THIS PREVENTS, which is quiet and would be believed: a device is placed in the Lab at
-- (0.25, 0.75). Somebody moves it to the Server Room. Without this, it appears in the Server
-- Room at (0.25, 0.75) — a spot nobody chose, in a room the device has never been in, drawn
-- with exactly the same confidence as a position an operator dragged it to. Coordinates are
-- relative to a node, so they do not survive leaving it.
--
-- ALSO THE DELETE PATH, and this is why it is a trigger rather than more constraint. phase21
-- made `space_node_id` `on delete set null`, so deleting a room performs an UPDATE that nulls
-- the placement. Invariant 3 above would then reject that update and the room could not be
-- deleted at all. A BEFORE trigger runs ahead of constraint checking, so the coordinates are
-- already gone by the time the check looks — the delete succeeds and the invariant holds.
--
-- "CARRIED OVER" IS NOT THE SAME AS "SET FOR THE NEW ROOM", and the first rehearsal of this
-- file is what forced the distinction. Clearing on EVERY move also cleared the write that
-- places a device and positions it in one statement — which is what an import, a provisioning
-- script, or a drag onto a room the device was not yet in all look like. The two cases differ
-- in exactly one observable way: a payload that merely carried the old coordinates along has
-- not changed them, and a payload that chose new ones has. That is the test below.
create or replace function public.device_config_clear_plan_on_move()
returns trigger
language plpgsql
as $$
begin
  -- `is distinct from`, not `<>`, in all three comparisons: a move to or from NULL is still a
  -- move and NULL coordinates are still a value, and `<>` yields NULL rather than true for
  -- either — which would leave the coordinates in place in exactly the delete case above.
  if new.space_node_id is distinct from old.space_node_id
     and new.plan_x is not distinct from old.plan_x
     and new.plan_y is not distinct from old.plan_y then
    new.plan_x := null;
    new.plan_y := null;
  end if;
  return new;
end $$;

-- Fires on the whole-row upsert the UI writes, too, which is the case worth stating: the device
-- editor sends every column on every save, so a save that changes the room carries the OLD
-- room's coordinates in its payload. They are discarded here rather than trusted. The device
-- then shows as unplaced within its new room, which is the truth.
drop trigger if exists device_config_clear_plan_on_move on device_config;
create trigger device_config_clear_plan_on_move
  before update on device_config
  for each row
  execute function public.device_config_clear_plan_on_move();
