#!/usr/bin/env node
/**
 * `npm run preflight` — is this deployment ready to run? FI-002 / RM-033.
 *
 * WHAT IT IS FOR. `docs/replication.md` names its own biggest gap: *"Day-one network setup —
 * joining the Pi and the devices to a 2.4 GHz segment, linking the vendor account — partly
 * written down in CLAUDE.md's site facts, not yet a procedure."* This is that procedure, as a
 * command rather than a page someone has to remember to read.
 *
 * HOW IT DIFFERS FROM `site:check`. That one reads the site *directory* and answers "is this
 * description of a building coherent?" — offline, from source, with no network at all. This one
 * reads the *deployment* and answers "can this machine actually see the building?" — credentials,
 * database, vendor account, the local radio segment, the bridge. A site can be perfectly coherent
 * on a machine that will never reach a single device.
 *
 * THE ONE RULE. **A check that could not be run is never reported as fine.** `null` observations
 * become `unchecked`, and an unchecked required item leaves the deployment not-ready. This is the
 * same discipline the dashboard holds to — a missing reading renders `—`, never `0` — applied to
 * a setup tool, where the failure is worse: a green light nobody earned is exactly what someone
 * standing in an unfamiliar building will believe.
 *
 * IT WRITES NOTHING AND CHANGES NOTHING. No credential is created, no flow deployed, no Wi-Fi
 * touched — `CLAUDE.md` forbids the last one outright and a wrong SSID loses the host with nobody
 * on site to recover it. Every failing check prints the next step for a person to take.
 *
 * IT PRINTS NO SECRET. The observation shape carries `set` / `empty` / `absent` and never a
 * value, so the output is safe to paste into an issue. `TUYA_ACCESS_SECRET` reaches hardware
 * directly and nothing scopes it; this file must never be the thing that leaks it.
 */

export const LEVELS = Object.freeze({
  OK: 'ok',
  WARN: 'warn',
  ERROR: 'error',
  /** Observed to be absent... no: NOT observed at all. Fails, and says which. */
  UNCHECKED: 'unchecked',
  /** Not run because something it depends on already failed. Reported, never counted twice. */
  SKIPPED: 'skipped',
});

/** Keys that must carry a real value before anything works. */
const REQUIRED_SUPABASE = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const REQUIRED_TUYA = ['TUYA_ACCESS_ID', 'TUYA_ACCESS_SECRET'];

/**
 * @param {object} obs Observations gathered by the CLI below. Every field may be `null`, meaning
 *   "not checked" — which is a distinct answer from `false`, and treated as one.
 * @returns {{ ready: boolean, checks: object[], errors: object[], warnings: object[] }}
 *
 * Pure: it does no I/O and reaches nothing global, so the whole verdict table can be exercised
 * against deployments that do not exist — including the broken ones nobody can produce on demand.
 */
