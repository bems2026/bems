import { describe, it, expect } from 'vitest';
import { carePreset, CARE_ASPECT, CARE_PARTITION_Y, CARE_DOORWAY_HALF } from './carePreset';
import { presetPlacements } from '@/lib/planPresets';
import { PLAN } from '@/components/scene3d/geometry';

/**
 * RM-044. This building's own layout, in the one directory allowed to name its devices.
 *
 * `test/device-ids-in-frontend.test.mjs` exempts `plans/` precisely because it loads only behind
 * `SITE.scene_pack`. A first version of this preset lived in `src/lib/` and that guard caught it:
 * a replicated deployment would have shipped this office's outlets and offered them as a starting
 * point for somebody else's room.
 */

describe('PLAN_PRESETS', () => {
  it('offers the surveyed CARE office layout', () => {
    expect([carePreset].map((p) => p.id)).toContain('care-office');
  });

  it('names the devices it places, so a site without them can be told', () => {
    const care = carePreset;
    expect(care.devices.map((d) => d.deviceId)).toEqual(
      expect.arrayContaining(['co1', 'co7', 'l1', 'l7']),
    );
  });

  it('places every outlet and every lighting circuit the office has', () => {
    const care = carePreset;
    const outlets = care.devices.filter((d) => d.point !== null);
    const circuits = care.devices.filter((d) => d.fixtures.length > 0);
    expect(outlets).toHaveLength(7);
    expect(circuits).toHaveLength(7);
  });

  it('gives every circuit three ceiling fixtures, as the room has', () => {
    const care = carePreset;
    for (const d of care.devices.filter((x) => x.fixtures.length > 0)) {
      expect(d.fixtures).toHaveLength(3);
    }
  });

  it('keeps every coordinate inside the room', () => {
    // A value outside 0..1 would be refused on read (`parseFixtures`, `coercePlanCoord`) and
    // silently vanish, which reads as a preset that half-worked.
    for (const preset of [carePreset]) {
      for (const d of preset.devices) {
        for (const p of [...(d.point ? [d.point] : []), ...d.fixtures]) {
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(1);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('carries the room proportions, so the drawing is not a square claiming to be this room', () => {
    const care = carePreset;
    expect(care.shape.aspect).toBeCloseTo(CARE_ASPECT, 6);
    expect(CARE_ASPECT).toBeCloseTo((PLAN.x1 - PLAN.x0) / (PLAN.y1 - PLAN.y0), 6);
  });

  it('places the glazed partition and its doorway in the room frame, not the viewBox', () => {
    // The shell draws in 0..1 of the ROOM now; the originals were written in the 320x550 viewBox
    // with the room inset 10px a side. Getting this wrong puts the partition a few percent off
    // every device drawn beside it.
    expect(CARE_PARTITION_Y).toBeCloseTo((PLAN.partitionY - PLAN.y0) / (PLAN.y1 - PLAN.y0), 6);
    expect(CARE_PARTITION_Y).toBeGreaterThan(0);
    expect(CARE_PARTITION_Y).toBeLessThan(0.5);
    // A doorway wider than the room would render as a partition with no wall left.
    expect(CARE_DOORWAY_HALF).toBeGreaterThan(0);
    expect(CARE_DOORWAY_HALF).toBeLessThan(0.5);
  });
});

describe('presetPlacements', () => {
  const care = carePreset;

  it('places only devices this deployment actually has', () => {
    // The preset names one building's hardware. At another site those ids do not exist, and a
    // write referencing them would fail the foreign key on `device_config.device_id`.
    const { placements, skipped } = presetPlacements(care, ['co1', 'l1', 'zz9'], 'room-a');
    expect(placements.map((p) => p.deviceId)).toEqual(['co1', 'l1']);
    // `zz9` is not in the preset at all, so it is neither placed nor skipped — a preset places
    // what it knows about, and says nothing about hardware it has never heard of.
    expect(skipped).not.toContain('zz9');
  });

  it('reports the devices it could not place, rather than applying a partial layout in silence', () => {
    const { placements, skipped } = presetPlacements(care, ['co1'], 'room-a');
    expect(placements).toHaveLength(1);
    expect(skipped).toContain('co2');
    expect(skipped.length).toBeGreaterThan(10);
  });

  it('puts every placed device into the chosen room', () => {
    const { placements } = presetPlacements(care, ['co1', 'l1'], 'room-a');
    for (const p of placements) expect(p.spaceNodeId).toBe('room-a');
  });

  it('gives an outlet a position and no fixtures, and a circuit fixtures and no position', () => {
    // The two are different claims: an outlet IS somewhere, a circuit's luminaires are.
    const { placements } = presetPlacements(care, ['co1', 'l1'], 'room-a');
    const outlet = placements.find((p) => p.deviceId === 'co1')!;
    const circuit = placements.find((p) => p.deviceId === 'l1')!;
    expect(outlet.planX).not.toBeNull();
    expect(outlet.planFixtures).toEqual([]);
    expect(circuit.planX).toBeNull();
    expect(circuit.planFixtures).toHaveLength(3);
  });
});
