#!/usr/bin/env node
/**
 * Checks that the manual's cross-references have not drifted.
 *
 *     node scripts/docs-check.mjs                # checks this repository
 *     node scripts/docs-check.mjs --root <dir>   # checks another tree (the tests use this)
 *
 * FOUR CHECKS, each of which failed at least once while the manual was written:
 *   1. Figures: every `docs/diagrams/*.mmd` appears verbatim as a mermaid block in some page. The
 *      `.mmd` file is the source; a page that embeds an edited copy is drift.
 *   2. Evidence: every `E-NNN` a page cites is defined in `docs/audit/evidence-ledger.md`, and a
 *      page with an `evidence:` front-matter list names every ID it cites.
 *   3. Links: every relative link reaches a file that exists, and every `#anchor` matches a
 *      heading under BOTH GitHub's slug rules and the site build's. They differ where a heading
 *      holds an em dash (GitHub keeps a double hyphen, the site build collapses it), so a linked
 *      heading must slug the same way in both.
 *   4. The troubleshooting index matches what `scripts/docs-troubleshooting.mjs` would generate.
 *
 * `docs/audit/raw/` is skipped: it is ignored by git and never reaches a clone.
 * No dependencies, like the rest of `scripts/`.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBlock, currentBlock, INDEX_FILE } from './docs-troubleshooting.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const i = process.argv.indexOf('--root');
const ROOT = i > 0 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : REPO;
const DOCS = join(ROOT, 'docs');

const problems = [];
const fail = (file, line, msg) => problems.push(`${relative(ROOT, file).split('\\').join('/')}${line ? `:${line}` : ''}: ${msg}`);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = relative(DOCS, path).split('\\').join('/');
    if (rel === 'audit/raw' || rel.startsWith('audit/raw/') || name.startsWith('.')) continue;
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const pages = [...walk(DOCS)].filter((p) => p.endsWith('.md'));
const text = new Map(pages.map((p) => [p, read(p)]));

/** Lines outside fenced code blocks, with their 1-based numbers. */
function proseLines(src) {
  const out = [];
  let fenced = false;
  src.split('\n').forEach((line, n) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (!fenced) out.push([line, n + 1]);
  });
  return out;
}

// --- 1. Figures ---------------------------------------------------------------------------------
const blocks = [...text.values()].flatMap((src) => [...src.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1].trim()));
const diagramDir = join(DOCS, 'diagrams');
if (existsSync(diagramDir)) {
  for (const name of readdirSync(diagramDir).filter((n) => n.endsWith('.mmd'))) {
    const source = read(join(diagramDir, name)).trim();
    if (!blocks.includes(source)) fail(join(diagramDir, name), 0, 'not embedded verbatim in any page');
  }
}

// --- 2. Evidence --------------------------------------------------------------------------------
const ledgerPath = join(DOCS, 'audit', 'evidence-ledger.md');
const defined = existsSync(ledgerPath) ? new Set([...read(ledgerPath).matchAll(/^\| (E-\d{3}) \|/gm)].map((m) => m[1])) : new Set();
for (const [path, src] of text) {
  // The ledger defines the IDs rather than citing them, so only the "is it defined" half applies to it.
  const isLedger = path === ledgerPath;
  const fm = src.startsWith('---\n') ? src.slice(4, src.indexOf('\n---', 4)) : '';
  const listLine = fm.match(/^evidence:\s*\[(.*)\]\s*$/m);
  const listed = new Set(listLine ? listLine[1].split(/,\s*/).filter(Boolean) : []);
  const body = src.slice(fm ? fm.length + 8 : 0);
  const seen = new Set();
  body.split('\n').forEach((line, n) => {
    for (const [id] of line.matchAll(/E-\d{3}/g)) {
      if (seen.has(id)) continue;
      seen.add(id);
      // `body` starts on the closing `---` line, so its line 0 is the file's line fmLines + 2.
      const lineNo = fm ? fm.split('\n').length + 2 + n : n + 1;
      if (!defined.has(id)) fail(path, lineNo, `${id} is not in the ledger`);
      else if (listLine && !isLedger && !listed.has(id)) fail(path, lineNo, `${id} is cited but missing from the front matter's evidence list`);
    }
  });
}

// --- 3. Links and anchors -----------------------------------------------------------------------
const headingText = (h) =>
  h
    .replace(/^#+\s*/, '')
    .replace(/\s+#+\s*$/, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*]/g, '')
    .trim();
/** github-slugger's rule: lower-case, drop punctuation except hyphen and underscore, spaces to hyphens. */
const githubSlug = (h) => headingText(h).toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
/** Python-Markdown's default toc slugify, which the site build uses. */
const siteSlug = (h) =>
  headingText(h)
    .normalize('NFKD')
    .replace(/[^\p{ASCII}]/gu, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '-');

const anchorCache = new Map();
function anchorsOf(path) {
  if (!anchorCache.has(path)) {
    const heads = proseLines(read(path)).map(([l]) => l).filter((l) => /^#{1,6} /.test(l));
    anchorCache.set(path, { github: new Set(heads.map(githubSlug)), site: new Set(heads.map(siteSlug)) });
  }
  return anchorCache.get(path);
}

for (const [path, src] of text) {
  for (const [line, n] of proseLines(src)) {
    for (const [, target] of line.replace(/`[^`]*`/g, '').matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:)/.test(target)) continue;
      const [file, anchor] = target.split('#');
      const dest = file ? resolve(dirname(path), file) : path;
      if (!existsSync(dest)) {
        fail(path, n, `link to ${file}: the file is missing`);
        continue;
      }
      if (!anchor || statSync(dest).isDirectory() || !dest.endsWith('.md')) continue;
      const { github, site } = anchorsOf(dest);
      if (!github.has(anchor) || !site.has(anchor)) {
        const where = !github.has(anchor) && !site.has(anchor) ? 'no heading has it' : !site.has(anchor) ? 'it does not resolve in the site build' : 'it does not resolve on GitHub';
        fail(path, n, `anchor #${anchor} in ${file || 'this page'}: ${where}`);
      }
    }
  }
}

// --- 4. The troubleshooting index ---------------------------------------------------------------
if (existsSync(join(DOCS, INDEX_FILE))) {
  try {
    const current = currentBlock(DOCS);
    if (current === null) fail(join(DOCS, INDEX_FILE), 0, 'the GENERATED markers are missing');
    else if (current !== buildBlock(DOCS)) fail(join(DOCS, INDEX_FILE), 0, 'out of date: run `node scripts/docs-troubleshooting.mjs`');
  } catch (err) {
    fail(join(DOCS, INDEX_FILE), 0, `cannot be generated: ${err.message}`);
  }
}

for (const p of problems) console.log(p);
console.log(`docs-check: ${pages.length} page(s), ${problems.length} problem(s)`);
process.exitCode = problems.length ? 1 : 0;
