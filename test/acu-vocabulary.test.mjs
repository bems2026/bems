/**
 * Every code the aircon controller can emit has a sentence, and every sentence has a code.
 *
 * A reason the planner produces that the page has no text for reaches an operator as a raw
 * enum — `acu_offline` instead of "the IR blaster has never been paired, and pairing it is what
 * makes this rule start working". On a site where EVERY rule holds on exactly that reason
 * (RM-016), that is the difference between a page that explains itself and one that does not.
 *
 * The reverse matters too: text for a code the planner cannot emit is dead weight that reads as
 * a feature somebody forgot to finish.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOLD_REASONS, ALERT_KINDS, ACU_TEXT } from '../shared/acuLoopVocabulary.mjs';

const ALL = [...HOLD_REASONS, ...ALERT_KINDS];

test('there is a vocabulary to check, so this file cannot pass vacuously', () => {
  assert.ok(HOLD_REASONS.length >= 15, `expected the full reason set, found ${HOLD_REASONS.length}`);
  assert.ok(ALERT_KINDS.length >= 3);
});

test('every hold reason and alert kind has plain-language text', () => {
  const missing = ALL.filter((code) => !ACU_TEXT[code]);
  assert.deepEqual(missing, [], `no sentence for: ${missing.join(', ')}`);
});

test('no text exists for a code the planner cannot emit', () => {
  const orphaned = Object.keys(ACU_TEXT).filter((code) => !ALL.includes(code));
  assert.deepEqual(orphaned, [], `text with no code: ${orphaned.join(', ')}`);
});

test('the text is a sentence, not a restated enum', () => {
  for (const code of ALL) {
    const text = ACU_TEXT[code];
    assert.notEqual(text, code, `${code} is its own text`);
    assert.ok(text.length > 25, `${code} has text too short to explain anything: "${text}"`);
    assert.ok(!text.includes('_'), `${code}'s text still contains an identifier: "${text}"`);
  }
});

test('the planner re-exports the same vocabulary it is tested against', async () => {
  // The planner re-exports rather than redeclaring; this catches the day somebody "helpfully"
  // pastes a second copy back into it.
  const planner = await import('../server/acuLoopPlan.mjs');
  assert.deepEqual([...planner.HOLD_REASONS], [...HOLD_REASONS]);
  assert.deepEqual([...planner.ALERT_KINDS], [...ALERT_KINDS]);
});
