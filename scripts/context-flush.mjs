#!/usr/bin/env node
/**
 * Node-RED saves its context every 5 minutes, not every 30 seconds — RM-148, Stage 6. Run on the edge.
 *
 *     npm run context-flush:pi              # dry run: the line as it is and as it would be
 *     npm run context-flush:pi -- --apply   # back the file up, then write it
 *     sudo systemctl restart nodered        # Node-RED reads settings.js only when it starts
 *
 * WHY. The bridge keeps its eleven 24-hour history rings in flow context: 3.7 MB, rewritten in full
 * at every save. Measured 2026-09-29, that was about two thirds of the SD card's 19 GB of writes a
 * day, on a consumer card made in 2018. Every ring point is also in the edge's archive now, and a
 * clean stop saves on close, so a 5-minute save costs at most 5 minutes of ring on an unclean power
 * cut, and a few Wh of an outlet's accumulator. The operator chose 5 minutes (2026-09-29).
 *
 * `settings.js` is not in this repository, like `uiHost`: `npm run preflight` checks the result
 * (`context_flush`). The edit touches the one active `default: { module: "localfilesystem" }` line
 * and refuses anything it does not recognise, rather than guessing inside a file Node-RED will not
 * start without.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LINE = /^(\s*)default\s*:\s*\{\s*module\s*:\s*"localfilesystem"\s*(?:,\s*config\s*:\s*\{\s*flushInterval\s*:\s*(\d+)\s*\}\s*)?\}(\s*,?\s*)$/;

/** The settings text with the context store's flush set to `seconds`; unchanged if it already is. */
export function withContextFlush(text, seconds) {
  const lines = String(text).split('\n');
  const active = [];
  let inBlock = false;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      return;
    }
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true;
      return;
    }
    if (t.startsWith('//')) return;
    if (LINE.test(line.replace(/\r$/, ''))) active.push(i);
  });
  if (active.length === 0) throw new Error('no active contextStorage default with module "localfilesystem" found — edit settings.js by hand');
  if (active.length > 1) throw new Error(`${active.length} active contextStorage defaults found — edit settings.js by hand`);
  const i = active[0];
  const cr = lines[i].endsWith('\r') ? '\r' : '';
  const [, indent, current, tail] = lines[i].replace(/\r$/, '').match(LINE);
  if (Number(current) === seconds) return text;
  lines[i] = `${indent}default: { module: "localfilesystem", config: { flushInterval: ${seconds} } }${tail}${cr}`;
  return lines.join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('context-flush.mjs')) {
  const file = process.argv.find((a) => a.startsWith('--file='))?.slice(7) ?? path.join(os.homedir(), '.node-red', 'settings.js');
  const apply = process.argv.includes('--apply');
  const before = fs.readFileSync(file, 'utf8');
  const after = withContextFlush(before, 300);
  if (after === before) {
    console.log(`${file}: context already saved every 300 s — nothing to do.`);
  } else {
    const was = before.split('\n').find((l, i) => l !== after.split('\n')[i]);
    const now = after.split('\n').find((l, i) => l !== before.split('\n')[i]);
    console.log(`${file}\n  was: ${was.trim()}\n  now: ${now.trim()}`);
    if (!apply) {
      console.log('\nDry run. Add --apply to back the file up and write it, then: sudo systemctl restart nodered');
    } else {
      const backup = `${file}.bak-rm148-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      fs.copyFileSync(file, backup);
      fs.writeFileSync(file, after);
      console.log(`\nWritten. Backup: ${backup}\nNode-RED reads it only on start: sudo systemctl restart nodered`);
    }
  }
}
