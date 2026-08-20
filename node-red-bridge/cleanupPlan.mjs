/**
 * Decides what to remove from the live Node-RED flow, as a pure function over the flow array.
 *
 * Kept separate from the script that applies it so the decision can be unit-tested without a
 * live system, and so a dry run and a real apply are guaranteed to be computing the SAME plan
 * rather than two implementations that could drift.
 *
 * What is removed, and why:
 *
 *   - `ui_*` — the legacy node-red-dashboard at /ui. Superseded by the web app; confirmed
 *     unused on site. Config nodes (`ui_group`, `ui_tab`, `ui_base`) go with the widgets, or
 *     they dangle referencing nothing.
 *   - `debug` — editor-only sinks.
 *   - The MQTT "twin": `mqtt in "twin commands"` and `mqtt out "publish state"`. The input
 *     subscribes to `mmsu/office/cmd/#` and can switch real lights with NO authentication, no
 *     audit row, and without consulting HARDWARE_DISPATCH_ENABLED — every safety control built
 *     for the command path sits in front of a door this leaves open. Verified against the live
 *     broker: the publisher emits every ~3s and the only clients connected to Mosquitto are
 *     Node-RED's own two connections, so nothing consumes either half. Its presumed consumer
 *     (n8n) is not installed.
 *   - Any `mqtt-broker` left unreferenced once the above are gone — computed, never hardcoded.
 *
 * What is deliberately KEPT:
 *
 *   - `GSheet`/`gauth` — still wanted as a parallel historical record.
 *   - `mqtt in "ESP32 AC Sniffer"` and the broker it uses. It received nothing during a live
 *     15s listen, but the ESP32 is a 2.4 GHz Wi-Fi device and the site is currently on 5 GHz —
 *     so its silence is fully explained by the outage and is NOT evidence that it is retired.
 *     That question can only be answered once the network is fixed.
 *   - Everything else, including every `function`, `inject` and `link` node. Control logic is
 *     not touched while no device is reachable to verify against.
 */

const isUi = (type) => typeof type === 'string' && type.startsWith('ui_');
const TWIN = [
  { type: 'mqtt in', name: 'twin commands' },
  { type: 'mqtt out', name: 'publish state' },
];

/**
 * The n8n-era API surface. n8n was trialled and set aside; it is not installed. These
 * endpoints and the standalone 3D twin page they served are read paths the iBEMS app does not
 * use — it reads through the authenticated proxy at /api/*. `POST /light/:id` is deliberately
 * ABSENT from this list: despite a comment still calling it "n8n dashboard API", it is the
 * live light-dispatch path the proxy posts to.
 */
export const DEAD_ENDPOINTS = ['/twin', '/lights/status', '/outlets/status', '/energy/status'];

/** Left inert when the MQTT twin was removed: one built its payload, one consumed its
 * commands. Neither has an input or an output that goes anywhere any more.
 *
 * `every 3s` is the twin's own timer, and removing it is what retires the whole data-gathering
 * chain behind it — inject -> GET /energy/status -> "keep energy -> get outlets" -> GET
 * /outlets/status -> "build twin state". That chain is twin-only (nothing else consumes any
 * link in it) and its only source is this inject, so the reachability sweep collects the rest
 * on its own rather than needing each node named here. It also polled two of the very
 * endpoints this pass removes. */
const DEAD_BY_NAME = ['build twin state', 'twin cmd -> Lighting Hub', 'keep energy -> get outlets'];

/** Names too generic to match safely on their own, so qualified by type as well. */
const DEAD_BY_TYPE_AND_NAME = [
  { type: 'inject', name: 'every 3s' },
  { type: 'http request', name: 'energy' },
  { type: 'http request', name: 'outlets' },
];

/** Comments that document things that no longer exist. A comment describing a SURVIVING
 * endpoint is left alone — the point is to remove stale signposts, not all signposts. */
const DEAD_COMMENT_PATTERNS = [/^n8n /i, /^Digital Twin bridge/i, /^Serve 3D twin/i];

/** Nodes that can originate a message on their own. Everything else only runs when something
 * upstream sends to it, which is what makes the sweep below sound. `file in` is NOT a source:
 * it has an input and only reads when triggered. */
const SOURCE_TYPES = new Set(['inject', 'http in', 'mqtt in', 'tuya-smart-device', 'websocket in']);

/** Config nodes carry no `z` and are referenced by property rather than by wires, so the
 * reachability sweep cannot see their users and must never remove them. Removing the
 * websocket-listener this way would have taken /ws/live — and the whole live feed — with it. */
const isConfigNode = (n) => n.z === undefined || n.z === null || n.z === '';

/**
 * @returns {{flows: Array, remove: Array, reasons: Object, orphans: Array}}
 *   `flows` is the cleaned copy, `remove` the nodes dropped, `reasons` id -> why,
 *   `orphans` nodes that now feed nothing and need a human decision.
 */
/**
 * Control paths that reached their destination BY WAY OF a node about to be deleted, and so
 * must be reconnected directly first or they break silently.
 *
 * Only one exists: the aircon's schedule. `Check Time AC` wired into the `AC Master Power`
 * dashboard switch, which passed the message straight through to `AC Master Logic`. Removing
 * the dashboard would therefore have stopped the AC running to schedule — while lights and
 * outlets, whose schedules wire into their hubs directly, were unaffected.
 *
 * This is behaviour-PRESERVING, not a behaviour change: the widget has `passthru: true` and
 * performs no transformation, so `{payload: 'OFF'|'25'}` arrives at `AC Master Logic` byte for
 * byte either way. (Its `onvalue`/`offvalue` only apply to a human toggling it, which is the
 * manual /ui control being retired on purpose.)
 */
