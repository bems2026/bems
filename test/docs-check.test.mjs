/**
 * `scripts/docs-check.mjs` — the manual's cross-references must not drift.
 *
 * WHY THIS EXISTS. Every one of these failed at least once while the manual was being written,
 * and each was caught by hand:
 *   - A figure edited in its `.mmd` source but not in the chapter that embeds it.
 *   - An evidence ID cited in a chapter but missing from its front matter, or not defined in the
 *     ledger at all.
 *   - An in-page anchor that resolved on GitHub and not in the site build. GitHub keeps a double
 *     hyphen where it drops an em dash; the site build collapses it to one. A heading linked from
 *     elsewhere must slug the same way in both.
 *   - The troubleshooting index falling behind the chapters' fault tables.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = join(ROOT, 'scripts', 'docs-check.mjs');

const LEDGER = '# Ledger\n\n| ID | Claim |\n|---|---|\n| E-001 | One. |\n| E-002 | Two. |\n';
const FIGURE = 'flowchart LR\n  a --> b\n';
const page = (evidence, body) => `---\ntitle: P\nevidence: [${evidence.join(', ')}]\n---\n\n# P\n\n${body}\n`;

function check(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docs-check-'));
  try {
    const all = {
      'docs/audit/evidence-ledger.md': LEDGER,
      'docs/diagrams/fig.mmd': FIGURE,
      'docs/a.md': page(['E-001'], `See [b](b.md#the-part) [E-001].\n\n\`\`\`mermaid\n${FIGURE}\`\`\``),
      'docs/b.md': page([], '## The part\n\nText.'),
      'README.md': '# Root\n',
      ...files,
    };
    for (const [name, body] of Object.entries(all)) {
      if (body === null) continue;
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), body);
    }
    const r = spawnSync(process.execPath, [CHECKER, '--root', dir], { encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a consistent tree passes', () => {
  const r = check({});
  assert.equal(r.code, 0, r.out);
});

test('a figure source not embedded verbatim fails', () => {
  const r = check({ 'docs/diagrams/fig.mmd': 'flowchart LR\n  a --> c\n' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /fig\.mmd.*not embedded/);
});

test('an evidence ID the ledger does not define fails', () => {
  const r = check({ 'docs/b.md': page(['E-009'], '## The part\n\nClaim [E-009].') });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /b\.md.*E-009.*not in the ledger/);
});

test('an evidence ID cited but missing from front matter fails', () => {
  const r = check({ 'docs/b.md': page([], '## The part\n\nClaim [E-002].') });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /b\.md.*E-002.*front matter/);
});

test('a link to a missing file fails', () => {
  const r = check({ 'docs/b.md': page([], '## The part\n\n[gone](gone.md).') });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /b\.md.*gone\.md.*missing/);
});

test('a link to a missing anchor fails', () => {
  const r = check({ 'docs/b.md': page([], '## The part\n\n[x](a.md#nowhere).') });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /nowhere/);
});

test('an anchor that resolves on GitHub but not in the site build fails', () => {
  const r = check({
    'docs/a.md': page(['E-001'], `See [b](b.md#the--part) [E-001].\n\n\`\`\`mermaid\n${FIGURE}\`\`\``),
    'docs/b.md': page([], '## The — part\n\nText.'),
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /the--part/);
});

test('a link out of the manual to a file that exists passes', () => {
  const r = check({ 'docs/b.md': page([], '## The part\n\n[root](../README.md).') });
  assert.equal(r.code, 0, r.out);
});

test('the manual as committed passes', () => {
  const r = spawnSync(process.execPath, [CHECKER], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
});
