/**
 * This building's electrical tree — RM-029.
 *
 * TRANSCRIBED FROM WHAT WAS ALREADY KNOWN, not invented. The branch names and their meters come
 * from the CT circuit map recorded in `shared/registry.mjs`'s header, which notes it is "the only
 * documentation of this that exists", confirmed on site. `derivePhaseMap` over this file must
 * reproduce the old hand-written `PHASE_MAP` meter for meter, and `test/circuit-tree.test.mjs`
 * asserts exactly that — if they disagree, this file is wrong.
 *
 * A second site writes its own version of this file and nothing else changes.
 *
 * Data only, no imports. See `shared/circuits.mjs` for the shape and the derivation.
 */

export const CIRCUITS = [
  // The top of the tree. Unmetered: nothing measures the incoming supply as a whole, which is
  // itself worth recording — it is why building totals are a SUM of branches rather than a
  // single reading, and why an offline branch makes the total incomplete rather than wrong.
  {
    id: 'service_entrance',
    parent_id: null,
    kind: 'service_entrance',
    name: 'Service entrance',
    phase: null,
    meter_device_id: null,
  },

  // The CHNT sub-panel the four CT meters are clamped inside.
  {
    id: 'chnt_subpanel',
    parent_id: 'service_entrance',
    kind: 'panel',
    name: 'CHNT sub-panel',
    phase: null,
    meter_device_id: null,
  },

  // --- Red phase -----------------------------------------------------------
  {
    id: 'lo_red',
    parent_id: 'chnt_subpanel',
    kind: 'branch',
    name: 'L.O Red',
    phase: 'red',
    meter_device_id: 'mtr_lo_red',
    description: "The room's lighting circuits",
  },
  {
    // The aircon is the only load on this branch, which is why one physical meter serves as both
    // the branch meter and the aircon's own measurement — see RM-011, where that arrangement was
    // filed as a defect and then withdrawn as being by design.
    id: 'arec_acu',
    parent_id: 'chnt_subpanel',
    kind: 'branch',
    name: 'CARE ACU',
    phase: 'red',
    meter_device_id: 'mtr_arec_acu',
    description: "The CARE ACU's own branch circuit — the indoor unit the IR blaster commands",
  },

  // --- Yellow phase --------------------------------------------------------
  {
    id: 'co_yellow',
    parent_id: 'chnt_subpanel',
    kind: 'branch',
    name: 'C.O Yellow',
    phase: 'yellow',
    meter_device_id: 'mtr_co_yellow',
    description: 'Convenience outlets branch',
  },
  {
    // Two channels of ONE physical meter, the other being `mtr_co_yellow`. They are separate
    // logical circuits and separate registry devices, so they are separate rows here.
    id: 'lo_yellow',
    parent_id: 'chnt_subpanel',
    kind: 'branch',
    name: 'L.O Yellow',
    phase: 'yellow',
    meter_device_id: 'mtr_lo_yellow',
    description: 'Outdoor ACU (separate unit, right side outside the room)',
  },

  // --- Blue phase ----------------------------------------------------------
  // DELIBERATELY ABSENT. No Blue-phase meter is installed, and `derivePhaseMap` still emits
  // `blue: []` because the key's presence is what lets the UI say "not metered" instead of
  // rendering a real zero. Adding a placeholder row with a null meter would be harmless but
  // misleading — there is no such branch to describe.
];