const REWIRES = [{ from: 'Check Time AC', through: 'AC Master Power', to: 'AC Master Logic' }];

export function planCleanup(input) {
  const flows = input.map((n) => ({ ...n, ...(n.wires ? { wires: n.wires.map((w) => [...w]) } : {}) }));
  const reasons = {};

  // Applied before anything is marked for removal, so the new wire is in place by the time
  // dangling references are stripped.
  for (const { from, through, to } of REWIRES) {
    const source = flows.find((n) => n.name === from);
    const relay = flows.find((n) => n.name === through);
    const target = flows.find((n) => n.name === to);
    if (!source || !relay || !target || !source.wires) continue;
    source.wires = source.wires.map((out) => out.map((id) => (id === relay.id ? target.id : id)));
  }

  const mark = (node, why) => {
    reasons[node.id] = why;
  };

  for (const n of flows) {
    if (isUi(n.type)) mark(n, 'legacy /ui dashboard');
    else if (n.type === 'debug') mark(n, 'debug sink');
    else if (TWIN.some((t) => t.type === n.type && t.name === n.name)) mark(n, 'MQTT twin (unauthenticated command path / unconsumed publisher)');
  }

  for (const n of flows) {
    if (reasons[n.id]) continue;
    if (n.type === 'http in' && DEAD_ENDPOINTS.includes(n.url)) mark(n, 'n8n-era HTTP endpoint, unused by the app');
    else if (DEAD_BY_NAME.includes(n.name)) mark(n, 'inert since the MQTT twin was removed');
    else if (DEAD_BY_TYPE_AND_NAME.some((d) => d.type === n.type && d.name === n.name)) mark(n, 'the twin data-gathering chain');
    else if (n.type === 'comment' && DEAD_COMMENT_PATTERNS.some((re) => re.test(n.name ?? ''))) mark(n, 'comment describing something that no longer exists');
  }

  // Brokers are decided AFTER the twin, and by reference count rather than by name — the two
  // brokers here have near-identical names, so matching on "the duplicate one" would be a coin
  // flip. Whichever ends up referenced by nothing is the dead one, by definition.
  const survivingMqtt = flows.filter((n) => (n.type === 'mqtt in' || n.type === 'mqtt out') && !reasons[n.id]);
  for (const n of flows) {
    if (n.type !== 'mqtt-broker' || reasons[n.id]) continue;
    if (!survivingMqtt.some((m) => m.broker === n.id)) mark(n, 'MQTT broker config no longer referenced by any node');
  }

  // Sweep: anything no longer reachable from a surviving source is dead by construction.
  // This is what removes each deleted endpoint's downstream chain (its formatter, its file
  // reader, its http response) without needing every one of them listed by name — and it
  // catches the schedule-save path the /ui removal stranded. Iterated to a fixed point,
  // because removing one node can strand the next.
  const outsOf = (n) => {
    const out = [...(n.wires ?? []).flat()];
    if ((n.type === 'link out' || n.type === 'link call') && Array.isArray(n.links)) out.push(...n.links);
    return out;
  };
  for (;;) {
    const live = flows.filter((n) => !reasons[n.id]);
    const byId = Object.fromEntries(live.map((n) => [n.id, n]));
    const targetedLinkIns = new Set(live.flatMap((n) => (Array.isArray(n.links) ? n.links : [])));
    const sources = live.filter((n) => SOURCE_TYPES.has(n.type) || (n.type === 'link in' && targetedLinkIns.has(n.id)));
    const seen = new Set(sources.map((n) => n.id));
    const queue = [...seen];
    while (queue.length) {
      const cur = byId[queue.pop()];
      if (!cur) continue;
      for (const t of outsOf(cur)) if (byId[t] && !seen.has(t)) { seen.add(t); queue.push(t); }
    }
    const stranded = live.filter((n) => !seen.has(n.id) && !isConfigNode(n) && n.type !== 'comment' && n.type !== 'tab' && n.type !== 'group' && n.type !== 'subflow');
    if (!stranded.length) break;
    for (const n of stranded) mark(n, 'unreachable from any message source');
  }

  const removedIds = new Set(Object.keys(reasons));
  const remove = flows.filter((n) => removedIds.has(n.id));
  const kept = flows.filter((n) => !removedIds.has(n.id));

  // Strip wires that would otherwise point at deleted nodes. Node-RED tolerates dangling
  // targets, but they are invisible rot: the next person to read the flow cannot tell a stale
  // reference from a real one.
  for (const n of kept) {
    if (!n.wires) continue;
    n.wires = n.wires.map((out) => out.filter((target) => !removedIds.has(target)));
  }

  // A node that used to feed something and now feeds nothing is REPORTED, never auto-deleted.
  // Some of these are genuinely dead; others are shared logic whose other consumer happens to
  // be an HTTP endpoint rather than a wire. Telling those apart needs a human.
  const orphans = [];
  for (const n of kept) {
    const before = flows.find((f) => f.id === n.id);
    const hadWires = (input.find((f) => f.id === n.id)?.wires ?? []).some((w) => w.length > 0);
    const hasWires = (n.wires ?? []).some((w) => w.length > 0);
    if (hadWires && !hasWires) orphans.push({ id: n.id, type: n.type, name: n.name ?? '', z: before?.z });
  }

  return { flows: kept, remove, reasons, orphans };
}
