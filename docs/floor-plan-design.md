# Customisable floor plans — design

**Status:** design agreed 2026-09-01, not yet built.
**Tracks:** RM-035 (A), RM-036 (B), RM-037 (C) in `ROADMAP.md`, which stays the source of truth
for what is actually built. This file describes the shape of the work, not its state.

---

## The problem

`space_nodes` now holds a real tree — `NBERIC → First → Left → CARE Office` — and **nothing is in
it**: 0 of 20 devices are assigned to a space, and none carry plan coordinates. So RM-030's
by-space totals and RM-031's data-drawn plan both have the schema they need and no data to draw.

The reason the placement step has not been taken is that the result is not yet worth having. The
plan frame is a fixed square, which no office is, and the Control page's lighting layout comes
from `src/components/control/plans/carePlan.ts` — a pack that pins `co1`–`co7` to coordinates
surveyed in one room and gives every switch exactly three ceiling cells. A second site inherits
that geometry and is drawn **incorrectly while looking entirely correct**, which is why RM-032
refused to fall back to it.

This design makes a room drawable, its lighting layout describable, and both cards removable for
a site that wants neither.

## Non-goals

- **Real dimensions.** Coordinates stay normalised 0..1. Nothing here has surveyed a room, and
  metres would assert a fact nobody established. `space_nodes.attrs` has room for dimensions when
  somebody measures them, and a 0..1 position converts into them later without being re-entered.
- **Drag-and-drop.** Placement stays click-to-place, for the reason `SpacePlanView` already
  records: a drag needs pointer capture, behaves differently under touch, and is unreachable from
  a keyboard — so the accessible path would have to be built anyway.
- **A 3D editor.** The 3D scene keeps its build-time pack (`SITE.scene_pack`). Stage A only makes
  its card removable.
- **Multi-floor plans in one view.** A node's plan draws the devices in that node. Descendants are
  counted and named, not drawn — the existing rule, unchanged.

---

## Stage A — the plan and 3D cards become removable

### Where the setting lives, and why not on `sites`

**A new `site_ui_prefs` table, not a column on `sites`.**

`sites` is deliberately read-only from the browser. `phase19_sites.sql` says so in as many words:
*"no insert/update policy is granted to `authenticated` on purpose: a signed-in user should not be
able to retarget a whole deployment."* That row also carries `policy.acu_min_setpoint_c`, the
university's energy-efficiency floor which `validateCommand` enforces server-side. RLS is
row-level, not column-level, so granting UPDATE for a display preference would also grant it for
the aircon policy, the timezone and the site's identity.

`site_ui_prefs` is to `sites` exactly what `device_config` is to `devices`: the operator-writable
sibling of a read-only table. That pattern already exists here and is the reason it is the right
answer rather than merely a workaround.

```sql
-- supabase/phase24_site_ui_prefs.sql
create table if not exists site_ui_prefs (
  site_id    text primary key references sites(id) on delete cascade,
  prefs      jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
```

`jsonb` rather than a column per card, for the reason `space_nodes.attrs` gives: a new preference
must never require a migration.

RLS: select/insert/update to `authenticated`; **no delete** — clearing a preference is a write of
defaults, not a deletion, which is the same distinction `device_config` draws. Every policy
dropped before it is created, because PostgreSQL has no `create policy if not exists` and this
repo has a scar from assuming otherwise (`phase21`). `test/migration-idempotency.test.mjs` must
pass.

### Keys and defaults

```ts
// src/lib/siteUi.ts — pure
export interface SiteUiPrefs {
  controlPlanCard: boolean;   // Control → "Lighting & outlet plan"
  overviewSceneCard: boolean; // Overview → the 3D model hero
}
export const SITE_UI_DEFAULTS: SiteUiPrefs = { controlPlanCard: true, overviewSceneCard: true };
export function readSiteUi(raw: unknown): SiteUiPrefs;   // tolerant; junk yields defaults
export function writeSiteUi(prefs: SiteUiPrefs): Record<string, unknown>;
```

**Defaults are `true`**, so an existing deployment looks identical the moment the migration lands
and before anyone opens the panel. A migration that changes what is on screen without being asked
to is the kind of surprise this project spends effort avoiding.

`readSiteUi` never throws. A hand-edited row with `{"controlPlanCard": "no"}` yields the default
for that key, not a blank page.

### Components

