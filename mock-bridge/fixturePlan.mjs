/**
 * What the mock bridge has to simulate, derived from whatever site is configured — RM-033.
 *
 * WHY THIS IS A MODULE AND NOT THREE LINES IN `server.mjs`. `server.mjs` starts a listener as a
 * side effect of being imported, so nothing in it can be unit-tested. This is the part worth
 * testing: the mock could only ever serve one building, and the failure was not graceful.
 * Starting `npm run mock` against a scaffolded second site produced
 * `TypeError: Cannot read properties of undefined (reading 'toFixed')` — the four CARE branch
 * meter context keys were literals, and outlets and lights were `for (let i = 1; i <= 7; i++)`.
 *
 * That is worse than an ordinary fixture bug. The mock is how a second deployment is developed
 * and demonstrated BEFORE any hardware exists — the exact position another SUC is in, and the
 * exact thing Milestone 6 promises. A replication framework whose first `npm run` crashes is not
 * a replication framework.
 *
 * EVERY DEVICE ALREADY CARRIES WHAT THE FIXTURE NEEDED. An outlet knows its socket keys, a
 * switch knows its state key, a meter knows its context prefix. Nothing had to be added to the
 * registry — only read from it.
 *
 * INCOMPLETE DEVICES ARE DROPPED, NOT HALF-SIMULATED. An outlet missing a socket key would emit
 * a socket named `undefined` in a real-looking state; a switch with no state key cannot be
 * addressed at all. Both are registry mistakes, and a fixture that renders them as working
 * hardware hides the mistake behind plausible data.
 */

/**
 * @param {ReadonlyArray<Record<string, any>>} registry — `DEVICE_REGISTRY`, or any list shaped
 *   like it. Taken as a parameter rather than imported so this stays testable against a site
 *   that does not exist.
 */
export function fixturePlan(registry) {
  const devices = Array.isArray(registry) ? registry : [];

  const outlets = devices.filter(
    (d) => d.class === 'outlet_dual' && typeof d.ctx === 'string' && Array.isArray(d.sockets) && d.sockets.length >= 2,
  );

  const switches = devices.filter((d) => d.class === 'switch' && typeof d.state_key === 'string' && d.state_key.length > 0);

  /** The branch meters whose energy sums to the building total. `class === 'meter'` is the
   * distinction the registry already draws between a CT on a panel and a self-metering outlet. */
  const branchCtx = devices.filter((d) => d.class === 'meter' && typeof d.ctx === 'string').map((d) => d.ctx);

  /** Every context prefix the mock keeps an accumulator for. Returned alongside `branchCtx` so a
   * caller can assert the relationship that broke: a branch key with no accumulator is the crash. */
  const meteredCtx = devices.filter((d) => typeof d.ctx === 'string' && d.ctx.length > 0).map((d) => d.ctx);

  return { outlets, switches, branchCtx, meteredCtx };
}

/**
 * The building's own energy total, or `undefined` when there is nothing to total.
 *
 * A BUILDING WITH NO METERS HAS NOT USED 0 kWh — it has used an unknown amount, and those are
 * different claims. Found on a freshly scaffolded site: Live Demand read "—", voltage read "—",
 * the Blue phase read "not metered", and the three energy tiles read `0.00 kWh`. `buildLatest`
 * was doing the right thing; the zero was manufactured one layer earlier by a `reduce(..., 0)`
 * over an empty list, and `buildLatest` faithfully passed it on. Returning `undefined` here is
 * what makes it render as `—` instead.
 *
 * A meter that HAS been read and read zero still returns 0. That distinction — no meter, versus
 * a meter reading nothing — is the whole point, and it is RM-024's rule at the layer that seeds
 * the figure rather than the layer that renders it.
 */
export function branchEnergyTotal(energyAcc, branchCtx) {
  if (!Array.isArray(branchCtx) || branchCtx.length === 0) return undefined;
  let sum = 0;
  for (const ctx of branchCtx) {
    const v = energyAcc?.[ctx];
    // A branch with no accumulator entry contributes nothing rather than NaN, which would
    // poison the whole total and render as a blank that looks like a rendering fault.
    if (typeof v === 'number' && Number.isFinite(v)) sum += v;
  }
  return sum;
}
