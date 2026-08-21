import { isReadingStale } from '@/lib/staleness';
import type { Reading } from '@/lib/types';
import { TOKENS } from './tokens';

export interface MaterialState {
  color: string;
  emissiveIntensity: number;
  opacity: number;
}

/**
 * Pure state→appearance mapping, deliberately separated from `officeScene.ts`'s
 * Three.js side effects. This is the part worth testing in isolation: given a reading (or
 * none), what should the fixture look like — and every call here is id-keyed by the
 * caller (`circuit`/`co{n}` device id), never by mesh array position, so a device
 * appearing in a different order in `/api/devices` can't shift a light or outlet to the
 * wrong appearance.
 *
 * Stale/offline dims and desaturates using the same `isReadingStale()` the 2D
 * `FloorPlanView` and `StaleDataBadge` use — one freshness rule, not a second one invented
 * for the 3D scene.
 */
/**
 * How far a stale fixture dims in the 3D scene.
 *
 * Deliberately NOT shared with `FloorPlanView`'s SVG opacity, which is 0.5. These are
 * different media: this value applies to a lit, emissive mesh whose `emissiveIntensity`
 * also drops to 0.05 and whose colour changes at the same time, so the two numbers do not
 * mean the same thing and matching them would not make the two views look alike. Named here
 * so the 3D side has one value rather than the two identical literals it used to carry.
 */
const STALE_OPACITY = 0.4;
const STALE_EMISSIVE = 0.05;

export function lightMaterialState(reading: Reading | undefined): MaterialState {
  if (isReadingStale(reading)) return { color: TOKENS.muted2, emissiveIntensity: STALE_EMISSIVE, opacity: STALE_OPACITY };
  const on = reading?.state === 'on';
  return on ? { color: TOKENS.accent, emissiveIntensity: 1.2, opacity: 1 } : { color: TOKENS.bgSurface2, emissiveIntensity: 0.03, opacity: 1 };
}

export function outletSocketMaterialState(reading: Reading | undefined, socket: 1 | 2): MaterialState {
  if (isReadingStale(reading)) return { color: TOKENS.muted2, emissiveIntensity: STALE_EMISSIVE, opacity: STALE_OPACITY };
  const on = reading?.socket_states?.[socket] === 'on';
  return on ? { color: TOKENS.accent, emissiveIntensity: 0.9, opacity: 1 } : { color: TOKENS.bgSurface2, emissiveIntensity: 0.02, opacity: 1 };
}

/**
 * The scene's single definition of "commanded on and fresh". `officeScene.ts`'s
 * `trackOnState` already computed this inline (string-comparing a mesh's emissive color to
 * `TOKENS.accent`) to drive the auto-rotate pulse; `applyState` now needs the same check in
 * three more places (floor pools, per-row point lights, the ACU glow) — one exported
 * predicate beats four copies of a color-string comparison silently drifting apart.
 */
export const isOn = (state: MaterialState): boolean => state.color === TOKENS.accent;

/** Wall/partition/floor shell — same wireframe emissive line everywhere, no state dependency. */
export const SHELL_LINE_COLOR = TOKENS.border;
export const SHELL_GLOW_COLOR = TOKENS.accent;
