/**
 * The out-of-dashboard alert channel (FI-005).
 *
 * WHY IT EXISTS: a multi-hour device outage went unnoticed because the only place it would
 * have surfaced was a screen nobody was looking at. On 2026-08-25 six of seven outlets went
 * off the network while the operator was at home, and nothing said so.
 *
 * WHY NTFY: this repository is public, and FI-011 rejected email and Google Sheets delivery
 * for exactly that reason — SMTP credentials and service-account keys have to live somewhere,
 * and "somewhere" on this deployment is a file next to a public checkout. ntfy needs no
 * account and no OAuth: the only secret is a topic name, which is a low-value shared secret
 * rather than a credential that could be replayed against anything else. Someone who guesses
 * the topic can read notifications; they cannot act on the building.
 *
 * NOT CONFIGURED IS NOT BROKEN. With no `NTFY_TOPIC` this is inert and says so once at
 * startup — matching how `buildCloudDispatch` and the Tuya client already treat missing
 * configuration. A deployment that was never given a channel should lose the feature, not
 * fail to boot, and certainly not log an error every minute.
 *
 * NOTIFYING MUST NEVER BREAK INGESTION. Every failure here is caught and logged. The daemon's
 * job is recording the building's electricity; being unable to send a push about that is not
 * a reason to stop doing it.
 */

const DEFAULT_SERVER = 'https://ntfy.sh';

/**
 * @param env  process.env, injected so this is testable without touching the real one
 * @param deps { fetchImpl, log }
 * @returns `{ notify }` — always callable; a no-op when unconfigured
 */
export function createNotifier(env = process.env, { fetchImpl = fetch, log = console.log } = {}) {
  const topic = (env.NTFY_TOPIC ?? '').trim();
  const server = (env.NTFY_SERVER ?? DEFAULT_SERVER).replace(/\/+$/, '');

  if (!topic) {
    return {
      configured: false,
      async notify() {
        // Deliberately silent. Logging per attempt would put a line in the journal every time
        // the fleet changed state on a deployment that never asked for notifications.
      },
    };
  }

  return {
    configured: true,
    /**
     * @param title    one line, shown as the notification heading
     * @param body     the detail
     * @param priority ntfy priority — 'default' or 'high'
     */
    async notify(title, body, priority = 'default') {
      try {
        const res = await fetchImpl(`${server}/${encodeURIComponent(topic)}`, {
          method: 'POST',
          headers: {
            Title: title,
            Priority: priority,
            // Tags render as an emoji in most clients; a glance at a phone should say which
            // kind of event this is before any of the text is read.
            Tags: priority === 'high' ? 'warning' : 'white_check_mark',
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) log(`[ibems-notify] ntfy refused the message (HTTP ${res.status})`);
      } catch (err) {
        // Caught, never rethrown: see the header. Ingestion outranks notification.
        log(`[ibems-notify] could not send: ${String(err?.message ?? err)}`);
      }
    },
  };
}

/**
 * The message for a fleet event. Separated from delivery so the wording — which is the part a
 * person actually reads at 2am — is testable without a network.
 *
 * It names the remedy, for the same reason the alerts bell does: on 2026-08-25 a Node-RED
 * restart recovered five devices that a written diagnosis had called a hardware fault. A
 * notification that only says "something is wrong" costs a trip to the office.
 */
export function fleetMessage(event) {
  if (event.kind === 'recovered') {
    return {
      title: 'iBEMS: devices are reporting again',
      body: 'The devices that had dropped are back online. No action needed.',
      priority: 'default',
    };
  }
  const list = event.devices.join(', ');
  return {
    title: `iBEMS: ${event.devices.length} devices stopped responding`,
    body:
      `${list}\n\n` +
      'Each was reporting earlier. Devices often stop answering because the bridge nodes gave ' +
      'up rather than because the hardware failed — restarting Node-RED on the Pi has ' +
      'recovered exactly this before. If they stay dark afterwards they need power cycling.',
    priority: 'high',
  };
}
