/**
 * Renders the README's illustrations from `src/*.html` to PNG, light and dark.
 *
 *     node docs/assets/render.mjs [name...]      # default: every template
 *
 * WHY THIS EXISTS RATHER THAN HAND-DRAWN FILES: an image that nobody can regenerate is a fact
 * with no source, and this repository already refuses those elsewhere — `bridge-flow.json` is
 * generated from `shared/`, the dp parsers from the capability catalogue. The templates use the
 * app's own tokens and its own fonts, so the pictures on the front page stay recognisably the
 * product rather than drifting into a separate house style.
 *
 * Headless Chromium, no dependencies. `--force-device-scale-factor=1.5` is the compromise: sharp on a HiDPI reader at the
 * width GitHub actually renders a README image, without paying 2x file size for it.
 *
 * The two themes are one file opened twice — `src/theme.js` reads `?theme=dark`. Nothing here
 * knows what a colour is.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, 'src');

/** Logical CSS pixels. The template's own `body` must match, or Chromium clips or letterboxes it. */
const SIZES = {
  hero: [1280, 320],
  architecture: [1280, 592],
  social: [1280, 640],
};

/**
 * Templates that render in one theme only. The social preview is a single uploaded file in
 * repo Settings, not a `<picture>` pair, so a light twin would be an unused 300 KB.
 */
const THEMES = {
  social: ['dark'],
};

/** Output basename when it should not be `<template>-<theme>`. */
const NAMES = {
  'social:dark': 'social-preview',
};

/** `chromium` on Debian/Raspberry Pi OS; the others are what other distros call it. */
const BINARIES = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];

function findChromium() {
  for (const bin of BINARIES) {
    try {
      return execFileSync('which', [bin], { encoding: 'utf8' }).trim();
    } catch {
      /* not this one */
    }
  }
  throw new Error(`no Chromium found — looked for: ${BINARIES.join(', ')}`);
}

function shoot(chromium, template, theme, [w, h]) {
  const out = path.join(HERE, `${NAMES[`${template}:${theme}`] ?? `${template}-${theme}`}.png`);
  const url = `file://${path.join(SRC, `${template}.html`)}${theme === 'dark' ? '?theme=dark' : ''}`;
  execFileSync(
    chromium,
    [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      // Fonts are `font-display: block` and load from node_modules over file://. Without a
      // virtual-time budget the shot can land before they resolve, and the difference is a
      // banner set in the fallback sans — which looks fine and is wrong.
      '--virtual-time-budget=4000',
      '--force-device-scale-factor=1.5',
      `--window-size=${w},${h}`,
      `--screenshot=${out}`,
      url,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  if (!existsSync(out)) throw new Error(`${template}/${theme}: chromium wrote nothing`);
  return { out, bytes: statSync(out).size };
}

const requested = process.argv.slice(2);
const templates = requested.length
  ? requested
  : readdirSync(SRC)
      .filter((f) => f.endsWith('.html'))
      .map((f) => f.replace(/\.html$/, ''));

const chromium = findChromium();
console.log(`chromium: ${chromium}\n`);

let total = 0;
for (const template of templates) {
  const size = SIZES[template];
  if (!size) throw new Error(`${template}: no size in SIZES — add one rather than guessing`);
  for (const theme of THEMES[template] ?? ['light', 'dark']) {
    const { out, bytes } = shoot(chromium, template, theme, size);
    total += bytes;
    console.log(`  ${path.relative(process.cwd(), out).padEnd(38)} ${size[0]}x${size[1]}@1.5x  ${(bytes / 1024).toFixed(0)} KB`);
  }
}
console.log(`\n${(total / 1024).toFixed(0)} KB written`);
