/**
 * Device ids and local keys from an export file, rather than from the vendor cloud.
 *
 * WHY THIS EXISTS (2026-09-17). Local control needs each device's id and local key, and the only
 * source this project had was Tuya's IoT Core OpenAPI — a time-limited trial that lapsed on
 * 2026-09-17 and that the operator uses only for that one extraction. Two tools produce the same
 * facts without it:
 *
 *   - a QR-login tool built on Tuya's official device-sharing SDK (scan with the Smart Life app, no
 *     developer account), whose JSON is the SDK's device record — `id`, `name`, `local_key`,
 *     `category`, `product_id`, `product_name`, `sub`, `node_id` — and whose CSV has those as columns;
 *   - `tinytuya wizard`'s `devices.json` — `id`, `name`, `key`, `category`, `product_id`, …
 *
 * This module accepts either, and any CSV with an id column and a key column, and normalises them to
 * one shape. It does not run either tool — the operator does, on their own machine, when onboarding.
 * iBEMS never signs into the vendor with another application's identity.
 *
 * REFUSES RATHER THAN GUESSES. A row with no id, or no key, or a key that is not the 16-character
 * shape a Tuya local key has, is reported and skipped. A wrong key does not fail loudly: it produces a
 * node that reads offline forever, which looks like a network fault.
 *
 * Problems name the row (by name or id), never the key. Pure: no I/O.
 */

/** Column / field names each normalised field may arrive under, compared case- and space-insensitively. */
const FIELDS = {
  id: ['id', 'device_id', 'deviceid', 'dev_id', 'devid', 'gwid'],
  localKey: ['local_key', 'localkey', 'key'],
  name: ['name', 'device_name', 'devicename'],
  category: ['category'],
  productId: ['product_id', 'productid', 'product_key', 'productkey'],
  productName: ['product_name', 'productname', 'product'],
  sub: ['sub', 'sub_device', 'subdevice', 'is_sub'],
  nodeId: ['node_id', 'nodeid', 'cid'],
};

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');

/** A Tuya local key is 16 printable characters. Anything else is not one. */
const isLocalKey = (v) => typeof v === 'string' && v.length === 16 && /^[\x21-\x7e]+$/.test(v);

const truthy = (v) => v === true || ['true', '1', 'yes', 'y'].includes(norm(v));

function pick(row, field) {
  const keys = Object.keys(row);
  for (const alias of FIELDS[field]) {
    const hit = keys.find((k) => norm(k) === alias);
    if (hit !== undefined && row[hit] !== undefined && row[hit] !== null && String(row[hit]).trim() !== '') return row[hit];
  }
  return undefined;
}

function normaliseRow(row, index) {
  const label = String(pick(row, 'name') ?? pick(row, 'id') ?? `row ${index + 1}`);
  const id = pick(row, 'id');
  if (id === undefined) return { problem: `${label}: no device id` };
  const key = pick(row, 'localKey');
  if (key === undefined || String(key).trim() === '-' ) return { problem: `${label}: no local key (a Bluetooth-only device has none)` };
  if (!isLocalKey(String(key))) return { problem: `${label}: the local key is not the 16-character shape a Tuya key has` };
  const str = (v) => (v === undefined ? null : String(v));
  return {
    device: {
      id: String(id).trim(),
      name: str(pick(row, 'name')),
      localKey: String(key),
      category: str(pick(row, 'category')),
      productName: str(pick(row, 'productName')),
      productId: str(pick(row, 'productId')),
      sub: truthy(pick(row, 'sub')),
      nodeId: str(pick(row, 'nodeId')),
    },
  };
}

/** RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function rowsFromJson(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    for (const k of ['devices', 'result', 'data', 'list']) if (Array.isArray(value[k])) return value[k];
  }
  return null;
}

/**
 * @param {string} content  the export's text
 * @returns {{ format: 'json'|'csv'|null, devices: object[], problems: string[] }}
 */
export function parseCredentialExport(content) {
  const text = String(content ?? '').replace(/^\uFEFF/, '');
  let rows = null;
  let format = null;

  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      rows = rowsFromJson(JSON.parse(trimmed));
      format = 'json';
    } catch {
      rows = null;
    }
  }
  if (!rows) {
    const table = parseCsv(text);
    const header = (table[0] ?? []).map(norm);
    const hasId = FIELDS.id.some((a) => header.includes(a));
    const hasKey = FIELDS.localKey.some((a) => header.includes(a));
    if (table.length > 1 && hasId && hasKey) {
      rows = table.slice(1).map((cells) => Object.fromEntries(table[0].map((h, i) => [h, cells[i]])));
      format = 'csv';
    }
  }
  if (!rows) return { format: null, devices: [], problems: ['not a recognised export — expected tinytuya devices.json, or a JSON/CSV export with an id and a local key per device'] };

  const devices = [];
  const problems = [];
  const seen = new Set();
  rows.forEach((row, i) => {
    if (!row || typeof row !== 'object') { problems.push(`row ${i + 1}: not a device record`); return; }
    const r = normaliseRow(row, i);
    if (r.problem) { problems.push(r.problem); return; }
    if (seen.has(r.device.id)) { problems.push(`${r.device.name ?? r.device.id}: listed twice — the first entry was kept`); return; }
    seen.add(r.device.id);
    devices.push(r.device);
  });
  return { format, devices, problems };
}