export function assessDeployment(obs) {
  const env = obs?.env ?? {};
  const database = obs?.database ?? {};
  const vendor = obs?.vendor ?? {};
  const network = obs?.network ?? {};
  const bridge = obs?.bridge ?? {};
  const services = obs?.services ?? {};
  const host = obs?.host ?? {};
  const siteId = obs?.siteId ?? '(unknown)';

  const checks = [];
  const add = (id, title, level, detail, fix) => {
    checks.push({ id, title, level, detail, fix: level === LEVELS.OK ? null : fix });
    return level;
  };

  /** `absent` (no key at all) and `empty` (the key with nothing after the `=`) are both missing.
   * The second is the common one: `.env.example` ships every required key with an empty value, so
   * a copied-but-unedited file has all the right names and none of the answers. */
  const missing = (keys) => keys.filter((k) => env[k] !== 'set');
  const describe = (keys) =>
    keys.map((k) => `${k} is ${env[k] === 'empty' ? 'empty' : env[k] === 'absent' ? 'absent' : 'not set'}`).join('; ');

  // --- credentials ---------------------------------------------------------
  const supaMissing = missing(REQUIRED_SUPABASE);
  const supaLevel = add(
    'env_supabase',
    'Supabase credentials',
    supaMissing.length ? LEVELS.ERROR : LEVELS.OK,
    supaMissing.length ? describe(supaMissing) : 'URL and service-role key are set',
    'Copy server/.env.example to server/.env and fill in the two values from Project Settings → API. The SERVICE ROLE key, not the anon key — ingestion has to bypass RLS to write.',
  );

  // WARN, not ERROR, since 2026-09-22: the vendor cloud is optional by the operator's decision of
  // 2026-09-17 (CLAUDE.md, RM-129). Keys come from a key tool's export (`npm run keys:import`),
  // presence from the LAN, the aircon's states from the TCL112 generator. What still needs the
  // cloud is named in the fix, so a reader knows what they are doing without rather than
  // reading "not ready" every day a lapsed trial stays lapsed.
  const tuyaMissing = missing(REQUIRED_TUYA);
  const tuyaLevel = add(
    'env_tuya',
    'Vendor (Tuya) credentials',
    tuyaMissing.length ? LEVELS.WARN : LEVELS.OK,
    tuyaMissing.length ? `${describe(tuyaMissing)} — optional: the cloud is for extracting keys, not a dependency` : 'access id and secret are set',
    'Optional. From the Tuya IoT console: Cloud → Project → Overview. TUYA_ACCESS_SECRET is the most sensitive value in this system — it reaches hardware directly and nothing scopes it. It belongs in server/.env only. Without it: keys come from npm run keys:import, addresses from set-device-ip:pi --from-lan-map; the relay fallback, tuya:devices and tuya:spec stay unavailable.',
  );

  add(
    'env_tuya_region',
    'Vendor data centre',
    env.TUYA_REGION === 'set' ? LEVELS.OK : LEVELS.WARN,
    env.TUYA_REGION === 'set' ? 'TUYA_REGION is set' : 'TUYA_REGION is not set, so the default host is used',
    'Set TUYA_REGION to the data centre the Tuya project is bound to. A wrong host fails as "sign invalid", which is indistinguishable from a bad secret and has cost hours before.',
  );

  const adminMissing = missing(['NODE_RED_ADMIN_USER', 'NODE_RED_ADMIN_PASS']);
  add(
    'env_node_red_admin',
    'Node-RED admin login',
    adminMissing.length ? LEVELS.WARN : LEVELS.OK,
    adminMissing.length ? describe(adminMissing) : 'admin user and password are set',
    'Set both in server/.env, not only in the repo-root .env — the systemd units read server/.env alone. Setting them in the wrong file fails SILENTLY: the enrolment wizard then offers every already-enrolled device as available.',
  );

  // --- database ------------------------------------------------------------
  const dbLevel = add(
    'db_reachable',
    'Database reachable',
    supaLevel === LEVELS.ERROR
      ? LEVELS.SKIPPED
      : database.reachable === true
        ? LEVELS.OK
        : database.reachable === false
          ? LEVELS.ERROR
          : LEVELS.UNCHECKED,
    supaLevel === LEVELS.ERROR
      ? 'not attempted — the credentials above are missing'
      : database.reachable === true
        ? 'the project answered'
        : database.reachable === false
          ? 'the project did not answer'
          : 'not checked',
    'Check SUPABASE_URL is the project URL and that this machine has outbound internet. Note the building keeps running without it — control is local; only history and settings need the database.',
  );

  add(
    'db_site_row',
    'This site exists in the database',
    dbLevel !== LEVELS.OK
      ? LEVELS.SKIPPED
      : database.siteRowFound === true
        ? LEVELS.OK
        : database.siteRowFound === false
          ? LEVELS.ERROR
          : LEVELS.UNCHECKED,
    dbLevel !== LEVELS.OK
      ? 'not attempted — the database was not reached'
      : database.siteRowFound === true
        ? `a sites row for "${siteId}" is present`
        : database.siteRowFound === false
          ? `no sites row for "${siteId}"`
          : 'not checked',
    'Run `npm run site:sql` and paste what it prints — it builds the statement from this site’s own site.mjs, so the id cannot drift from SITE.id. Without the row every site-scoped write is orphaned and nothing else reports the problem.',
  );

  // --- vendor account ------------------------------------------------------
  add(
    'vendor_auth',
    'Vendor account authenticates',
    tuyaLevel !== LEVELS.OK
      ? LEVELS.SKIPPED
      : vendor.authenticated === true
        ? LEVELS.OK
        : vendor.authenticated === false
          ? LEVELS.WARN
          : LEVELS.UNCHECKED,
    tuyaLevel !== LEVELS.OK
      ? 'not attempted — the credentials above are missing'
      : vendor.authenticated === true
        ? 'a token was issued'
        : vendor.authenticated === false
          ? `the console refused the credentials${vendor.error ? ` (${vendor.error})` : ''} — optional; local control, ingest and reports do not need it`
          : 'not checked',
    'Optional since the operator’s decision of 2026-09-17 (RM-129). A refusal is usually the region rather than the secret, or a lapsed IoT Core trial — an unenabled data centre still issues a token and then refuses business calls. Without the cloud: keys come from npm run keys:import, addresses from set-device-ip:pi --from-lan-map; what stays cloud-only is the relay fallback, /api/tuya/presence’s MAC join, tuya:devices and tuya:spec.',
  );

  // --- the local radio segment ---------------------------------------------
  add(
    'network_discovery',
    'Devices visible on this segment',
    network.distinctDevices === null || network.distinctDevices === undefined
      ? LEVELS.UNCHECKED
      : network.distinctDevices > 0
        ? LEVELS.OK
        : LEVELS.ERROR,
    network.distinctDevices === null || network.distinctDevices === undefined
      ? 'not checked'
      : network.distinctDevices > 0
        ? `${network.distinctDevices} device(s) broadcasting`
        : 'no device broadcasts heard',
    'The field devices are 2.4 GHz-only and this machine must sit on the same 2.4 GHz segment, with client isolation off. On a 5 GHz SSID it keeps working internet and remote access while every device reads offline — which looks exactly like a code fault and is not one. Devices broadcast every 5 seconds, so silence for longer than that is real.',
  );

  // --- the bridge ----------------------------------------------------------
  const bridgeLevel = add(
    'bridge_reachable',
    'Node-RED bridge answering',
    bridge.reachable === true ? LEVELS.OK : bridge.reachable === false ? LEVELS.ERROR : LEVELS.UNCHECKED,
    bridge.reachable === true ? 'the readings endpoint answered' : bridge.reachable === false ? 'no answer from the bridge' : 'not checked',
    'Start Node-RED and deploy the generated flow: npm run build:flow, then npm run deploy:pi. Back up ~/.node-red/flows.json first — the tuya nodes carry findTimeout and tuyaVersion values that live only on the host.',
  );

  const expected = bridge.expectedCount ?? null;
  const seen = bridge.deviceCount ?? null;
  add(
    'bridge_fleet',
    'The bridge serves this site’s fleet',
    bridgeLevel !== LEVELS.OK
      ? LEVELS.SKIPPED
      : seen === null || expected === null
        ? LEVELS.UNCHECKED
        : seen >= expected
          ? LEVELS.OK
          : LEVELS.WARN,
    bridgeLevel !== LEVELS.OK
      ? 'not attempted — the bridge did not answer'
      : seen === null || expected === null
        ? 'not checked'
        : `${seen} of ${expected} device(s) reporting`,
    'Fewer devices than the registry describes is ordinary — radios drop and come back. A restart of Node-RED reconnects nodes that have given up, and has taken this fleet from 9 to 14 in one step. Persistent absences are hardware.',
  );

  /**
   * The bridge must not be reachable from anywhere but this machine — ROADMAP FI-019.
   *
   * Node-RED serves the admin API AND every http-in node on one port, and its `uiHost` default
   * is every interface. On this deployment that includes the dedicated 2.4 GHz SSID the field
   * devices sit on, so anything associated to that Wi-Fi could read `/api/devices` and
   * `/api/readings/latest` with no credential at all — verified by fetching both from another
   * host on 2026-09-01, before it was closed.
   *
   * WHY IT IS CHECKED HERE RATHER THAN TRUSTED. `settings.js` is not in this repository, so a
   * rebuild, a restore or a package upgrade restores the permissive default with **no diff and
   * no alarm**. That is the same shape as the tuya nodes' `findTimeout` and the MQTT broker's
   * listener, both of which this project has already been bitten by. A setting that lives only
   * on a host needs something that notices when it goes away.
   *
   * WARN, not ERROR: the deployment genuinely works either way, and a day-one run on a machine
   * that has not been hardened yet should not be told it is broken. It should be told this.
   */
  add(
    'bridge_not_exposed',
    'The bridge is not reachable off this machine',
    bridge.lanExposed === false ? LEVELS.OK : bridge.lanExposed === true ? LEVELS.WARN : LEVELS.UNCHECKED,
    bridge.lanExposed === false
      ? 'bound to loopback'
      : bridge.lanExposed === true
        ? `answering on ${bridge.exposedOn ?? 'a non-loopback address'} with no credential`
        : 'not checked',
    'Set uiHost: "127.0.0.1" in ~/.node-red/settings.js and restart Node-RED. Every legitimate consumer is a process on this machine and already uses that literal address. The editor is then reached with an SSH tunnel — ssh -L 1880:127.0.0.1:1880 <host> — rather than by widening the listener back.',
  );

  // --- services ------------------------------------------------------------
  const down = Object.entries(services).filter(([, state]) => state !== 'active');
  add(
    'services',
    'Background services running',
    Object.keys(services).length === 0
      ? LEVELS.UNCHECKED
      : down.length === 0
        ? LEVELS.OK
        : LEVELS.WARN,
    Object.keys(services).length === 0
      ? 'not checked'
      : down.length === 0
        ? `${Object.keys(services).length} unit(s) active`
        : down.map(([name, state]) => `${name} is ${state ?? 'unknown'}`).join('; '),
    'systemctl status the named unit and read its journal. The dashboard and the bridge run without the daemons; what stops is history, scheduling and alerting.',
  );

  // --- what lives only on the host --------------------------------------------
  // Three more settings with the `uiHost` shape: correct today, kept nowhere in this repository,
  // and lost by a rebuild, a restore or a package upgrade with no diff and no alarm. Each was a
  // real loss before it was a check.

  /**
   * The journal survives a reboot — RM-125. Raspberry Pi OS ships `Storage=volatile` in a drop-in
   * (`40-rpi-volatile-storage.conf`, for SD-card wear), so nothing from before the last reboot
   * survives: the 2026-09-19 meter flip had no witness but the database, and the Pi was rebooted
   * twice that day. `Storage=auto` counts as persistent only when the directory exists, which is
   * why the check wants the journal seen ON DISK and not merely configured.
   */
  const journal = host.journal ?? {};
  const journalKnown = journal.onDisk === true || journal.onDisk === false;
  add(
    'host_journal',
    'The journal survives a reboot',
    !journalKnown ? LEVELS.UNCHECKED : journal.onDisk && ['persistent', 'auto'].includes(journal.storage) ? LEVELS.OK : LEVELS.WARN,
    !journalKnown
      ? 'not checked'
      : journal.onDisk && ['persistent', 'auto'].includes(journal.storage)
        ? `Storage=${journal.storage}, and the system journal is on disk`
        : journal.onDisk
          ? `the journal is on disk but Storage=${journal.storage ?? 'unset'} — the next boot will not write there`
          : `Storage=${journal.storage ?? 'unset'} and nothing on disk — nothing from before the last reboot survives`,
    'Add /etc/systemd/journald.conf.d/50-ibems-persistent.conf with [Journal], Storage=persistent and SystemMaxUse=200M — a drop-in numbered above the OS’s own 40-rpi-volatile-storage.conf, which sets Storage=volatile and overrides the main file. Then mkdir -p /var/log/journal/$(cat /etc/machine-id), systemctl restart systemd-journald, journalctl --flush. Without it the journal cannot explain anything that happened before the last power cut, which is exactly when it is needed.',
  );

  /**
   * The recovery timers are armed — RM-131. `ibems-wifi-prefer` returns the Pi to the device SSID
   * after a boot that beat the access point; `ibems-lan-map` remembers who announced from where;
   * `ibems-fleet-recover` restarts Node-RED when a device is reachable but its node has given up.
   * A timer waiting for its next tick reports `active`; anything else is not armed.
   */
  const timers = host.timers ?? {};
  const timersDown = Object.entries(timers).filter(([, state]) => state !== 'active');
  add(
    'host_timers',
    'Recovery timers armed',
    Object.keys(timers).length === 0 ? LEVELS.UNCHECKED : timersDown.length === 0 ? LEVELS.OK : LEVELS.WARN,
    Object.keys(timers).length === 0
      ? 'not checked'
      : timersDown.length === 0
        ? `${Object.keys(timers).length} timer(s) active`
        : timersDown.map(([name, state]) => `${name} is ${state ?? 'unknown'}`).join('; '),
    'sudo cp server/ibems-*.timer server/ibems-*.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now ibems-wifi-prefer.timer ibems-lan-map.timer ibems-fleet-recover.timer. What each one recovers, and what an outage does without them, is docs/outage-recovery.md.',
  );

  /**
   * Every tuya node has a static address — RM-131. A node without `deviceIp` waits for the
   * device's UDP broadcast, and after the 2026-09-21 outage every switch and outlet stopped
   * broadcasting while still answering TCP — `find() timed out` for a day, with nothing to find.
   * With an address the broadcast never matters. Disabled nodes are not counted: a node that is
   * not started cannot wait for anything.
   */
  const addr = host.addresses ?? {};
  const addrKnown = Number.isFinite(addr.pinned) && Number.isFinite(addr.total);
  const mapWords =
    Number.isFinite(addr.lanMapDevices) && addr.lanMapDevices > 0 && Number.isFinite(addr.lanMapFreshestMs)
      ? `${addr.lanMapDevices} device(s) in the LAN map, freshest ${Math.round(addr.lanMapFreshestMs / 60_000)} min ago`
      : 'nothing in the LAN map yet';
  add(
    'host_addresses',
    'Field devices reached by address',
    !addrKnown ? LEVELS.UNCHECKED : addr.total > 0 && addr.pinned === addr.total ? LEVELS.OK : LEVELS.WARN,
    !addrKnown
      ? 'not checked'
      : addr.total > 0 && addr.pinned === addr.total
        ? `all ${addr.total} node(s) have a static address; ${mapWords}`
        : `${addr.pinned} of ${addr.total} node(s) have a static address — the rest wait for a broadcast; ${mapWords}`,
    'Reading the flow needs NODE_RED_ADMIN_USER and NODE_RED_ADMIN_PASS in server/.env. Then: npm run set-device-ip:pi -- --host=127.0.0.1 --from-lan-map (a dry run; back up ~/.node-red/flows.json, then --apply). The map holds only devices that have announced while ibems-lan-map listened — after a power event that is all of them. Then reserve the addresses on the access point (--reservations prints the table), or the next outage renumbers them.',
  );

  /**
   * Every enabled tuya node is fed a GET poll — RM-134. The tuya node never reads a device's state
   * on connect (`issueGetOnConnect: false` is hard-coded in node-red-contrib-tuya-smart-device), so
   * a device nothing polls shows its last PUSHED value forever: a change it pushed while the bridge
   * was down is never seen, and a channel then at 0 W has nothing new to push. On 2026-09-22 the
   * three meters were the only unpolled nodes, and L.O Yellow held 39.8 W for hours after the lights
   * went off during a reboot. An error rather than a warning: the readings are wrong, not merely less
   * resilient. And the flow lives only on the host, so a restored `flows.json` loses a poller with
   * no diff — which is why this is checked rather than remembered.
   */
  const polls = host.polls ?? null;
  const pollsKnown = polls !== null && Number.isFinite(polls.total) && Array.isArray(polls.unpolled);
  add(
    'flow_polls',
    'Every field device re-read on a timer',
    !pollsKnown ? LEVELS.UNCHECKED : polls.unpolled.length === 0 ? LEVELS.OK : LEVELS.ERROR,
    !pollsKnown
      ? 'not checked'
      : polls.unpolled.length === 0
        ? `all ${polls.total} node(s) are fed a GET poll`
        : `${polls.unpolled.length} of ${polls.total} node(s) are never re-read — ${polls.unpolled.join(', ')} — and show their last pushed value until it changes`,
    'Reading the flow needs NODE_RED_ADMIN_USER and NODE_RED_ADMIN_PASS in server/.env. Each poller is a dry run first; back up ~/.node-red/flows.json, then --apply: npm run poll-meters:pi -- --host=127.0.0.1 (CT meters), poll-outlets:pi (outlets), poll-switches:pi (light switches), aircon:pi (the IR hub\'s poll gate).',
  );

  const errors = checks.filter((c) => c.level === LEVELS.ERROR);
  const warnings = checks.filter((c) => c.level === LEVELS.WARN);
  const unchecked = checks.filter((c) => c.level === LEVELS.UNCHECKED);

  return {
    // Not "no errors". An unchecked item is an open question, and a preflight that answers an
    // open question with "ready" is the one failure this file exists to avoid.
    ready: errors.length === 0 && unchecked.length === 0,
    checks,
    errors,
    warnings,
    unchecked,
  };
}

