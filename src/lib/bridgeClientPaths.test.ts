import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `fetchJson` owns the base address: it does `fetch(\`${BRIDGE_HTTP_URL}${path}\`)`, and
 * `BRIDGE_HTTP_URL` already ends in `/api`. So every caller must pass a bare path below that
 * — `/tuya/devices`, not `${BRIDGE_HTTP_URL}/tuya/devices` and not `/api/tuya/devices`.
 *
 * This has gone wrong twice, in both directions, and neither failure was loud:
 *
 *   - `tuyaFleet.ts` passed a full URL, producing `/apihttp://…/api/tuya/devices`. The request
 *     left the browser, missed every proxy route, fell through to Node-RED and came back as
 *     "the vendor cloud could not be reached" — which reads as a credentials or network fault.
 *   - `enroll.ts` passed `/api/enroll`, producing `/api/api/enroll`, so the endpoint was
 *     simply never reachable.
 *
 * Neither is a type error, and both survive a green suite, because the mistake is in a string.
 * A grep is the only thing that catches it, so the grep is a test.
 */

// cwd, not `import.meta.url` — vitest transforms this module with a vite-root-relative URL,
// so deriving a disk path from it lands on `C:\src`. vitest always runs from the package root.
const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('fetchJson call sites', () => {
  const files = sourceFiles(SRC);

  it('finds the source tree, so an empty scan can never pass vacuously', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('never passes an absolute URL — fetchJson prepends the base itself', () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const [i, line] of readFileSync(f, 'utf8').split(/\r?\n/).entries()) {
        if (!/fetchJson[^(]*\(/.test(line)) continue;
        if (/fetchJson[^(]*\(\s*(`\s*\$\{|['"`]https?:)/.test(line)) offenders.push(`${f}:${i + 1}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never repeats the /api prefix the base URL already carries', () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const [i, line] of readFileSync(f, 'utf8').split(/\r?\n/).entries()) {
        if (/fetchJson[^(]*\(\s*['"`]\/api\b/.test(line)) offenders.push(`${f}:${i + 1}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
