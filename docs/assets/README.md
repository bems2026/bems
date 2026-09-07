# README assets

Every image on the front page is generated. Nothing here was drawn by hand, and nothing here
photographs a real building.

| File | Made by | Source |
|---|---|---|
| `hero-{light,dark}.png` | `render.mjs` | `src/hero.html` |
| `architecture-{light,dark}.png` | `render.mjs` | `src/architecture.html` |
| `social-preview.png` | `render.mjs` | `src/social.html` |
| `shot-{overview,analytics,control,devices,automation}.png` | `capture.mjs` | the app itself, running the demo building |
| `demo-site/` | you, if you want to change it | a building that does not exist |

## Regenerating the illustrations

```bash
node docs/assets/render.mjs              # all of them
node docs/assets/render.mjs hero         # or just one
```

Headless Chromium renders `src/*.html` at 1.5x. The templates use the app's own tokens (copied
into `src/tokens.css`) and its own fonts, loaded straight out of `node_modules`, so the pictures
look like the product. Each template is opened twice — plain, and with `?theme=dark` — and
`src/theme.js` is the only thing that tells them apart. The README pairs them in a `<picture>`,
so the page follows the reader's theme.

`social-preview.png` is not referenced by the README. It is uploaded by hand, once, in
**Settings → General → Social preview**, and it is what appears when someone pastes the repo
link into a chat or a proposal.

## Regenerating the screenshots

```bash
node docs/assets/capture.mjs             # all five
node docs/assets/capture.mjs control     # or one page
```

One command, no servers to start first. It is worth knowing what it does, because four of those
things are load-bearing.

### It screenshots a building that does not exist

`demo-site/` is a complete, coherent site definition — thirteen devices, three metered phases,
an electrical tree — for a building called **Demo Building** in **Demo City**. iBEMS is a
framework: whichever building *this* checkout is deployed in is an accident of deployment, and a
front page showing that building's name, circuits and rooms would be advertising one office
instead of the framework.

It doubles as a worked example. `npm run site:new` scaffolds the same three files **empty**,
because it will not invent facts about a building it has never seen. This is what they look like
once somebody has filled them in — and `capture.mjs` runs the framework's own `site:check`
against it before taking a single picture, so the example cannot quietly rot.

### It never writes to your working tree

Choosing a site is a build-time fact: `shared/siteConfig.mjs` is a static re-export, deliberately,
because a browser bundle has no `process.env`. Pointing it at the demo building therefore means
editing a tracked file — and on a machine that is also serving a live kiosk out of `dist/`, a
script that rewrites `shared/` even for ninety seconds is a script that can take a building's
dashboard off its own site.

So the swap happens inside a throwaway `git worktree` checked out from `HEAD`, with
`node_modules` symlinked in rather than reinstalled. Nothing in your tree is written to, at any
point, including on a crash. `git status` should be identical before and after.

### It moves the clock, and moves it in two places

The mock's occupancy curve reads `new Date().getHours()`, so a run started at night simulates an
empty building and every screenshot shows an idle one. The capture picks the `Etc/GMT±N` zone
that puts *this instant* at about 10:15, runs the mock in it, **and rewrites the demo site's own
timezone and offset to match** — so the fixture's working day, the chart's time axis and the
clock in the corner of the shot all agree.

Doing only the first of those is what an earlier version did, and it produced screenshots of a
building that was busy at two in the morning. (`Etc/GMT+N` is UTC *minus* N. The POSIX sign is
inverted from the one everybody expects, and getting it backwards puts the fixture twenty hours
from where you asked.)

### Nothing real is in frame

- Every reading comes from `mock-bridge/fixturePlan.mjs` driving `demo-site/`. No real
  measurement, no address, no credential.
- The build forces `VITE_SUPABASE_*` empty, so the bundle names no database project and the app
  runs unauthenticated — the login gate only exists when Supabase is configured. Building
  without that override picks up the repository's own `.env`, and the first attempt at these
  screenshots produced a login screen with a real project's credentials compiled into it. The
  capture now refuses to shoot a bundle that names a project.
- `--dispatch=switch` reproduces a partly-open dispatch gate, so the Control page shows its
  honest "not dispatched" badges rather than implying every class is live.

### Two browser facts it cost an hour each to learn

**It is Firefox, not Chromium.** Headless Chromium on this hardware never completes an HTTP
navigation: the request goes out, no response ever arrives, and `Page.navigate` hangs — on any
local server, at every flag combination worth trying, while `file://` renders fine. Measured
over the DevTools protocol. Firefox loads the same URL in under a second. That is the whole
reason `render.mjs` (all `file://`) and `capture.mjs` use different browsers; do not
"simplify" them onto one.

**An invisible image is what makes the data appear.** `firefox --screenshot` fires on the page's
`load` event, about a second before the first bridge payload arrives — the first working attempt
was a perfectly rendered fleet table reading `0 online` and `NO DATA` in every row. The server
injects a 1x1 image whose response is held for `CAPTURE_HOLD_MS` (9 s). An image delays `load`
without blocking parsing or script execution, so the app boots, the socket delivers, the charts
animate, and only then does the shutter fall.

## Knobs

| Variable | Default | |
|---|---|---|
| `CAPTURE_HOUR` | `10.25` | The hour of the fixture's day to freeze at. |
| `CAPTURE_HOLD_MS` | `9000` | How long `load` is held open before the shot. |
| `CAPTURE_PORT` | `5199` | Where the built app is served, on loopback only. |
| `CAPTURE_MOCK_PORT` | `1881` | Not 1880: that is Node-RED on a deployed Pi. |

## Weight

These are the only binary files in the repository, so they are kept deliberately small:
illustrations rendered at 1.5x rather than 2x, screenshots taken at the viewport rather than the
full scroll height, and a page given a taller window only where the interesting part is below
the fold. That comes to **about 2 MB for ten images**. Run `du -sh docs/assets` after any
regeneration, and if it has grown noticeably, find out why before committing it.
