import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TOKENS } from './tokens';

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'index.css'), 'utf8');

function cssVar(name: string): string {
  const m = CSS.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`--${name} not found in index.css`);
  return m[1].trim();
}

describe('scene3d TOKENS mirrors index.css :root', () => {
  it.each(Object.keys(TOKENS) as (keyof typeof TOKENS)[])('%s matches its CSS custom property', (key) => {
    // camelCase token name -> kebab-case CSS var, e.g. bgSurface2 -> bg-surface-2
    const cssName = key.replace(/([A-Z])/g, '-$1').replace(/(\d)/, '-$1').toLowerCase();
    expect(TOKENS[key]).toBe(cssVar(cssName));
  });
});
