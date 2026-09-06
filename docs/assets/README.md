# README assets

Every image on the front page is generated. Nothing here was drawn by hand, and nothing here
photographs the real building.

| File | Made by | Source |
|---|---|---|
| `hero-{light,dark}.png` | `render.mjs` | `src/hero.html` |
| `architecture-{light,dark}.png` | `render.mjs` | `src/architecture.html` |
| `social-preview.png` | `render.mjs` | `src/social.html` |
| `shot-{overview,analytics,control,devices,automation}.png` | `capture.mjs` | the app itself, against `npm run mock` |

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
# terminal 1 — the fake bridge. NOT port 1880: that is Node-RED on the Pi.
TZ=Etc/GMT+6 npm run mock -- --port=1881 --dispatch=switch
# terminal 2
node docs/assets/capture.mjs             # or: node docs/assets/capture.mjs control
```

`capture.mjs` builds the app itself into a temporary directory, serves it on loopback, and
drives Firefox. It does **not** reuse `dist/`, and the difference matters:

- **`VITE_SUPABASE_*` is forced empty.** Building without that override picks up the
  repository's own `.env`, and the first attempt at these screenshots produced a login screen
  with a real project's credentials compiled into the bundle. The app runs unauthenticated when
  Supabase is unconfigured, which is the state worth showing anyway. The script refuses to
  screenshot a bundle that names a Supabase project.
- **Everything in frame comes from `mock-bridge/fixturePlan.mjs`** — synthetic devices, synthetic
  power, seeded history. No real reading, no address, no credential.
- **`--dispatch=switch`** reproduces the live deployment's lights-only dispatch gate, so the
  Control page shows its honest "simulated" badges instead of implying every class is live.

Three things about it are worth knowing before you change it.

**`TZ=Etc/GMT+6` is not cosmetic.** The fixture's occupancy curve reads `new Date().getHours()`,
so a mock started at night simulates an empty building and every screenshot shows an idle
office. The shift puts the fixture's clock in mid-morning. It moves nothing else — which is why
the clock in the corner of a screenshot shows the capture machine's own time rather than
mid-morning. That mismatch is the price of the trade, and the alternative was worse.

**It is Firefox, not Chromium.** Headless Chromium on the Pi never completes an HTTP navigation:
the request goes out, no response ever arrives, and `Page.navigate` hangs — on any local server,
at any of the flag combinations worth trying, while `file://` renders fine. Measured over the
DevTools protocol. Firefox loads the same URL in under a second, which is the whole reason
`render.mjs` (all `file://`) and `capture.mjs` use different browsers.

**An invisible image is what makes the data appear.** `firefox --screenshot` fires on the page's
`load` event, about a second before the first bridge payload arrives — the first working
attempt produced a perfectly rendered fleet table reading `0 online` and `NO DATA` in every row.
So the server injects a 1x1 image whose response is held for `CAPTURE_HOLD_MS` (9 s). An image
delays `load` without blocking parsing or script execution, so the app boots normally, the
socket delivers, the charts animate, and only then does the shutter fall.

## Weight

These are the only binary files in the repository, so they are kept deliberately small:
illustrations rendered at 1.5x rather than 2x, screenshots taken at the viewport rather than the
full scroll height, and a page given a taller window only where the interesting part is below
the fold. That comes to **about 2.1 MB for ten images** — roughly 200 KB each. Run
`du -sh docs/assets` after any regeneration, and if it has grown noticeably, find out why before
committing it.
