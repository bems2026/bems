import type { Hit } from './types';

/**
 * Finding and stepping between a scene's hits — RM-084. Pure, so the page's pointer and keyboard
 * handlers are thin and the geometry is testable without a layout engine.
 */

/** The hit under a point in scene coordinates, or `null` in a margin. Boxes are half-open, so two
 *  columns that share an edge never both answer. */
export function hitAt(hits: readonly Hit[], x: number, y: number): number | null {
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) return i;
  }
  return null;
}

const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'] as const;
export type HitKey = (typeof KEYS)[number];

export function isHitKey(key: string): key is HitKey {
  return (KEYS as readonly string[]).includes(key);
}

/**
 * Where a key moves the reading. Left and right walk the hits in order (a generator emits them in
 * reading order); up and down move to the nearest hit in the same column, which is what makes a
 * heatmap navigable a day at a time. A key with nowhere to go stays put rather than wrapping — a
 * reader who hits the end of a month should know they have.
 */
export function stepHit(hits: readonly Hit[], index: number | null, key: HitKey): number {
  const last = hits.length - 1;
  if (index === null) return key === 'End' ? last : 0;
  switch (key) {
    case 'Home':
      return 0;
    case 'End':
      return last;
    case 'ArrowLeft':
      return Math.max(index - 1, 0);
    case 'ArrowRight':
      return Math.min(index + 1, last);
    default: {
      const here = hits[index];
      const cx = here.x + here.w / 2;
      const cy = here.y + here.h / 2;
      let best = index;
      let bestDistance = Infinity;
      hits.forEach((h, i) => {
        if (i === index || cx < h.x || cx >= h.x + h.w) return;
        const distance = key === 'ArrowUp' ? cy - (h.y + h.h / 2) : h.y + h.h / 2 - cy;
        if (distance > 0 && distance < bestDistance) {
          best = i;
          bestDistance = distance;
        }
      });
      return best;
    }
  }
}
