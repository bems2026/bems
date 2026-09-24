#!/usr/bin/env node
/**
 * Builds the "By symptom" table of `docs/91-troubleshooting-index.md` from every chapter's fault
 * table, and repeats the failure-mode figure verbatim.
 *
 *     node scripts/docs-troubleshooting.mjs      # rewrites the block between the GENERATED markers
 *
 * WHY GENERATED. The index would otherwise be a second copy of 74 rows that nobody keeps in step.
 * `scripts/docs-check.mjs` rebuilds it and fails when the file differs, so a chapter's new fault
 * row cannot be forgotten here.
 *
 * It also enforces R2: every fault row has all five columns filled. A row with an empty cell
 * stops the build rather than reaching the index.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
export const INDEX_FILE = '91-troubleshooting-index.md';
const BEGIN = '<!-- GENERATED';
const END = '<!-- /GENERATED -->';

/** [file, layer label, heading that owns the table, anchor of that heading] */
export const SOURCES = [
  ['01-field-devices.md', 'L1 Field devices', '## How it fails', 'how-it-fails'],
  ['01a-device-roles.md', 'L1 Device roles', '## 7. Troubleshooting', '7-troubleshooting'],
  ['02-network.md', 'L2 Network', '## How it fails', 'how-it-fails'],
  ['03-edge.md', 'L3 Edge', '## How it fails', 'how-it-fails'],
  ['04-data.md', 'L4 Data', '## How it fails', 'how-it-fails'],
  ['05-interface.md', 'L5 Interface', '## How it fails', 'how-it-fails'],
  ['X1-security.md', 'X1 Security', '## How it fails', 'how-it-fails'],
  ['X2-control-logic.md', 'X2 Control', '## How it fails', 'how-it-fails'],
  ['X3-operations.md', 'X3 Operations', '## How it fails', 'how-it-fails'],
  ['90-replication.md', 'Replication', '## How it fails', 'how-it-fails'],
];

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());

/** Every fault row, in chapter order. Throws on a missing table or a row with an empty cell. */
export function faultRows(docsDir) {
  const rows = [];
  for (const [file, layer, heading, anchor] of SOURCES) {
    const lines = readFileSync(join(docsDir, file), 'utf8').replace(/\r\n/g, '\n').split('\n');
    const start = lines.findIndex((l) => l.trim() === heading);
    if (start < 0) throw new Error(`${file}: heading "${heading}" not found`);
    const next = lines.findIndex((l, k) => k > start && /^## /.test(l));
    let i = lines.findIndex((l, k) => k > start && /^\| Symptom \|/.test(l));
    if (i < 0 || (next > 0 && i > next)) throw new Error(`${file}: no Symptom table under "${heading}"`);
    const width = cells(lines[i]).length;
    let n = 0;
    for (i += 2; i < lines.length && lines[i].startsWith('|'); i++) {
      const c = cells(lines[i]);
      n++;
      if (c.length !== width || c.some((x) => x === '')) throw new Error(`${file}: fault row ${n} does not have ${width} filled columns (R2)`);
      rows.push({ symptom: c[0], layer, file, anchor });
    }
  }
  return rows;
}

/** The text between the markers, markers included. */
export function buildBlock(docsDir) {
  const rows = faultRows(docsDir);
  const figure = readFileSync(join(docsDir, 'diagrams', 'failure-modes.mmd'), 'utf8').replace(/\r\n/g, '\n').trim();
  const table = [
    '| Symptom | Layer or plane | Its five columns |',
    '|---|---|---|',
    ...rows.map((r) => {
      const label = `${r.file.split('-')[0]} · ${r.anchor === 'how-it-fails' ? 'How it fails' : 'Troubleshooting'}`;
      return `| ${r.symptom} | ${r.layer} | [${label}](${r.file}#${r.anchor}) |`;
    }),
  ].join('\n');
  return [
    `${BEGIN} from each chapter's fault table by scripts/docs-troubleshooting.mjs. Edit the chapter, then regenerate; never edit rows here. -->`,
    '',
    `${rows.length} symptoms from ${SOURCES.length} chapters. Find what you see, then follow the link: the chapter's row holds`,
    'the likely cause, the check that tells the causes apart, the fix, and how to confirm it held.',
    '',
    table,
    '',
    '## Where each hop fails',
    '',
    '**Figure 6, repeated from [03](03-edge.md#how-it-fails): what breaks at each hop, and what a person sees.**',
    '',
    '```mermaid',
    figure,
    '```',
    '',
    'Source: [`diagrams/failure-modes.mmd`](diagrams/failure-modes.mmd).',
    END,
  ].join('\n');
}

/** The current block in the index file, or null when the file or its markers are missing. */
export function currentBlock(docsDir) {
  let doc;
  try {
    doc = readFileSync(join(docsDir, INDEX_FILE), 'utf8').replace(/\r\n/g, '\n');
  } catch {
    return null;
  }
  const a = doc.indexOf(BEGIN);
  const b = doc.indexOf(END);
  return a < 0 || b < 0 ? null : doc.slice(a, b + END.length);
}

function write(docsDir) {
  const path = join(docsDir, INDEX_FILE);
  const raw = readFileSync(path, 'utf8');
  const nl = raw.includes('\r\n') ? '\r\n' : '\n';
  const doc = raw.replace(/\r\n/g, '\n');
  const a = doc.indexOf(BEGIN);
  const b = doc.indexOf(END);
  if (a < 0 || b < 0) throw new Error(`${INDEX_FILE}: the GENERATED markers are missing`);
  const block = buildBlock(docsDir);
  writeFileSync(path, (doc.slice(0, a) + block + doc.slice(b + END.length)).replace(/\n/g, nl));
  return faultRows(docsDir).length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(`docs-troubleshooting: wrote ${write(join(REPO, 'docs'))} rows`);
}
