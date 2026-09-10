import { describe, it, expect } from 'vitest';
import { explainWriteError } from './supabaseSchedules';

/**
 * Turning a database error into something an operator can act on.
 *
 * THE ONE THAT ACTUALLY FIRES. Adding a schedule while a blank rule is still sitting in the list
 * used to surface, verbatim:
 *
 *   Could not add the schedule: duplicate key value violates unique constraint
 *   "schedules_dedupe_uidx"
 *
 * It named an index instead of a problem, and the thing the reader needed to look at — the empty
 * rule already on screen — was not mentioned. That case is now PREVENTED in the card (the Add
 * button waits), so anything reaching this function is rarer; all the more reason for it to read
 * like a sentence rather than a stack trace.
 */

describe('explainWriteError', () => {
  it('says what to do about a duplicate, without naming the index', () => {
    const msg = explainWriteError(
      { message: 'duplicate key value violates unique constraint "schedules_dedupe_uidx"', code: '23505' },
      'add',
    );
    expect(msg).toMatch(/already has a rule with these times and days/i);
    expect(msg).toMatch(/blank rule already in the list/i);
    expect(msg).not.toMatch(/uidx|constraint|duplicate key/i);
  });

  it('words it for an EDIT differently — there is no blank rule to go and finish', () => {
    // Editing an existing rule into a collision is a different situation from adding one: the
    // fix is to change a time, not to fill in something half-made.
    const msg = explainWriteError(
      { message: 'duplicate key value violates unique constraint "schedules_dedupe_uidx"', code: '23505' },
      'save',
    );
    expect(msg).toMatch(/Another rule on this target already has these times and days/i);
    expect(msg).not.toMatch(/uidx/i);
  });

  it('recognises a duplicate by SQLSTATE even when the message names no index', () => {
    // PostgREST does not always echo the constraint name, and the class of error is still known.
    expect(explainWriteError({ message: 'conflict', code: '23505' }, 'add')).toMatch(/already exists on this target/i);
  });

  it('passes an unrecognised error through rather than flattening it', () => {
    // A friendly "something went wrong" hides the one string that could be searched for. An
    // unfamiliar message the reader can paste into a search beats a reassuring one that cannot.
    const msg = explainWriteError({ message: 'permission denied for table schedules', code: '42501' }, 'add');
    expect(msg).toContain('permission denied for table schedules');
  });

  it('survives an error object with no code and no message', () => {
    expect(() => explainWriteError({ message: '' }, 'save')).not.toThrow();
  });
});
