/**
 * Strips credentials out of a Node-RED flow export so a structural baseline of the live flow
 * can live in this repo, which is PUBLIC.
 *
 * The live flow genuinely carries secrets: every `tuya-smart-device` node holds the device's
 * local key, which is the credential that lets anything on the LAN drive that relay. A Google
 * Sheet id is likewise a capability rather than a label. None of that may be committed.
 *
 * What survives is everything that makes a baseline useful — node ids, types, names, wires,
 * tab membership, and function bodies — so the flow's topology can be diffed and reviewed.
 * This is deliberately NOT a restorable backup: restoring needs the real keys, and the full
 * unredacted export belongs only on the Pi itself.
 */

export const REDACTED = '__REDACTED__';

/** Fields removed by name. Kept as an exported constant so the test can assert the list and
 * the implementation can never quietly disagree with it. */
export const SECRET_FIELDS = ['deviceKey', 'deviceId', 'sheet'];

/** Deep-clones and redacts. Never mutates its argument — the caller is usually holding the
 * live flow it just fetched, and quietly altering that would be a nasty trap. */
export function redactFlow(flows) {
  return flows.map((node) => {
    const copy = { ...node };
    for (const field of SECRET_FIELDS) {
      if (copy[field] !== undefined && copy[field] !== null && copy[field] !== '') copy[field] = REDACTED;
    }
    return copy;
  });
}

/**
 * Belt-and-braces check run before anything is written to disk: a name-based allowlist only
 * catches the fields we already thought of, so this also flags any long opaque string
 * anywhere in the export. Returns human-readable locations — never the values themselves,
 * since the whole point is to avoid putting them somewhere they can be read.
 */
export function findResidualSecrets(flows) {
  const hits = [];
  const OPAQUE = /^[A-Za-z0-9+/_-]{32,}={0,2}$/;

  const walk = (value, path, node) => {
    if (typeof value === 'string') {
      if (value === REDACTED) return;
      const leaf = path.split('.').pop();
      if (SECRET_FIELDS.includes(leaf)) hits.push(`${node.type}#${node.id} .${path} (secret field left unredacted)`);
      else if (OPAQUE.test(value)) hits.push(`${node.type}#${node.id} .${path} (opaque ${value.length}-char string)`);
      return;
    }
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) walk(value[key], path ? `${path}.${key}` : key, node);
    }
  };

  for (const node of flows) {
    for (const key of Object.keys(node)) {
      // Function bodies and templates are long free text; scanning them for "opaque strings"
      // only produces noise. They are checked separately, by pattern, in the capture script.
      if (key === 'func' || key === 'template' || key === 'initialize' || key === 'finalize') continue;
      walk(node[key], key, node);
    }
  }
  return hits;
}
