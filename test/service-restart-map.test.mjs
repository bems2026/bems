/**
 * A document that says which services to restart after a code change names the services that
 * code actually runs in.
 *
 * WHY THIS EXISTS. CLAUDE.md said `server/` and `shared/` changes need
 * `sudo systemctl restart ibems-proxy ibems-scheduler`. But `server/ingest.mjs` imports
 * `server/reports.mjs`, `server/retention.mjs` and the whole of `shared/registry.mjs`, and it runs
 * as `ibems-ingest` — so following the note left the ingest daemon on the code it started with.
 * Nothing reports that. Node loads a module once, and a daemon on old code keeps running, answers
 * `active`, and writes rows.
 *
 * WHY IT READS THE SOURCE. The list was hand-kept, and it drifted the way hand-kept lists here do
 * (RM-075's backup table list is the precedent). So this derives the answer the way the machine
 * does: each unit's `ExecStart` names an entry module, and everything that module imports,
 * directly or not, is loaded into that process. Then it asks the documents whether they agree.
 *
 * THE SCANNER MUST READ MULTI-LINE IMPORTS. `ingest.mjs` imports `retention.mjs` across seven
 * lines. A line-based grep for `import … from` — the obvious first version, and the one actually
 * used while this was being written — finds `reports.mjs` and misses `retention.mjs` entirely,
 * which is the very module the note forgot. The self-test below pins that form.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRIEF = 'docs/pi-session-brief.md';

/**
 * Documents carrying the deploy note, and whether each must name the restart command. A
 * paragraph is a deploy note if it says Node loads a module once; CONTRIBUTING.md's short form
 * says so without a command, and is checked only if it ever gains one.
 */
const DEPLOY_NOTE_DOCS = { 'CLAUDE.md': true, 'CONTRIBUTING.md': false, [BRIEF]: true };
// Whitespace, not spaces: the brief wraps "Node loads a" / "module once" across two lines, and the
// first version of this pattern therefore reported the brief's deploy note as missing.
const DEPLOY_NOTE = /loads\s+a\s+module\s+once/;

const toRepoPath = (abs) => relative(ROOT, abs).split(sep).join('/');
const backticked = (text) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

/**
 * Specifiers a module loads at runtime: `import … from`, `export … from`, a bare `import '…'`,
 * and `import('…')` with a literal argument — a dynamic import is cached exactly like a static
 * one, so a daemon that has taken one is just as stale.
 *
 * Anchored to the start of a line, which is what keeps prose out: this codebase's comments quote
 * imports constantly, always behind ` * ` or `//`. A JSDoc type (`{import('./x.mjs').T}`) loads
 * nothing, and is excluded by the same rule.
 *
 * The clause before `from` may span lines and may hold a comment with an apostrophe in it; it may
 * not hold a `;`, which no import clause does.
 */
const STATIC_IMPORT = /^[ \t]*(?:import|export)\b[^;]*?\bfrom[ \t]*['"]([^'"\n]+)['"]/gm;
const BARE_IMPORT = /^[ \t]*import[ \t]*['"]([^'"\n]+)['"]/gm;
const DYNAMIC_IMPORT = /^(?![ \t]*(?:\*|\/\/|\/\*)).*?(?<![\w.{])import\([ \t]*['"]([^'"\n]+)['"][ \t]*\)/gm;

function specifiers(src) {
  return [STATIC_IMPORT, BARE_IMPORT, DYNAMIC_IMPORT].flatMap((re) => [...src.matchAll(re)].map((m) => m[1]));
}

/**
 * Units that run a long-lived Node process from this repository, mapped to their entry module.
 *
 * A oneshot is left out on purpose: `ibems-wifi-prefer` starts a fresh process each time its timer
 * fires, so it always runs the code on disk and there is nothing to restart. A unit whose
 * `ExecStart` is not node (`serve` for the dashboard, `chromium` for the kiosk) loads no module
 * from here at all.
 */
function nodeDaemons() {
  const daemons = new Map();
  const units = readdirSync(join(ROOT, 'server')).filter((f) => f.endsWith('.service')).sort();
  for (const unit of units) {
    const text = readFileSync(join(ROOT, 'server', unit), 'utf8');
    const exec = text.match(/^ExecStart=(.*)$/m);
    if (!exec) continue;
    const [binary, ...args] = exec[1].trim().split(/\s+/);
    if (!/(?:^|\/)node$/.test(binary.replace(/^[-@:+!]+/, ''))) continue;
    if ((text.match(/^Type=(\S+)/m)?.[1] ?? 'simple') === 'oneshot') continue;
    const entry = args.find((a) => a.endsWith('.mjs'));
    assert.ok(entry, `${unit} runs node but names no .mjs entry module`);
    daemons.set(unit.replace(/\.service$/, ''), entry);
  }
  return daemons;
}

/** Every repository module the entry module loads, itself included, as repo-relative paths. */
function modulesLoadedBy(entry) {
  const seen = new Set();
  const pending = [resolve(ROOT, entry)];
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of specifiers(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('node:')) continue;
      // Server and bridge code has no dependencies. A specifier that is neither a builtin nor a
      // relative path is a module this map cannot see into, so it is a failure, not a skip.
      assert.ok(spec.startsWith('.'), `${toRepoPath(file)} imports '${spec}', which this map cannot follow`);
      const target = resolve(dirname(file), spec);
      assert.ok(existsSync(target), `${toRepoPath(file)} imports '${spec}', which does not exist`);
      pending.push(target);
    }
  }
  return [...seen].map(toRepoPath);
}

