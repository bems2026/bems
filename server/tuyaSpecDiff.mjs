/**
 * Compares the committed capability catalogue against the vendor's live device model.
 *
 * WHY. `shared/deviceCapabilities.mjs` is a transcription of something we do not control. Tuya
 * can change a dp's scale, add a code, or ship different firmware to a replacement unit, and
 * every one of those failures is silent: a scale change turns 225.4 V into 2254 V or 22.54 V and
 * nothing throws. The catalogue's own comment says it was measured rather than guessed; this is
 * the part that keeps that true after the day it was written.
 *
 * MATCHED BY FINGERPRINT, NOT BY PRODUCT ID. This repository is public, so vendor product
 * identifiers do not belong in it. Instead each profile is matched to a cloud product by the
 * dp -> code map they share, which is a far stronger claim than an id anyway: two products that
 * agree on every dp and code ARE the same device model, whatever they are called.
 *
 * Pure — no network, no imports. The CLI in `tuya-spec.mjs` does the fetching.
 */

/** dp -> code, the fingerprint both sides are reduced to before anything is compared. */
export function fingerprint(capabilities) {
  const out = new Map();
  for (const c of capabilities) out.set(Number(c.dp), c.code);
  return out;
}

/** How much two fingerprints agree: matching dp->code pairs, minus nothing. Higher is better. */
export function similarity(a, b) {
  let shared = 0;
  for (const [dp, code] of a) if (b.get(dp) === code) shared += 1;
  return shared;
}

/**
 * Pair each profile with the cloud product it fingerprints closest to.
 *
 * A product may back more than one profile only if they are genuinely identical, which they are
 * not here, so each cloud product is claimed at most once — otherwise a partial match could see
 * the single- and dual-channel meters both claim the dual-channel product (they share dps
 * 101-112 exactly) and the single-channel one would then be reported as "missing" everything.
 */
export function matchProfiles(profiles, products) {
  const pairs = [];
  for (const profile of profiles) {
    const pf = fingerprint(profile.capabilities);
    for (const product of products) {
      const score = similarity(pf, fingerprint(product.capabilities));
      if (score > 0) pairs.push({ profile, product, score });
    }
  }
  pairs.sort((x, y) => y.score - x.score);

  const matched = [];
  const usedProfiles = new Set();
  const usedProducts = new Set();
  for (const pair of pairs) {
    if (usedProfiles.has(pair.profile.id) || usedProducts.has(pair.product.key)) continue;
    usedProfiles.add(pair.profile.id);
    usedProducts.add(pair.product.key);
    matched.push(pair);
  }
  const unmatched = profiles.filter((p) => !usedProfiles.has(p.id));
  return { matched, unmatched };
}

/** The fields whose drift changes what a value MEANS, as opposed to how it is labelled. */
const COMPARED = ['dp', 'access', 'kind', 'scale', 'unit'];

/**
 * Every way one profile can disagree with its product.
 *
 * `unit_inferred` capabilities are compared on everything except the unit: the vendor states no
 * unit for the outlet's `add_ele`, so requiring one to match would report drift forever. If the
 * vendor ever starts declaring one, that is reported as `unit_now_declared` rather than ignored —
 * an inference that has become checkable should stop being an inference.
 */
export function diffProfile(profile, product) {
  const findings = [];
  const byCode = new Map(product.capabilities.map((c) => [c.code, c]));

  for (const ours of profile.capabilities) {
    const theirs = byCode.get(ours.code);
    if (!theirs) {
      findings.push({ severity: 'error', code: ours.code, kind: 'missing_upstream',
        detail: `catalogue declares ${ours.code} (dp ${ours.dp}); the device model has no such code` });
      continue;
    }
    for (const field of COMPARED) {
      if (field === 'unit' && ours.unit_inferred) {
        if (theirs.unit) {
          findings.push({ severity: 'warn', code: ours.code, kind: 'unit_now_declared',
            detail: `unit was inferred as "${ours.unit}"; the device model now declares "${theirs.unit}"` });
        }
        continue;
      }
      const mine = ours[field];
      const upstream = theirs[field];
      if (upstream === undefined) continue; // the model is silent; we are not contradicted
      // Units are compared case-insensitively: the vendor writes both `kWh` and `kwh` on the
      // same device, and `divisorFor` already folds case, so a literal comparison would report
      // drift that is not there — the fastest way to teach somebody to ignore this check.
      const same = field === 'unit'
        ? String(mine ?? '').toLowerCase() === String(upstream ?? '').toLowerCase()
        : String(mine ?? '') === String(upstream ?? '');
      if (!same) {
        findings.push({ severity: 'error', code: ours.code, kind: `${field}_mismatch`,
          detail: `${field}: catalogue says ${JSON.stringify(mine)}, device model says ${JSON.stringify(upstream)}` });
      }
    }
    if (Array.isArray(ours.range) && Array.isArray(theirs.range)) {
      const a = [...ours.range].sort().join('|');
      const b = [...theirs.range].sort().join('|');
      if (a !== b) {
        findings.push({ severity: 'warn', code: ours.code, kind: 'range_mismatch',
          detail: `range: catalogue says [${ours.range}], device model says [${theirs.range}]` });
      }
    }
  }

  for (const theirs of product.capabilities) {
    if (profile.capabilities.some((c) => c.code === theirs.code)) continue;
    findings.push({ severity: 'warn', code: theirs.code, kind: 'new_upstream',
      detail: `device model offers ${theirs.code} (dp ${theirs.dp}), which the catalogue does not carry` });
  }

  return findings;
}

/**
 * A profile the catalogue claims is writable that the vendor says is read-only is the one
 * finding here that could move a relay, so it is checked separately and always an error.
 */
export function diffWritability(profile, product) {
  const byCode = new Map(product.capabilities.map((c) => [c.code, c]));
  return profile.capabilities
    .filter((c) => c.writable && byCode.get(c.code)?.access === 'ro')
    .map((c) => ({ severity: 'error', code: c.code, kind: 'writable_but_readonly',
      detail: `catalogue marks ${c.code} writable; the device model marks it read-only` }));
}

/** Whether a set of findings should fail the check. Warnings inform; errors mean it is wrong. */
export function hasDrift(findings) {
  return findings.some((f) => f.severity === 'error');
}
