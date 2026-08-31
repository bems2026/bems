/**
 * Reading the state of the LOCAL device sessions, as a pure function over the live flow and the
 * bridge's own readings.
 *
 * THE QUESTION THIS ANSWERS. "Can these devices be controlled over the 2.4 GHz LAN from their
 * device id and local key alone, with no vendor cloud in the path?" The answer has been yes
 * since the first release — `node-red-contrib-tuya-smart-device` holds a local session per
 * device and `server/dispatchLight.mjs` tries it first on every command — but nothing produced
 * that answer on demand. `npm run tuya:devices` compares the vendor cloud's opinion against the
 * bridge's; it never touches the local protocol, so it cannot distinguish "the LAN path is
 * working" from "the cloud says the device is up".
 *
 * WHY IT DOES NOT OPEN ITS OWN CONNECTION. The obvious implementation is a second `tuyapi`
 * client that connects and reads. That is exactly the wrong thing to do here: a Tuya device has
 * a small, fixed inbound socket table, and exhausting it is the failure mode that leaves a
 * device unreachable locally while its cloud connection stays healthy — the fault
 * `docs/adr-002-device-recovery-path.md` was written about, and the reason a vendor fallback
 * exists at all. A diagnostic that can cause the fault it is looking for is not a diagnostic.
 *
 * So this OBSERVES the sessions that already exist. Nothing here talks to a device.
 *
 * TWO TABLES, NOT ONE, AND DELIBERATELY NOT JOINED. A tuya node and a registry device are not
 * one-to-one: `shared/tuyaNodeSettings.mjs` records that three nodes back two devices between
 * them, and one node feeds two metered channels. Any name-based join would be a guess that
 * looks like a fact — and a probe whose whole purpose is to be believed is the last place for
 * one. So the device table answers "is this device reporting over the local protocol", from the
 * readings; the node table answers "what does the flow declare about the session", from the
 * flow. Each fact comes from the source that actually owns it.
 *
 * Pure and separately testable, like `quiescePlan` and `outletPollPlan` — the script that runs
 * it does the I/O.
 */

/**
 * How recently a device must have reported for its local session to count as live.
 *
 * Five minutes: comfortably beyond the slowest legitimate cadence in this system (the 60 s
 * outlet poll, per `outletPollPlan.POLL_INTERVAL_S`) and well inside the ten minutes at which
 * `buildLatest.STALE_READING_MS` stops believing `online` at all. A probe that called a device
 * dead between two polls would be worse than useless, because it would be run precisely when
 * somebody is already suspicious.
 */
export const LOCAL_SILENT_MS = 300000;

/** The `tuya-smart-device` nodes in a flow. */
export function tuyaNodes(flows) {
  return (flows ?? []).filter((n) => n?.type === 'tuya-smart-device');
}

/**
 * What the flow DECLARES about each local session.
 *
 * `tuyaVersion` is here because a node declaring the wrong protocol version fails as
 * `find() timed out`, which reads exactly like a network fault and is not one — this project
 * has already lost days to that. Reporting the declaration beside the outcome is what separates
 * "the device is not there" from "we are speaking the wrong dialect at it".
 *
 * `disableAutoStart` is here because a deliberately quiesced node otherwise looks identical to
 * a broken one.
 */
export function nodeSessions(flows) {
  return tuyaNodes(flows).map((n) => ({
    node: n.deviceName ?? n.name ?? n.id,
    protocol: n.tuyaVersion ?? null,
    findTimeoutMs: n.findTimeout === undefined ? null : Number(n.findTimeout),
    quiesced: n.disableAutoStart === true,
    /** Whether the node has a fixed address rather than discovering by broadcast. Not better or
     * worse — but a static address that is wrong presents as a dead device, so it is worth
     * seeing. Never the address itself: this output is quoted into a public repository. */
    staticAddress: Boolean(n.deviceIp),
  }));
}

/**
 * Whether each registry device is currently reporting over the local protocol.
 *
 * Read from `GET /api/readings/latest` rather than from flow context, because `buildLatest` has
 * already done this resolution once — preferring the source tab's own arrival stamp, falling
 * back to the bridge's observation, and forcing `online: false` past its own staleness window.
 * Re-deriving it here from raw context would be a second implementation of a rule that has
 * already been got wrong twice.
 */
export function deviceSessions({ readings = [], registry = [], nowMs = Date.now() }) {
  const byId = new Map((readings ?? []).filter((r) => r && r.device_id !== '_totals').map((r) => [r.device_id, r]));

  return (registry ?? []).map((d) => {
    const reading = byId.get(d.id);
    const ts = reading ? Date.parse(reading.ts) : NaN;
    const lastReportMs = Number.isFinite(ts) ? nowMs - ts : null;
    return {
      deviceId: d.id,
      class: d.class,
      /** `null` when the device is absent from the feed entirely, which is a different fact
       * from being present and offline — one is a registry/flow mismatch, the other is a
       * device that is not answering. */
      online: reading ? reading.online === true : null,
      lastReportMs,
      local: verdict({ reading, lastReportMs, cls: d.class }),
    };
  });
}

/**
 * Three-valued on purpose. `unknown` is not a hedge: a device absent from the feed, or one
 * whose class has no measurable freshness at all, is a state where claiming either "local
 * control works" or "it does not" would be invention.
 */
function verdict({ reading, lastReportMs, cls }) {
  if (!reading) return 'unknown';
  if (reading.online === false) return 'down';
  // A switch, the ACU and the outdoor probe carry no arrival stamp of their own — `buildLatest`
  // stamps `ts = now` for them, so their age is synthesized and proves nothing. Their `online`
  // comes from a real health signal, which is the only evidence available, and saying "live" on
  // the strength of a fabricated timestamp is precisely the fabrication this system keeps
  // removing. See `shared/registry.mjs`'s STALE_AFTER_MS_BY_CLASS.
  if (cls !== 'outlet_dual' && cls !== 'meter') return reading.online === true ? 'live-unmeasured' : 'unknown';
  if (lastReportMs === null) return 'unknown';
  return lastReportMs <= LOCAL_SILENT_MS ? 'live' : 'silent';
}

/**
 * The whole report. `summary` exists so a caller can assert on it — `npm run preflight` is the
 * intended second consumer — rather than parsing printed text.
 */
export function planLocalProbe({ flows, readings = [], registry = [], nowMs = Date.now() }) {
  const devices = deviceSessions({ readings, registry, nowMs });
  const nodes = nodeSessions(flows);
  const count = (v) => devices.filter((d) => d.local === v).length;

  return {
    devices,
    nodes,
    summary: {
      devices: devices.length,
      nodes: nodes.length,
      live: count('live'),
      liveUnmeasured: count('live-unmeasured'),
      silent: count('silent'),
      down: count('down'),
      unknown: count('unknown'),
      quiescedNodes: nodes.filter((n) => n.quiesced).map((n) => n.node),
      /** Protocol versions in use. A fleet speaking one version is unremarkable; a mixed fleet
       * is the normal state here and worth showing, because a node on the wrong one fails in a
       * way that reads as a network fault. */
      protocols: [...new Set(nodes.map((n) => n.protocol).filter(Boolean))].sort(),
    },
  };
}