| file | responsibility |
|---|---|
| `supabase/phase24_site_ui_prefs.sql` | the table, its policies, its comment |
| `src/lib/siteUi.ts` | defaults, parsing, serialising — pure |
| `src/stores/siteUiStore.ts` | load/save, `createRetrySchedule` like `spaceTreeStore` |
| `src/components/devices/PageCardsPanel.tsx` | the two toggles, on the Devices page |
| `src/components/control/ControlPage.tsx` | reads `controlPlanCard` |
| `src/components/overview/OverviewPage.tsx` | reads `overviewSceneCard` |

The toggles live on **Devices**, beside the space tree and load-shed panels, because that is
already where this deployment is configured — and because a control that hides a card cannot live
on the card it hides.

### The property that must hold

**Hiding a card never hides a control.** The Control page's `SwitchesListCard` and
`OutletsListCard` carry the same `commandStore.send` the plan pucks do; removing the plan removes
a picture. A test asserts that with `controlPlanCard: false` every lighting and outlet toggle is
still rendered and still dispatches. Losing a diagram is cosmetic; losing the ability to switch a
relay is not, and nothing in this stage may blur the two.

---

## Stage B — the room gets a shape

### The descriptor

Stored at `space_nodes.attrs.plan`. **No migration**: `attrs` exists for this, and its own comment
says so — *"Area, occupancy, whatever a later site needs. jsonb rather than columns because these
are descriptive facts about a building, and a new one must never require a migration."*

```ts
// src/lib/roomShape.ts — pure, unit square (0..1) throughout
export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export type RoomShape =
  | { kind: 'rect' }
  | { kind: 'l'; notch: Corner; nw: number; nh: number }
  | { kind: 't'; stemW: number; barH: number }
  | { kind: 'u'; notchW: number; notchH: number }
  | { kind: 'triangle'; apex: 'top' | 'bottom' | 'left' | 'right' }
  | { kind: 'circle' }
  | { kind: 'cells'; cols: number; rows: number; on: number[] };
// `on` holds cell indices in ROW-MAJOR order: index = row * cols + col, origin top-left.
// Stated because two implementations that disagree about this produce a mirrored room and
// neither looks obviously wrong.

export function shapeToPath(shape: RoomShape): string;
export function shapeToCells(shape: RoomShape, cols: number, rows: number): RoomShape;
export function parseShape(raw: unknown): RoomShape;
export const SHAPE_PRESETS: { kind: RoomShape['kind']; label: string; make: () => RoomShape }[];
```

**A descriptor, not a baked path.** A stored path is unreadable, un-editable and cannot be
re-parameterised — reopening the editor could only offer "start again". A descriptor round-trips:
the editor reads back the same L-shape the operator made and moves its notch.

**One renderer.** `shapeToPath` handles every kind, so there is a single code path to test and no
per-shape branch scattered through the view. `circle` renders as an inscribed ellipse via arc
segments, so it too is just a path.

**Eject to grid.** `shapeToCells` rasterises any shape into the `cells` kind — a cols×rows bitmap
— which is how a preset becomes nudgeable without a second storage format. This is one-way by
design: a rasterised L cannot become a parametric L again, and offering a false round-trip would
be worse than the button saying so.

`parseShape` is tolerant and falls back to `{ kind: 'rect' }`. A malformed `attrs.plan` from a
hand-edit must render the full square, never throw — a render that throws takes the page down,
which is a far worse outcome than a wrong-looking room.

### Components

| file | responsibility |
|---|---|
| `src/lib/roomShape.ts` | descriptors, path rendering, rasterising, parsing — pure |
| `src/components/spatial/RoomShapeEditor.tsx` | preset picker, numeric size fields, eject-to-grid, cell toggling |
| `src/components/spatial/SpacePlanView.tsx` | renders `shapeToPath` in place of its fixed square |
| `src/stores/spaceTreeStore.ts` | gains `saveAttrs(nodeId, attrs)` |

Sizing is by **numeric fields plus click targets**, not handles that must be dragged — the same
accessibility reasoning `SpacePlanView` already applied to placement. A handle is a nicety; a room
nobody can shape from a keyboard is a regression.

---

## Stage C — lights, their grid, and what switches them

### Lamps store as points, not as cells

**`device_config.plan_fixtures jsonb` — an array of `{x, y}` in the same 0..1 frame as
`plan_x`/`plan_y`.**

