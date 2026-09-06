## What this changes, and why

<!-- The behaviour, not the diff. If it fixes a fault, say what the fault actually was —
     this project's history is mostly wrong diagnoses that looked right. -->

## Evidence

<!-- What you ran, where, and what it said. A green suite is not proof that a fix works: a
     change has shipped green here and changed nothing in the building, more than once. If it
     touches the deployment, say whether you read the live system back. -->

- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm test`
- [ ] `npm run test:bridge`
- [ ] `npm run test:server` *(not on the Pi — it writes under `server/data/`, which holds the live audit queue)*

## Checklist

- [ ] **`ROADMAP.md` updated in this change** — ticked items moved to §1 with their evidence path, new items added, entries for deleted code removed. Non-negotiable for a feature, a significant fix, an architecture change, or a deletion.
- [ ] No token, key, password, hostname, IP address, or project identifier anywhere in the diff or the commit messages. **This repository is public.**
- [ ] `bridge-flow.json` was not hand-edited. If `shared/` changed, `npm run build:flow` was re-run.
- [ ] Colour changes use existing tokens from `src/index.css`, and were checked in **both** themes.

## Deploying this

<!-- Deploying is two separate acts and neither is implied by merging. `server/` and `shared/`
     need the daemons restarted; `src/` needs a build, because the kiosk is served from ./dist.
     Say which this needs, or "neither". -->
