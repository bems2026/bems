# Standing up iBEMS in another building — the software half

**Status, 2026-08-31.** Steps 1–7 and 10 below were **executed** against throwaway sites
scaffolded for the purpose, and what they found is written into them. Steps 8 and 9 were **not**:
no second Supabase project was created, and no space tree was built for a new site. Those two are
described from reading the code, and are marked where they appear.

That distinction is the point of this document. It is a transcript, not a design, and a step
nobody has walked is worth less than one somebody has — so it says which is which. The hardware
and packaging half is **not** covered at all: see
[What this does not cover](#what-this-does-not-cover).

This is Milestone 6's software track (`ROADMAP.md` RM-033). The funded plan's third component is
*"a practical step-by-step framework that enables other SUCs to replicate and implement the
iBEMS"*, and this is the part of that framework which is real today.

---

## What a "site" is here

One building, one Raspberry Pi, one Supabase project. The code carries a **site id** through the
database (`sites`, and a `site_id` on every table that used to assume one building), so a shared
cloud later is a configuration change rather than a second migration — but nothing today requires
one, and one Pi per building is the tested arrangement.

Everything that varies between buildings lives in **one directory**:

```
shared/sites/<slug>/
  site.mjs      identity, timezone, policy, which 3D pack (if any)
  devices.mjs   the hardware on this building's walls
  circuits.mjs  the electrical tree — panels, branch circuits, which meter is on which phase
```

and **one pointer**, `shared/siteConfig.mjs`, which says which of those directories this
deployment is. That claim is enforced, not merely written down: `test/site-config.test.mjs` fails
if any production module outside `siteConfig.mjs` and `shared/sites/` so much as mentions a site
directory name. It has already caught two things — a stray `CIRCUITS` import, and a usage
example in a script.

---

## 1. Scaffold the directory

```bash
npm run site:new -- your-building-slug
```

Lowercase letters, digits and single hyphens. The slug becomes a directory name, an ES module
path and a database primary key, so it is validated before anything is created.

It writes the three files and **stops**. It does not point the deployment at the new site,
because doing that silently would take a *running* building offline — every device id in the live
flow would stop resolving, from a command that sounds purely additive. It prints the three lines
to change and leaves them to you.

The template contains no invented facts. Devices and circuits start **empty**: an example device
is one the dashboard reports as offline forever, and an example circuit puts a meter into a phase
total that has no meter. The timezone starts at `UTC` — a placeholder that is also true, rather
than another building's timezone copied across and left to be believed.

## 2. Fill in `site.mjs`

Every `TODO` in it is a fact about a real building that the template cannot know.

The one to be careful with is the timezone, which is carried **twice** — as an IANA zone and as a
fixed offset in minutes. That is deliberate: the payload transform runs inside a Node-RED function
node with no imports and no guarantee of a full-ICU build, so it needs a plain number.
`test/site-config.test.mjs` measures the zone at two instants six months apart and fails if the
two disagree.

**A building in a DST-observing zone cannot describe itself honestly with a fixed offset.** That
test is where it will find out, and the fix is a code change rather than a configuration one. No
site has needed it yet.

## 3. Describe the hardware

Two ways, and they are not equivalent:

- **The Devices page's "Add device" wizard** is the normal path. It writes
  `shared/registry.enrolled.mjs` and needs the Tuya cloud credentials for the account the devices
  are paired to.
- **By hand in `devices.mjs`**, for hardware that must exist before the app can usefully run.

Each device carries what every other layer reads off it — an outlet its socket keys, a switch its
state key, a meter its context prefix — so nothing else needs editing when the list changes.

## 4. Describe the electrical tree

`circuits.mjs` is the panel: service entrance, sub-panels, branch circuits, and which meter sits
on which phase. `PHASE_MAP` is **derived** from it (`shared/circuits.mjs`), never declared.

An empty tree derives to empty phase lists, and the dashboard then reports every phase as **not
metered** — never as zero. That is the honest state of a building nobody has surveyed, and it is
the same rule the rest of the system follows: a figure nobody measured is a dash, not a number.

This tree is deliberately **independent** of the space tree. Where a device *is* and what it is
*wired to* are different questions, and one circuit commonly crosses several rooms.

## 5. Point the deployment at it

Three lines in `shared/siteConfig.mjs`, which `site:new` prints for you.

## 6. Regenerate the bridge flow

```bash
npm run build:flow
```

The generated Node-RED flow follows the site — verified: pointing a deployment at a two-device
site produced a flow with two devices and **zero** references to the original building's device
ids.

## 7. Run it with no hardware at all

```bash
npm run mock     # a contract-identical fake bridge on :1880
npm run dev      # the dashboard on :5183
```

This is the step worth doing early, because it is the whole system minus the building. Until
2026-08-28 it **crashed** for any site but the original one; that is fixed, and
`test/mock-fixture-plan.test.mjs` exists so it stays fixed.

## 8. The database *(not executed — described from the code)*

Create a Supabase project for this deployment and apply `supabase/*.sql` **in filename order**,
by hand, in the SQL editor. Rehearse first if you are changing any of them:

```bash
./supabase/rehearse.sh    # every migration against PostgreSQL 16 in a throwaway container
```

**`phase19_sites.sql` seeds a `sites` row with a literal id, and `phase20_site_scoping.sql`
backfills three tables with the same literal.** Both need editing for a new building. This is a
known rough edge, not a design: see RM-033's open items.

## 9. Build the space tree *(not executed for a new site)*

In the app: **Devices → Spaces**. Add the building, its floors and its rooms, then place each
device into one. Nothing below is available until this exists, and all of it arrives at once:

- per-space energy totals (Analytics → *By space*);
- the data-driven floor plan, including positioning devices within a room;
- honest location labels everywhere a device is named.

## 10. Expect the test suites to fail, and know why

Run them:

```bash
npm test && npm run test:bridge && npm run test:server
```

On a brand-new site, measured on 2026-08-31 against a scaffolded empty one:

| Suite | Result on a new site |
|---|---|
| frontend (`npm test`) | 746 / 747 — effectively site-agnostic |
| bridge (`npm run test:bridge`) | 414 / 482 — **68 failures** |
| server (`npm run test:server`) | 329 / 359 — **30 failures** |

**This is expected, and it is not a sign you have broken something.** These suites are the CARE
office's *regression* suite, not a conformance suite: they assert that *this* building's seven
outlets round-trip a command, that *this* panel derives to *these* four meters. Pointed at
another building they fail because the fixtures name hardware you do not have. A sampled failure
reads `Cannot use 'in' operator to search for 'voltage' in undefined` — a fixture looking up a
device id that is not yours.

Two consequences worth being clear-eyed about:

- **The failures are noise for you, so do not chase them.** The parts that must be
  site-independent are guarded separately and *do* pass on any site:
  `test/site-config.test.mjs`, `test/site-naming.test.mjs`, `test/mock-fixture-plan.test.mjs`
  and `test/site-new.test.mjs`.
- **For your own site, run `npm run site:check` instead.** It is the conformance check the
  suites above are not:

  ```bash
  npm run site:check
  ```

  It knows nothing about any particular building and everything about what a coherent site looks
  like. **A freshly scaffolded site passes it** — empty is a warning, wrong is an error, because
  a check that goes red on day one is one people learn to skip. It exits 1 only on a real fault.

  The faults it exists for are the quiet ones. A circuit naming a meter that does not exist does
  not crash: `PHASE_MAP` is derived from that tree, so the phase total silently omits a meter and
  nothing on screen looks wrong. Two devices sharing a context prefix overwrite each other in the
  flow's context store, and the dashboard shows one of them twice without saying so. Demonstrated
  on 2026-08-31 against a site seeded with `mtr_lightning` for `mtr_lighting` and two switches on
  one state key — both reported by name, exit 1.

---

## What this does not cover

Stated plainly, because a replication framework that is quiet about its gaps is worse than a
short one.

| Not covered | Why |
|---|---|
| **Physical installation** — CT clamps on a live panel, relay modules, the IR blaster | [`physical-install.md`](./physical-install.md) is a **template with 12 marked gaps**, not a finished guide: the structure and the traps are written, the photographs, part numbers and torque figures are not. Nothing in it has been reviewed by an electrician. |
| **Packaging** | Decided and built: `scripts/install.sh`, dry-run by default. **Its apply path has never been run end to end** — there has only ever been one Pi — so the first real install is also its first test. Run the check first and read the plan. |
| **Day-one network setup** — joining the Pi and the devices to a 2.4 GHz segment, linking the vendor account | Partly written down in `CLAUDE.md`'s site facts, not yet a procedure. |
| **A second building's `sites` row** | Step 8 above: still a hand-edit of two migration files. |
| **A 3D scene pack** | Site-specific by nature. A site with `scene_pack: null` gets the data-driven floor plan, which is the intended default. |
| **The Control page's outlet plan** | Still pins one building's outlet positions (`ROADMAP.md` FI-016). Every other screen is data-driven. |
| ~~A conformance suite for your own site~~ | **Built** — `npm run site:check`, step 10. |

## Traps this project has already paid for

Not exhaustive — `CLAUDE.md`'s "site facts worth never re-deriving" is the full list, and it is
worth reading before the first install rather than after the first outage. The three that cost
the most:

- **The Tuya devices are 2.4 GHz-only, and the Pi must share that segment.** On a 5 GHz SSID the
  Pi keeps working internet and remote access while every device reads `online: false` — which
  looks exactly like a code fault and is not one.
- **A device that looks unreachable may be a stuck Node-RED node.** Restart Node-RED before
  suspecting hardware. Once, this cost a day of believing a range problem that did not exist.
- **A green test suite is not proof.** Twice a fix here shipped green and changed nothing on the
  building. Read the live system back.