The obvious choice is to store grid cell indices, and it is wrong. Cell indices are meaningless
without the grid that produced them, so resizing a room's grid from 4×3 to 5×3 would silently
relocate every luminaire in the building — when in reality nothing moved. **The grid is an input
method, not a storage format.** Points survive a resize, need no coupling to `attrs.plan`, and
reuse the convention already established for single-point devices.

```sql
-- supabase/phase25_plan_fixtures.sql
alter table device_config add column if not exists plan_fixtures jsonb;
```

Guarded and idempotent, same discipline as `phase23`.

`plan_x`/`plan_y` stay for single-point devices (outlets, meters, sensors). `plan_fixtures` is for
a device that occupies several places at once — today that means a lighting circuit and its lamps.
The two are not merged: an outlet has a position, a circuit has a set of them, and collapsing that
into one nullable array would make every consumer ask "is this one thing or many?".

### The editor

`PlanPoint` throughout is the existing `{ x: number; y: number }` from `src/lib/planLayout.ts`,
not a new type — the plan already has one and a second would drift from it.

```ts
// src/lib/lightingGrid.ts — pure
export function gridCells(cols: number, rows: number): PlanPoint[];   // cell centres, 0..1
export function cellIndexAt(p: PlanPoint, cols: number, rows: number): number;
export function toggleFixture(existing: PlanPoint[], p: PlanPoint, cols: number, rows: number): PlanPoint[];
export function parseFixtures(raw: unknown): PlanPoint[];              // tolerant
export function containsPoint(shape: RoomShape, p: PlanPoint): boolean;
```

Pick a switch, tap cells; they colour in with that switch's colour. Tap again to remove. A 4×3
grid gives twelve luminaires in twelve taps, and setting the grid is one action.

`toggleFixture` snaps to the nearest cell centre and removes an existing fixture within that cell,
so tapping is idempotent per cell rather than accumulating near-duplicates.

`containsPoint` drives a **soft warning** when a device sits outside the drawn room — never a
block. The shape is the operator's sketch, not a survey, and refusing a placement because a
hand-drawn wall is slightly off would make the drawing authoritative over the building.

### Retiring the hard-coded pack

`useControlPlan` gains a data source and prefers it:

1. fixtures and positions from `device_config` for the selected room, if any exist;
2. else the build-time pack (`SITE.scene_pack` → `carePlan.ts`);
3. else the existing honest fallback — *"No plan is drawn for this site. Every lighting circuit is
   in the list below, with the same controls."*

The pack is kept as step 2 **on purpose and temporarily**. Deleting it in the same change would
leave the CARE office with no plan between the deploy and the moment somebody draws one. Once this
site's room is drawn and verified, `carePlan.ts` and its coordinates go in a follow-up — that
deletion is the actual close of FI-016's remaining half and of the last hard-coded building
geometry in the frontend.

---

## Cross-cutting

**Nothing names a device, a room or a coordinate.** Every module here is site-generic; the data is
per-site. This is the same rule `SpacePlanView` already states in its header, and
`test/device-ids-in-frontend.test.mjs` enforces it.

**Accessibility.** Click/tap and keyboard throughout, no drag anywhere, matching the decision
already taken and documented for placement.

**Failure is always toward showing less, never toward showing wrong.** A malformed shape renders a
square. Unparseable fixtures render none. An unplaced device is absent from the plan and named in
the tray. At no point does a bad value produce a confident-looking drawing of a building that does
not exist — the failure mode this whole feature is being built to remove.

## Verification

- **Pure modules exhaustively unit-tested** — `siteUi`, `roomShape`, `lightingGrid`. jsdom reports
  every SVG rect as 0×0, so geometry asserted through the DOM would assert nothing; the same
  reasoning that made `popoverPlacement` a pure module.
- **Component tests for the two honesty properties**: hiding a card leaves every control
  dispatching; a malformed shape renders the fallback rather than throwing.
- **Each new guard neutered and confirmed failing** before it is believed.
- **Browser verification at 375×812 and 1440×900** against the mock, as with the popovers.
- **Migrations rehearsed** with `supabase/rehearse.sh` before being applied by hand, and
  `test/migration-idempotency.test.mjs` must pass for both.

## Order and stopping points

A → B → C, each usable alone.

- After **A**, a site with a mismatched plan can hide it. Useful immediately; unblocks replication.
- After **B**, a room has its real outline and devices can be placed in something that looks like
  the office.
- After **C**, the lighting layout is data and the last hard-coded geometry can be deleted.

Stopping after A or B leaves a coherent system, not a half-built one.
