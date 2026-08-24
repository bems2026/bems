/**
 * Probing an applied-by-hand migration without leaving anything behind.
 *
 * WHY THIS EXISTS: checking whether a CHECK constraint accepts a new value means writing that
 * value to a real row, and on 2026-08-24 that was done twice against live `device_config` data
 * with the restore only remembered afterwards, the second time *after* the lesson had been
 * written into ROADMAP RM-014. A note was not enough. The fix is to make the safe shape the
 * convenient one.
 *
 * Two probes, and the difference matters:
 *
 *   - `probeRejects` is genuinely read-only. A write that violates a CHECK is refused by
 *     Postgres, so nothing changes and there is nothing to undo. Prefer it whenever the
 *     question can be phrased as "is this old value still refused?".
 *   - `probeAccepts` cannot avoid writing — acceptance is only observable by being accepted —
 *     so it captures the current value first and restores it in a `finally`, meaning the
 *     restore cannot be forgotten and still runs if the assertion throws.
 *
 * Pure of I/O policy but not of I/O: `request` is injected so the round-trip logic is testable
 * without a database, in keeping with the rest of `server/`.
 */

/** Postgres' check_violation. What a CHECK constraint refusing a value looks like. */
export const CHECK_VIOLATION = '23514';

/**
 * Asserts a value is REFUSED. Read-only: a refused write changes nothing.
 * @returns {Promise<{rejected: boolean, code: string|null}>}
 */
export async function probeRejects({ request, table, keyColumn, keyValue, column, value }) {
  const res = await request({
    method: 'PATCH',
    path: `/${table}?${keyColumn}=eq.${encodeURIComponent(keyValue)}`,
    body: { [column]: value },
  });
  const code = res.body?.code ?? null;
  return { rejected: res.status >= 400 && code === CHECK_VIOLATION, code };
}

/**
 * Asserts a value is ACCEPTED, then puts the row back exactly as it was.
 *
 * The restore is in a `finally` on purpose. The failure being designed against is not a
 * malicious one, it is an ordinary one: the probe throws, attention moves to the failure, and
 * the row is left holding a value nobody chose.
 */
export async function probeAccepts({ request, table, keyColumn, keyValue, column, value }) {
  const before = await request({
    method: 'GET',
    path: `/${table}?select=${column}&${keyColumn}=eq.${encodeURIComponent(keyValue)}`,
  });
  const rows = Array.isArray(before.body) ? before.body : [];
  if (rows.length !== 1) {
    throw new Error(`probeAccepts needs exactly one row to borrow; ${table} matched ${rows.length}`);
  }
  const original = rows[0][column];

  try {
    const res = await request({
      method: 'PATCH',
      path: `/${table}?${keyColumn}=eq.${encodeURIComponent(keyValue)}`,
      body: { [column]: value },
    });
    return { accepted: res.status < 400, restoredTo: original };
  } finally {
    // Unconditional. If the write never landed this is a no-op; if it did, this is the whole
    // point of the function.
    await request({
      method: 'PATCH',
      path: `/${table}?${keyColumn}=eq.${encodeURIComponent(keyValue)}`,
      body: { [column]: original },
    });
  }
}
