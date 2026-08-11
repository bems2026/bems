export interface PhaseHealth {
  balanced: boolean;
  /** `null` when either phase has no reading yet — not "unbalanced," genuinely unknown. */
  spread: number | null;
  heavier: 'red' | 'yellow' | null;
}

/**
 * Compares Red and Yellow — the only two live phases this installation has (Blue has no
 * CT meter; `shared/registry.mjs`'s `PHASE_MAP.blue` is hardcoded empty). v4's own design
 * compares three phases; adapted to two real ones rather than inventing a Phase C reading.
 * 3.5A spread threshold matches the design's own balance rule, applied to the pair that
 * actually exists.
 */
export function phaseBalance(red: number | null, yellow: number | null): PhaseHealth {
  if (red === null || yellow === null) return { balanced: true, spread: null, heavier: null };
  const spread = Math.abs(red - yellow);
  return { balanced: spread < 3.5, spread, heavier: red >= yellow ? 'red' : 'yellow' };
}
