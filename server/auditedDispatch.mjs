/**
 * The one implementation of "record a command, then act on it" — shared by
 * `server/proxy.mjs` (a person clicked a control) and `server/scheduler.mjs` (a schedule
 * came due, or DSM shed a tier).
 *
 * THE ASYMMETRY THIS REPLACES:
 * both callers used to dispatch FIRST and record after, and then disagreed about what a
 * failed audit insert means. proxy.mjs refused to report success without a row
 * (`502 audit_log_unreachable`, pinned by proxy.test.mjs). scheduler.mjs logged the
 * identical failure to the console and carried on:
 *
 *     if (!res.ok) console.error(`[ibems-scheduler] audit insert failed: ...`);
 *
 * So a scheduled or auto-shed command could reach a real relay and never enter the audit
 * trail — on the one path with no human watching, which is exactly the path where the trail
 * is the only record that anything happened. The safety contract was implemented twice and
 * only one copy was right.
 *
 * WHY RECORD-FIRST, NOT DISPATCH-FIRST:
 * dispatch-then-record can only ever detect that the trail is incomplete; it cannot prevent
 * it, because by the time the insert fails the relay has already moved. Writing the row
 * first makes "hardware moved with no audit row" unrepresentable: no row, no dispatch.
 *
 * WHY A ROW LEFT AT 'dispatching' IS AN ACCEPTABLE OUTCOME:
 * if the final status update fails, the row stays `dispatching` — "we tried and do not know
 * how it went". That is an honest state and strictly better than the alternative it
 * replaces, which was no row at all. It is also self-describing to anyone reading the
 * audit table later, which `failed` would not be: `failed` is a claim about the hardware,
 * and we would not have earned it.
 *
 * `commands.status` is a free-text column (supabase/schema.sql documents its values in a
 * comment but declares no CHECK constraint), so `dispatching` needs no migration.
 */

/** Written before dispatch is attempted; replaced by the outcome once it is known. */
export const STATUS_IN_FLIGHT = 'dispatching';

/**
 * @param {{
 *   device: object,
 *   cmd: object,
 *   note: string,
 *   auditRow: object,                       extra columns the caller owns (attribution, source, ...)
 *   dispatchEnabled: boolean,
 *   dispatchClasses: string[],
 *   dispatch: (device: object, cmd: object) => Promise<{ok: boolean, detail?: string}>,
 *   insertAudit: (row: object) => Promise<{ok: boolean, id?: string, detail?: string}>,
 *   updateAudit: (id: string, patch: object) => Promise<{ok: boolean, detail?: string}>,
 *   log?: (msg: string) => void,
 * }} args
 * @returns {Promise<{
 *   ok: boolean, status: string, auditId: string|null,
 *   auditFailure: string|null, dispatchFailure: string|null, statusRecorded: boolean
 * }>}
 */
export async function auditedDispatch({
  device,
  cmd,
  note,
  auditRow,
  dispatchEnabled,
  dispatchClasses,
  dispatch,
  insertAudit,
  updateAudit,
  log = console.error,
}) {
  const willDispatch = Boolean(dispatchEnabled) && dispatchClasses.includes(device.class);
  const openingStatus = willDispatch ? STATUS_IN_FLIGHT : 'dry_run';

  const inserted = await insertAudit({ ...auditRow, status: openingStatus, note });
  if (!inserted.ok) {
    // The refusal. Nothing has touched hardware at this point and nothing will.
    return {
      ok: false,
      status: openingStatus,
      auditId: null,
      auditFailure: inserted.detail ?? 'audit insert failed',
      dispatchFailure: null,
      statusRecorded: false,
    };
  }

  if (!willDispatch) {
    return { ok: true, status: 'dry_run', auditId: inserted.id ?? null, auditFailure: null, dispatchFailure: null, statusRecorded: true };
  }

  const result = await dispatch(device, cmd);
  const status = result.ok ? 'dispatched' : 'failed';
  // A command that only landed through the vendor cloud is recorded as such. It means the
  // device stopped answering on the LAN, which is a fault worth seeing even though the relay
  // did move — collapsing it into a bare 'dispatched' would hide the one signal that says a
  // device needs attention. See docs/adr-002-device-recovery-path.md.
  const viaNote = result.ok && result.via === 'cloud' ? `${note}; via cloud fallback — ${result.detail}` : note;
  const finalNote = result.ok ? viaNote : `${note}; dispatch failed: ${result.detail}`;
  if (result.ok && result.via === 'cloud') log(`${cmd.device_id} did not answer locally; recovered via cloud`);
  if (!result.ok) log(`hardware dispatch failed for ${cmd.device_id}: ${result.detail}`);

  let statusRecorded = true;
  if (inserted.id) {
    // `via` as a column, not only inside the note above. Prose is not queryable, and "which
    // devices have needed the cloud fallback this week" is the question that spots a device
    // going bad before it goes dark. Left unset for a dry run, which never reaches here: NULL
    // means "no path attempted", honestly different from 'none', which claims both were tried.
    // See supabase/phase18_command_via.sql.
    let updated = await updateAudit(inserted.id, { status, note: finalNote, via: result.via ?? null });

    // `supabase/phase18_command_via.sql` is applied by hand, so there is a window where this
    // code is deployed and the column is not there. PostgREST rejects an UPDATE naming an
    // unknown column, which would fail the outcome patch for EVERY command and leave rows stuck
    // at STATUS_IN_FLIGHT — the audit trail degrading quietly, in order to add a nicety. So
    // retry once without it: status and note are what matter, and `via` starts working by
    // itself once the migration lands. Order-independent beats a deployment note that has to be
    // read at exactly the right moment.
    //
    // Narrowly matched on purpose. A genuine outage must still surface as an unrecorded
    // outcome rather than being masked by a retry that drops a field and calls it success.
    if (!updated.ok && /column .*via|via.* does not exist/i.test(updated.detail ?? '')) {
      log(`command ${inserted.id}: the commands table has no 'via' column yet (apply supabase/phase18_command_via.sql); recording the outcome without it`);
      updated = await updateAudit(inserted.id, { status, note: finalNote });
    }

    if (!updated.ok) {
      statusRecorded = false;
      log(`command ${inserted.id} dispatched but its outcome could not be recorded (row stays '${STATUS_IN_FLIGHT}'): ${updated.detail}`);
    }
  } else {
    // No id came back, so there is nothing to update. The row exists at STATUS_IN_FLIGHT.
    statusRecorded = false;
  }

  return {
    ok: result.ok,
    status,
    // Returned as well as recorded, so the caller can put it on the ack. A command that only
    // landed through the cloud succeeded — the operator sees a normal success — while meaning
    // the device stopped answering on the LAN. Without this the only place that shows is a
    // database column nobody has open.
    via: result.via ?? null,
    auditId: inserted.id ?? null,
    auditFailure: null,
    dispatchFailure: result.ok ? null : (result.detail ?? 'dispatch failed'),
    statusRecorded,
  };
}