/** module -> the sorted daemons that load it, derived from the units and their imports. */
function derivedMap() {
  const map = new Map();
  for (const [daemon, entry] of nodeDaemons()) {
    for (const mod of modulesLoadedBy(entry)) map.set(mod, [...(map.get(mod) ?? []), daemon].sort());
  }
  return map;
}

/**
 * module -> daemons, as the brief states it: the table whose header's first cell is `Restart`.
 * Each row names its services and its modules in backticks; prose around them is allowed.
 */
function documentedMap() {
  const lines = readFileSync(join(ROOT, BRIEF), 'utf8').split(/\r?\n/);
  const header = lines.findIndex((l) => /^\|\s*Restart\s*\|/.test(l));
  assert.ok(header !== -1, `${BRIEF} has no restart map (a table headed "| Restart |")`);
  const map = new Map();
  for (const row of lines.slice(header + 2)) {
    if (!row.startsWith('|')) break;
    const [servicesCell = '', modulesCell = ''] = row.split('|').slice(1, 3);
    const services = backticked(servicesCell).filter((t) => /^ibems-[\w-]+$/.test(t)).sort();
    const modules = backticked(modulesCell).filter((t) => /^[\w-]+\/[\w./-]+\.mjs$/.test(t));
    assert.ok(services.length > 0 && modules.length > 0, `restart map row names no service or no module: ${row}`);
    for (const mod of modules) {
      assert.ok(!map.has(mod), `${mod} appears in more than one row of the restart map`);
      map.set(mod, services);
    }
  }
  return map;
}

test('the scanner reads the import forms this codebase uses, and not the ones it only mentions', () => {
  const sample = [
    "import path from 'node:path';",
    "import { a } from './static.mjs';",
    'import {',
    "  b, // a comment that doesn't end the clause",
    '  c,',
    "} from './multiline.mjs';",
    "export { d } from './reexport.mjs';",
    "export * from './star.mjs';",
    "import './side-effect.mjs';",
    "const { e } = await import('./dynamic.mjs');",
    "/** @typedef {import('./jsdoc-type.mjs').T} T */",
    " * `import { f } from './quoted-in-prose.mjs'` is how a comment mentions one.",
    "// import { g } from './commented-out.mjs';",
    "export const FROM = 'from';",
    "export function load() { return 'x'; }",
  ].join('\n');
  assert.deepEqual(
    specifiers(sample).sort(),
    ['./dynamic.mjs', './multiline.mjs', './reexport.mjs', './side-effect.mjs', './star.mjs', './static.mjs', 'node:path'],
  );
});

test('the unit files read as they were read by hand', () => {
  // Pinned so a parser that finds nothing cannot make the agreement tests pass vacuously.
  const daemons = nodeDaemons();
  assert.equal(daemons.get('ibems-ingest'), 'server/ingest.mjs');
  assert.equal(daemons.get('ibems-proxy'), 'server/proxy.mjs');
  assert.equal(daemons.get('ibems-scheduler'), 'server/scheduler.mjs');
  assert.ok(!daemons.has('ibems-wifi-prefer'), 'a oneshot runs fresh code every time and has nothing to restart');
  assert.ok(!daemons.has('ibems-dashboard'), 'the dashboard runs serve, not node');
  assert.ok(!daemons.has('ibems-kiosk'), 'the kiosk runs chromium, not node');

  // And the case that started this: ingest loads the report and retention runners, the second
  // of them through a seven-line import.
  const ingest = modulesLoadedBy('server/ingest.mjs');
  assert.ok(ingest.includes('server/reports.mjs'));
  assert.ok(ingest.includes('server/retention.mjs'));
});

test("every module a daemon loads is in the brief's restart map, under exactly the daemons that load it", () => {
  const derived = derivedMap();
  const documented = documentedMap();
  const disagreements = [];
  for (const [mod, daemons] of derived) {
    const stated = documented.get(mod);
    if (!stated) disagreements.push(`${mod} is loaded by ${daemons.join(', ')} and missing from the map`);
    else if (stated.join() !== daemons.join()) {
      disagreements.push(`${mod} is loaded by ${daemons.join(', ')}; the map says ${stated.join(', ')}`);
    }
  }
  for (const mod of documented.keys()) {
    if (!derived.has(mod)) disagreements.push(`${mod} is in the map, but no daemon loads it`);
  }
  assert.deepEqual(
    disagreements,
    [],
    `Correct the restart map in ${BRIEF}. It is derived from each server/*.service ExecStart and ` +
      'the imports beneath it; a service that loads a module keeps the old copy until restarted.',
  );
});

test('the restart command beside each deploy note names every Node daemon', () => {
  const daemons = [...nodeDaemons().keys()].sort();
  for (const [doc, mustName] of Object.entries(DEPLOY_NOTE_DOCS)) {
    const notes = readFileSync(join(ROOT, doc), 'utf8').split(/\r?\n[ \t]*\r?\n/).filter((p) => DEPLOY_NOTE.test(p));
    assert.ok(notes.length > 0, `${doc} no longer has a deploy note saying Node loads a module once`);
    const commands = notes.flatMap((p) => [...p.matchAll(/systemctl\s+restart((?:\s+ibems-[\w-]+)+)/g)]);
    if (mustName) assert.ok(commands.length > 0, `${doc}'s deploy note names no restart command`);
    for (const command of commands) {
      assert.deepEqual(
        command[1].trim().split(/\s+/).sort(),
        daemons,
        `${doc}: \`${command[0]}\` must name every service that runs node from this repository. ` +
          'Which of them a given change needs is the restart map in ' + BRIEF + '.',
      );
    }
  }
});