/** A function node whose source sends the tuya node's GET (or REFRESH) operation. */
const POLL_OPERATION = /operation\s*:\s*['"](GET|REFRESH)['"]/;

/**
 * Which enabled tuya nodes no poll reaches — RM-134. Pure over the flow array, so the CLI reads the
 * flow and this decides. A node counts as polled when a function node that sends the GET operation
 * wires to it: the outlet, switch and meter pollers and the IR hub's poll gate all do. A command
 * formatter wired to the same node is not a poll. A quiesced node (`disableAutoStart`) is not counted.
 */
export function pollCoverage(flows) {
  const nodes = (flows ?? []).filter((n) => n?.type === 'tuya-smart-device' && n.disableAutoStart !== true);
  const polled = new Set();
  for (const n of flows ?? []) {
    if (n?.type !== 'function' || !POLL_OPERATION.test(String(n.func ?? ''))) continue;
    for (const t of (n.wires ?? []).flat()) polled.add(t);
  }
  return { total: nodes.length, unpolled: nodes.filter((n) => !polled.has(n.id)).map((n) => n.deviceName ?? n.name ?? n.id) };
}

// --- CLI ---------------------------------------------------------------------
// Everything below is I/O. It gathers observations and hands them to the pure function above, so
// the verdict table stays testable and this half stays as thin as it can be.
if (process.argv[1] && process.argv[1].endsWith('preflight.mjs')) {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { createSocket } = await import('node:dgram');
  const { execFileSync } = await import('node:child_process');
  const { networkInterfaces } = await import('node:os');
  const { SITE } = await import('../shared/siteConfig.mjs');
  // DEVICE_REGISTRY, not BUILT_IN_DEVICES: the registry is `[...built-in, ...enrolled]`, and a
  // deployment that has added hardware through the enrolment wizard would otherwise be measured
  // against a fleet that stops at whatever the site directory was scaffolded with — excluding
  // exactly the newest devices, which are the ones most likely to be misbehaving.
  //
  // On this deployment the two lists are currently identical at 20, because nothing has been
  // enrolled since the site directory was written. The change is for the site where that is not
  // true, and it is worth writing down that it fixes nothing measurable here today.
  const { DEVICE_REGISTRY } = await import('../shared/registry.mjs');

  const ROOT = join(import.meta.dirname, '..');
  const seconds = Number(process.argv.find((a) => a.startsWith('--listen='))?.slice(9) ?? 8);

  // --- credentials, by name only -------------------------------------------
  // The file is parsed here rather than loaded into process.env: this has to tell an absent key
  // from an empty one, and nothing downstream should be able to print either.
  let fileKeys = {};
  try {
    for (const line of readFileSync(join(ROOT, 'server', '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
      if (m) fileKeys[m[1]] = m[2].trim();
    }
  } catch {
    fileKeys = {};
  }
  const valueOf = (key) => process.env[key] || fileKeys[key] || '';
  const classify = (key) => {
    const raw = process.env[key] ?? fileKeys[key];
    if (raw === undefined) return 'absent';
    return raw === '' ? 'empty' : 'set';
  };
  const env = {};
  for (const key of [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'TUYA_ACCESS_ID',
    'TUYA_ACCESS_SECRET',
    'TUYA_REGION',
    'NODE_RED_ADMIN_USER',
    'NODE_RED_ADMIN_PASS',
  ]) {
    env[key] = classify(key);
  }

  // --- database ------------------------------------------------------------
  const database = { reachable: null, siteRowFound: null };
  if (env.SUPABASE_URL === 'set' && env.SUPABASE_SERVICE_ROLE_KEY === 'set') {
    const url = valueOf('SUPABASE_URL');
    const key = valueOf('SUPABASE_SERVICE_ROLE_KEY');
    try {
      const res = await fetch(`${url}/rest/v1/sites?select=id&id=eq.${encodeURIComponent(SITE.id)}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      });
      database.reachable = res.ok;
      if (res.ok) {
        const rows = await res.json();
        // RLS matching zero rows also answers 200 with an empty array, so length is the only
        // real answer here — the status code cannot distinguish them.
        database.siteRowFound = Array.isArray(rows) && rows.length > 0;
      }
    } catch {
      database.reachable = false;
    }
  }

  // --- vendor account ------------------------------------------------------
  const vendor = { authenticated: null, error: null };
  if (env.TUYA_ACCESS_ID === 'set' && env.TUYA_ACCESS_SECRET === 'set') {
    try {
      const { probeTuyaHost } = await import('../server/tuyaCloud.mjs');
      const probe = await probeTuyaHost({ accessId: valueOf('TUYA_ACCESS_ID'), accessSecret: valueOf('TUYA_ACCESS_SECRET') });
      vendor.authenticated = probe.region !== null;
      // Only the number of data centres tried. The vendor's own error text is not surfaced: it is
      // written by someone else, it can echo an identifier back, and this output is meant to be
      // safe to paste into an issue.
      if (!vendor.authenticated) vendor.error = `${probe.attempts.length} data centre(s) tried, none accepted the credentials`;
    } catch {
      vendor.authenticated = false;
      vendor.error = 'the probe could not be run';
    }
  }

  // --- the local radio segment ---------------------------------------------
  // A passive listen. The devices announce themselves every 5s on UDP 6667 whether or not
  // anything is talking to them, so silence for longer than that is a real answer rather than
  // an absence of evidence.
  const network = { distinctDevices: null };
  const sources = new Set();
  await new Promise((resolve) => {
    let sock;
    try {
      sock = createSocket({ type: 'udp4', reuseAddr: true });
    } catch {
      resolve();
      return;
    }
    const done = () => {
      try {
        sock.close();
      } catch {
        /* already closed */
      }
      resolve();
    };
    sock.on('message', (_msg, rinfo) => sources.add(rinfo.address));
    // A bind failure is "not checked", never "no devices". Node-RED's own tuya nodes may hold the
    // port, and reporting that as silence would accuse the network of a fault it does not have.
    sock.on('error', done);
    sock.bind(6667, () => {
      network.distinctDevices = 0; // the listen really happened, so it can now report a real zero
      setTimeout(done, Math.max(1, seconds) * 1000);
    });
  });
  if (network.distinctDevices !== null) network.distinctDevices = sources.size;

  // --- the bridge ----------------------------------------------------------
  const bridge = { reachable: null, deviceCount: null, expectedCount: DEVICE_REGISTRY.length, lanExposed: null, exposedOn: null };
  try {
    const res = await fetch('http://127.0.0.1:1880/api/readings/latest', { signal: AbortSignal.timeout(10_000) });
    bridge.reachable = res.ok;
    if (res.ok) {
      const body = await res.json();
      const rows = Array.isArray(body) ? body : (body?.readings ?? []);
      bridge.deviceCount = rows.filter((r) => r?.device_id !== '_totals' && r?.online !== false).length;
    }
  } catch {
    bridge.reachable = false;
  }

  /**
   * Is the bridge answering on anything other than loopback? — FI-019.
   *
   * Asked by dialling this machine's OWN non-loopback addresses, which needs no second host and
   * no privilege: if Node-RED is bound to every interface it answers on them, and if it is bound
   * to 127.0.0.1 the connection is refused. That is the whole test.
   *
   * `null` when there is no non-loopback address to try — a machine with nothing but `lo` cannot
   * be exposed, but neither has anything been observed, and this file's one rule is that a check
   * which could not be run is never reported as fine.
   */
  const candidates = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  if (candidates.length > 0) {
    bridge.lanExposed = false;
    for (const address of candidates) {
      try {
        // A short timeout on purpose: a refused connection fails instantly, and anything that
        // hangs is a filtered port rather than an open one. Waiting longer would only make a
        // firewalled deployment slow to report the good news.
        const res = await fetch(`http://${address}:1880/api/devices`, { signal: AbortSignal.timeout(3_000) });
        if (res.ok) {
          bridge.lanExposed = true;
          bridge.exposedOn = address;
          break;
        }
      } catch {
        // Refused or timed out — not exposed on this address. Keep trying the others.
      }
    }
  }

  // --- services ------------------------------------------------------------
  const services = {};
  if (process.platform === 'linux') {
    for (const unit of ['nodered', 'mosquitto', 'ibems-proxy', 'ibems-dashboard', 'ibems-ingest', 'ibems-scheduler']) {
      try {
        services[unit] = execFileSync('systemctl', ['is-active', unit], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch (e) {
        // `is-active` exits non-zero for anything not running, and prints the state on stdout.
        services[unit] = String(e.stdout ?? '').trim() || 'unknown';
      }
    }
  }

  // --- what lives only on the host --------------------------------------------
  const host = { journal: { storage: null, onDisk: null }, timers: {}, addresses: { pinned: null, total: null, lanMapDevices: null, lanMapFreshestMs: null }, polls: null };
  if (process.platform === 'linux') {
    // `cat-config` prints the main file and every drop-in in the order systemd applies them, so
    // the last Storage= line is the one in force — the same rule journald itself uses. Parsing
    // the files by hand would have to reproduce that precedence, and get it wrong quietly.
    try {
      const merged = execFileSync('systemd-analyze', ['cat-config', 'systemd/journald.conf'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const lines = merged.split(/\r?\n/).map((l) => l.match(/^\s*Storage\s*=\s*(\S+)/)).filter(Boolean);
      host.journal.storage = lines.length ? lines[lines.length - 1][1] : 'auto';
      const { existsSync } = await import('node:fs');
      const machineId = readFileSync('/etc/machine-id', 'utf8').trim();
      host.journal.onDisk = existsSync(`/var/log/journal/${machineId}/system.journal`);
    } catch {
      host.journal = { storage: null, onDisk: null };
    }

    // The timers are whatever `server/` ships, so a new one is checked without being listed here.
    const { readdirSync } = await import('node:fs');
    let timerUnits;
    try {
      timerUnits = readdirSync(join(ROOT, 'server')).filter((f) => /^ibems-.*\.timer$/.test(f));
    } catch {
      timerUnits = [];
    }
    for (const unit of timerUnits) {
      try {
        host.timers[unit] = execFileSync('systemctl', ['is-active', unit], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch (e) {
        host.timers[unit] = String(e.stdout ?? '').trim() || 'unknown';
      }
    }
  }

  // The LAN map is read whatever the platform; the flow only with the admin login, and only
  // read. A failure to log in is "not checked", never "none pinned".
  try {
    const { readLanMap } = await import('../server/lanMap.mjs');
    const map = readLanMap();
    const seen = Object.values(map).map((e) => Date.parse(e?.lastSeen ?? '')).filter(Number.isFinite);
    host.addresses.lanMapDevices = Object.keys(map).length;
    host.addresses.lanMapFreshestMs = seen.length ? Date.now() - Math.max(...seen) : null;
  } catch {
    host.addresses.lanMapDevices = null;
  }
  if (env.NODE_RED_ADMIN_USER === 'set' && env.NODE_RED_ADMIN_PASS === 'set' && bridge.reachable === true) {
    try {
      const { createAdminClient } = await import('../node-red-bridge/nodeRedAdmin.mjs');
      process.env.NODE_RED_ADMIN_USER ||= valueOf('NODE_RED_ADMIN_USER');
      process.env.NODE_RED_ADMIN_PASS ||= valueOf('NODE_RED_ADMIN_PASS');
      const admin = createAdminClient({ host: '127.0.0.1', port: 1880, timeoutMs: 10_000 });
      const { flows } = await admin.getFlows(await admin.login());
      const nodes = flows.filter((n) => n?.type === 'tuya-smart-device' && n.disableAutoStart !== true);
      host.addresses.total = nodes.length;
      host.addresses.pinned = nodes.filter((n) => typeof n.deviceIp === 'string' && n.deviceIp.trim() !== '').length;
      host.polls = pollCoverage(flows);
    } catch {
      host.addresses.pinned = null;
      host.addresses.total = null;
      host.polls = null;
    }
  }

  const result = assessDeployment({ siteId: SITE.id, env, database, vendor, network, bridge, services, host });

  const MARK = {
    [LEVELS.OK]: '\x1b[32m  ok  \x1b[0m',
    [LEVELS.WARN]: '\x1b[33m warn \x1b[0m',
    [LEVELS.ERROR]: '\x1b[31mERROR \x1b[0m',
    [LEVELS.UNCHECKED]: '\x1b[36m  ?   \x1b[0m',
    [LEVELS.SKIPPED]: '\x1b[90mskip  \x1b[0m',
  };

  console.log(`preflight: ${SITE.display_name}  (${SITE.id})`);
  console.log(`           listened ${seconds}s for device broadcasts\n`);
  for (const check of result.checks) {
    console.log(`${MARK[check.level]} ${check.title.padEnd(38)} ${check.detail}`);
    if (check.level === LEVELS.ERROR || check.level === LEVELS.UNCHECKED) {
      console.log(`         \x1b[90m-> ${check.fix}\x1b[0m`);
    }
  }

  if (result.ready && result.warnings.length === 0) {
    console.log('\n\x1b[32mThis deployment is ready.\x1b[0m');
  } else if (result.ready) {
    console.log(`\n\x1b[32mReady.\x1b[0m ${result.warnings.length} warning(s) — worth reading, not blocking.`);
  } else {
    const parts = [];
    if (result.errors.length) parts.push(`${result.errors.length} error(s)`);
    if (result.unchecked.length) parts.push(`${result.unchecked.length} unchecked`);
    console.log(`\n\x1b[31m${parts.join(', ')}.\x1b[0m Not ready — and "unchecked" is an open question, not a pass.`);
  }
  console.log('\nNothing was written and nothing was changed. Every fix above is for a person to make.');
  process.exit(result.ready ? 0 : 1);
}
