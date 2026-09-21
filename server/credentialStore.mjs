/**
 * Where imported device ids and local keys are kept — on the Pi, never in the repository, never in a
 * response.
 *
 * `server/data/` is gitignored and already holds live state (the command audit buffers, the cached
 * signing key). The file is written owner-read/write only (0600), atomically, so a crash mid-write
 * cannot leave half a key file.
 *
 * WHAT IT GUARDS. A local key is a credential for one device on the LAN: anyone holding it and on the
 * device SSID can switch that device. That is narrower than `TUYA_ACCESS_SECRET` (every device, from
 * anywhere), and it is still a secret. So `publicView()` returns a key's LENGTH and nothing else, and
 * the only way to read a key back is `localKeyFor` / `describeDevice`, which only server code calls.
 *
 * `asDeviceSource()` gives it the same `{listDevices, describeDevice}` shape as the vendor OpenAPI
 * client, so enrolment and rebind take either without knowing which.
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_CREDENTIAL_PATH =
  process.env.DEVICE_CREDENTIALS_PATH || join(dirname(fileURLToPath(import.meta.url)), 'data', 'device-credentials.json');

export function createCredentialStore({ path = DEFAULT_CREDENTIAL_PATH, now = Date.now } = {}) {
  const read = () => {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      return parsed && typeof parsed.devices === 'object' && parsed.devices ? parsed : { devices: {} };
    } catch {
      return { devices: {} };
    }
  };

  const write = (data) => {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    try {
      chmodSync(tmp, 0o600);
    } catch {
      // Not every filesystem keeps POSIX modes (the Windows workstation does not); the Pi's does.
    }
    renameSync(tmp, path);
  };

  return {
    /**
     * `devices` are the normalised rows from `parseCredentialExport`.
     *
     * `complete: true` says the export lists EVERY device in the account, as the QR-login tool's and
     * `tinytuya wizard`'s do. Only then may a device's ABSENCE from it mean something (that it was
     * re-paired under a new id, or removed) — see `deviceSources.orphanNodes`. A partial export says
     * nothing about what it leaves out.
     */
    importDevices(devices, { source = 'import', complete = false } = {}) {
      const data = read();
      let added = 0;
      let updated = 0;
      const at = new Date(now()).toISOString();
      for (const d of devices) {
        const prior = data.devices[d.id];
        if (prior && prior.localKey === d.localKey && prior.name === d.name && prior.category === d.category) continue;
        if (prior) updated += 1;
        else added += 1;
        data.devices[d.id] = { ...d, importedAt: at, source };
      }
      if (complete) data.lastComplete = { at, ids: devices.map((d) => d.id) };
      if (added || updated || complete) write(data);
      return { added, updated, total: Object.keys(data.devices).length };
    },

    /** The ids of the last import that listed the whole account, or null if there has been none. */
    lastCompleteIds() {
      const lc = read().lastComplete;
      return lc && Array.isArray(lc.ids) ? { at: lc.at, ids: new Set(lc.ids) } : null;
    },

    /** Everything but the keys. */
    publicView() {
      return Object.values(read().devices).map((d) => ({
        id: d.id,
        name: d.name ?? null,
        category: d.category ?? null,
        product_name: d.productName ?? null,
        product_id: d.productId ?? null,
        sub: d.sub === true,
        // Named without "key": `tuyaFleet.assertNoSecrets` refuses any response field that has it.
        credential_length: typeof d.localKey === 'string' ? d.localKey.length : 0,
        imported_at: d.importedAt ?? null,
        source: d.source ?? null,
      }));
    },

    localKeyFor(id) {
      return read().devices[id]?.localKey ?? null;
    },

    has(id) {
      return Boolean(read().devices[id]);
    },

    remove(id) {
      const data = read();
      if (!data.devices[id]) return false;
      delete data.devices[id];
      write(data);
      return true;
    },

    /** The vendor client's shape. `online` is null: an export is not an observation of anything. */
    asDeviceSource() {
      return {
        listDevices: async () =>
          Object.values(read().devices).map((d) => ({
            id: d.id,
            name: d.name ?? null,
            category: d.category ?? null,
            product_name: d.productName ?? null,
            product_id: d.productId ?? null,
            sub: d.sub === true,
            online: null,
          })),
        describeDevice: async (id) => {
          const key = read().devices[id]?.localKey;
          return key ? { local_key: key } : null;
        },
      };
    },
  };
}
