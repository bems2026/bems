import { describe, it, expect } from 'vitest';
import { SITE_UI_DEFAULTS, readSiteUi, writeSiteUi } from './siteUi';

/**
 * The stored value is operator-editable jsonb in a shared row, so every way it can be wrong is a
 * way somebody's Control page can be wrong. The rule throughout: an unreadable preference falls
 * back to showing the card, never to hiding it.
 *
 * That direction is deliberate. A card shown when it should be hidden is a cosmetic annoyance
 * somebody fixes in one click. A card hidden because a value could not be parsed is a control
 * surface that has silently disappeared, with nothing on screen explaining why.
 */
describe('readSiteUi', () => {
  it('defaults every card to visible, so the migration changes nothing on screen', () => {
    // An existing deployment must look identical the moment the table lands and before anyone
    // opens the panel. A migration that rearranges the dashboard without being asked to is the
    // kind of surprise this project spends effort avoiding.
    expect(SITE_UI_DEFAULTS).toEqual({ controlPlanCard: true, overviewSceneCard: true });
    expect(readSiteUi(undefined)).toEqual(SITE_UI_DEFAULTS);
    expect(readSiteUi(null)).toEqual(SITE_UI_DEFAULTS);
    expect(readSiteUi({})).toEqual(SITE_UI_DEFAULTS);
  });

  it('reads a stored false', () => {
    expect(readSiteUi({ control_plan_card: false })).toEqual({ controlPlanCard: false, overviewSceneCard: true });
    expect(readSiteUi({ overview_scene_card: false })).toEqual({ controlPlanCard: true, overviewSceneCard: false });
  });

  it('falls back per key, not wholesale — one bad value must not reset the other', () => {
    const prefs = readSiteUi({ control_plan_card: 'no', overview_scene_card: false });
    expect(prefs.controlPlanCard).toBe(true);
    expect(prefs.overviewSceneCard).toBe(false);
  });

  it('treats every non-boolean as absent rather than coercing it', () => {
    // `"false"`, `0` and `null` are all truthy-or-falsy in ways that would make a hand-edited row
    // hide a card by accident. Only a real `false` hides one.
    for (const junk of ['false', 0, 1, null, [], {}, 'true']) {
      expect(readSiteUi({ control_plan_card: junk }).controlPlanCard).toBe(true);
    }
  });

  it('survives a row that is not an object at all', () => {
    for (const junk of ['nonsense', 42, [], true]) {
      expect(readSiteUi(junk)).toEqual(SITE_UI_DEFAULTS);
    }
  });
});

describe('writeSiteUi', () => {
  it('round-trips through readSiteUi', () => {
    const prefs = { controlPlanCard: false, overviewSceneCard: true };
    expect(readSiteUi(writeSiteUi(prefs))).toEqual(prefs);
  });

  it('writes snake_case keys, matching every other jsonb column in this schema', () => {
    expect(writeSiteUi({ controlPlanCard: false, overviewSceneCard: false })).toEqual({
      control_plan_card: false,
      overview_scene_card: false,
    });
  });

  /**
   * The blob is shared and versioned only by the code writing it. A newer build adds a key; an
   * older tab still open on the same site then saves and wipes it. Merging over what is already
   * there is what makes "a new preference never requires a migration" true rather than merely
   * intended — the whole reason this is jsonb.
   */
  it('preserves keys it does not know about', () => {
    const stored = { control_plan_card: true, some_future_card: false };
    const written = writeSiteUi({ controlPlanCard: false, overviewSceneCard: true }, stored);
    expect(written).toEqual({ control_plan_card: false, overview_scene_card: true, some_future_card: false });
  });

  it('ignores a non-object existing value rather than spreading it', () => {
    expect(writeSiteUi(SITE_UI_DEFAULTS, 'nonsense')).toEqual({ control_plan_card: true, overview_scene_card: true });
  });
});
