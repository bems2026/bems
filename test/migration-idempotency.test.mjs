/**
 * A migration may not CLAIM a re-run is safe unless it actually is.
 *
 * WHY THIS EXISTS, and it is a scar rather than a precaution. `phase21_space_tree.sql` shipped
 * with "Every statement is guarded, so a re-run is safe" in its header. It was not: `create
 * policy` has no `if not exists` in PostgreSQL, so a re-run raises 42710. The operator hit it on
 * 2026-08-27 while re-applying that file to pick up a security fix — and because the SQL editor
 * stops at the first error, and the policies sit ABOVE the fix, the re-run aborted before
 * reaching the thing it was for. A false claim of idempotency is worse than an honest warning,
 * because it is acted on.
 *
 * THIS DOES NOT REQUIRE EVERY MIGRATION TO BE IDEMPOTENT. Most of this project's files are not,
 * and say so — `phase19_sites.sql` and `schema.sql` both warn that re-running errors on
 * `create policy` and to drop first. That convention is fine. What is not fine is a file
 * promising the opposite of what it does.
 *
 * TRIGGERS HAVE THE SAME GAP AND WERE ADDED HERE BEFORE THEY COULD BECOME THE SAME SCAR.
 * PostgreSQL has no `create trigger if not exists` either, so `phase23_plan_coords.sql` — the
 * first file in this project to define one — would have failed a re-run in precisely the way
 * phase21 did, with precisely the same misleading header. `create or replace function`,
 * `add column if not exists` and `drop constraint if exists` all guard themselves; these two
 * statements are the ones that do not, which is why they are the two this file counts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'supabase');
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

/** Reads as "this file can be applied twice without error". Deliberately narrow: it must match
 * a promise, not a passing mention of the word safe. */
const CLAIMS_RERUN_SAFE = /(re-run|re-running|running (it|this) again)[^.\n]*\b(is safe|safe|not an error)|safe to re-?run/i;

test('there are migrations to check, so this file cannot pass vacuously', () => {
  assert.ok(FILES.length > 10, `expected the migration set, found ${FILES.length}`);
});

for (const file of FILES) {
  const raw = readFileSync(join(DIR, file), 'utf8');
  const header = raw.slice(0, raw.search(/^\s*(create|alter|insert|revoke|grant|do)\b/im) + 1 || 4000);
  const sql = raw.replace(/^\s*--.*$/gm, '');

  /** The two statement kinds PostgreSQL gives no `IF NOT EXISTS` form. Counted per kind rather
   * than summed, so a file that guards two policies and no trigger cannot pass on the total. */
  const UNGUARDABLE = [
    { kind: 'policy', create: /^\s*create policy\s+\S+/gim, drop: /^\s*drop policy if exists/gim },
    { kind: 'trigger', create: /^\s*create trigger\s+\S+/gim, drop: /^\s*drop trigger if exists/gim },
  ];

  test(`${file}: an idempotency claim in the header is true`, () => {
    if (!CLAIMS_RERUN_SAFE.test(header)) return; // Silent or warning — nothing to hold it to.
    for (const { kind, create, drop } of UNGUARDABLE) {
      const creates = (sql.match(create) ?? []).length;
      const guarded = (sql.match(drop) ?? []).length;
      assert.equal(
        creates <= guarded,
        true,
        `${file} says a re-run is safe but creates ${creates} ${kind}s and guards ${guarded}. ` +
          `\`create ${kind}\` has no IF NOT EXISTS — drop first, or stop claiming it.`,
      );
    }
  });
}
