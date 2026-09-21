/**
 * One place that knows where device facts come from, now that the vendor cloud is optional.
 *
 * WHY (2026-09-17). Everything Add Device, enrolment and rebind needed came from Tuya's IoT Core
 * OpenAPI, which is a time-limited trial. It lapsed, and every one of them stopped. The operator's
 * decision: IoT Core is for extracting ids and keys once, not a dependency. So:
 *
 *   LAN presence (`lanPresence.mjs`)   what is on the device network now, with its protocol version
 *   imported credentials               ids and local keys from an export (`credentialImport.mjs`)
 *   the vendor OpenAPI (optional)      the same, while a subscription happens to be active
 *
 * `list()` merges them for the wizard; `asDeviceSource()` gives enrolment and rebind the vendor
 * client's `{listDevices, describeDevice}` shape over all of them; `versionFor` reads what the device
 * announces. A cloud that throws is reported as `unavailable` with its reason and otherwise ignored:
 * a lapsed subscription must never hide a device whose key was imported.
 *
 * ORPHANS ARE CONCLUDED CAUTIOUSLY. A rebind points a node at a different device, so calling a node
 * "orphaned" when its device is only unplugged would invite exactly the wrong repair. A node is an
 * orphan only when ALL of these hold:
 *   - it is not quiesced (a quiesced node is silent on purpose);
 *   - the presence listener has run long enough for silence to mean something, and has not heard it;
 *   - at least one COMPLETE list exists — a working cloud listing, or an import marked complete — and
 *     no complete list contains its device.
 */

/** How long a node's device must go unheard, on a warm listener, before its silence counts. */
export const ORPHAN_SILENCE_MS = 3 * 60_000;

/** Vendor codes worth naming. Anything else is reported by number only. */
const KNOWN_CODES = { 28841002: 'IoT Core subscription expired', 28841101: 'API not subscribed', 1010: 'token invalid', 1004: 'sign invalid' };

/**
 * Why the cloud is unavailable, safe to serve to a browser. Built from the vendor's numeric code, never
 * from the message text: a network error's text names the data centre host, and this reaches a page.
 */
const shortError = (err) => {
  const code = /code (\d+)/.exec(String(err?.message ?? err))?.[1];
  if (!code) return 'unreachable';
  return KNOWN_CODES[code] ? `code ${code}: ${KNOWN_CODES[code]}` : `vendor error code ${code}`;
};

export function createDeviceSources({ store, cloud = null, presence = null }) {
  const cloudList = async () => {
    if (!cloud) return { status: 'unconfigured', devices: [], detail: null };
    try {
      return { status: 'ok', devices: await cloud.listDevices(), detail: null };
    } catch (err) {
      return { status: 'unavailable', devices: [], detail: shortError(err) };
    }
  };

  const lanFields = (id) => {
    const heard = presence?.get(id) ?? null;
    return {
      on_lan: Boolean(presence?.heardWithin(id, ORPHAN_SILENCE_MS)),
      lan_version: heard?.version ?? null,
    };
  };

  /** Every list that claims to be the whole account: a working cloud listing, the last complete import. */
  const completeLists = (c) => {
    const lists = [];
    if (c.status === 'ok') lists.push(new Set(c.devices.map((d) => d.id)));
    const lc = store.lastCompleteIds();
    if (lc) lists.push(lc.ids);
    return lists;
  };

  /** Active tuya nodes whose device no complete list has. Silence is checked by the caller. */
  const unlisted = (flows, lists) =>
    lists.length === 0
      ? []
      : (flows ?? [])
        .filter((n) => n?.type === 'tuya-smart-device' && n.deviceId && n.disableAutoStart !== true)
        .filter((n) => lists.every((ids) => !ids.has(n.deviceId)));

  const orphansFrom = (flows, classForNode, c) => {
    if (!presence?.isWarm(ORPHAN_SILENCE_MS)) return [];
    return unlisted(flows, completeLists(c))
      .filter((n) => !presence.heardWithin(n.deviceId, ORPHAN_SILENCE_MS))
      .map((n) => ({ name: n.deviceName, class: classForNode(n.deviceName) ?? null }));
  };

  const merge = async (c) => {
    const imported = await store.asDeviceSource().listDevices();
    const byId = new Map();
    for (const d of c.devices) byId.set(d.id, { ...d, credential_source: 'cloud' });
    for (const d of imported) {
      const prior = byId.get(d.id);
      // An imported key is preferred: it is what the operator chose, and it needs no subscription.
      byId.set(d.id, { ...prior, ...d, online: prior?.online ?? d.online ?? null, credential_source: 'imported' });
    }
    for (const h of presence?.snapshot() ?? []) {
      if (!byId.has(h.id)) byId.set(h.id, { id: h.id, name: null, category: null, product_name: null, product_id: h.productKey ?? null, sub: false, online: null, credential_source: null });
    }
    const devices = [...byId.values()].map((d) => ({ ...d, ...lanFields(d.id) }));
    const since = presence?.startedAt?.() ?? null;
    return {
      devices,
      sources: {
        cloud: { status: c.status, ...(c.detail ? { detail: c.detail } : {}) },
        imported: { count: imported.length, last_complete_at: store.lastCompleteIds()?.at ?? null },
        lan: { listening_since: since ? new Date(since).toISOString() : null },
      },
    };
  };

  return {
    async list() {
      return merge(await cloudList());
    },

    /** `list()` plus `orphan_nodes`, from ONE cloud listing — what `/api/tuya/devices` serves. */
    async listWithOrphans(flows, classForNode) {
      const c = await cloudList();
      return { ...(await merge(c)), orphan_nodes: orphansFrom(flows, classForNode, c) };
    },

    asDeviceSource() {
      return {
        listDevices: async () => (await merge(await cloudList())).devices,
        describeDevice: async (id) => {
          const imported = await store.asDeviceSource().describeDevice(id);
          if (imported) return imported;
          if (!cloud) return null;
          try {
            return await cloud.describeDevice(id);
          } catch {
            return null;
          }
        },
      };
    },

    /** The version the device announces; `listen` is the one-off listener, used only if presence has none. */
    async versionFor(id, { listen } = {}) {
      const heard = presence?.get(id)?.version;
      if (heard) return heard;
      return listen ? ((await listen(id).catch(() => null))?.version ?? null) : null;
    },

    async orphanNodes(flows, classForNode) {
      if (!presence?.isWarm(ORPHAN_SILENCE_MS)) return [];
      return orphansFrom(flows, classForNode, await cloudList());
    },

    /**
     * Whether a specific node is an orphan — what rebind checks before it will write.
     *
     * With no warm standing listener (the CLI has none; the proxy's is cold for its first minutes),
     * `listen` stands in: one discovery window for THIS device, several broadcast intervals long. A
     * listener that fails is not silence, so it counts as heard.
     */
    async isOrphan(node, classForNode = () => null, { listen } = {}) {
      const c = await cloudList();
      if (presence?.isWarm(ORPHAN_SILENCE_MS)) return orphansFrom([node], classForNode, c).length === 1;
      if (!listen || unlisted([node], completeLists(c)).length !== 1) return false;
      if (presence?.heardWithin(node.deviceId, ORPHAN_SILENCE_MS)) return false;
      return (await listen(node.deviceId).catch(() => ({ failed: true }))) === null;
    },
  };
}
