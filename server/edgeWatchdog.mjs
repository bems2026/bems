/**
 * The off-edge watchdog's configuration — RM-150 (F-034).
 *
 * The check itself runs in the database (supabase/phase51_edge_watchdog.sql), because the point of it
 * is to work when the edge does not. All the edge does is tell the database where to post: the same
 * ntfy topic the edge's own alarms use, taken from server/.env so nobody has to type it.
 */

/** The `edge_watchdog` row for this site, or an error naming what is missing. */
export function watchdogRowFrom(env, siteId) {
  const topic = String(env.NTFY_TOPIC ?? '').trim();
  if (!topic) return { error: 'NTFY_TOPIC is not set in server/.env: the watchdog would have nowhere to post.' };
  if (topic.length > 64) return { error: 'NTFY_TOPIC is longer than 64 characters, which ntfy does not accept.' };
  const server = String(env.NTFY_SERVER ?? '').trim().replace(/\/+$/, '') || 'https://ntfy.sh';
  if (!/^https?:\/\//.test(server)) return { error: 'NTFY_SERVER must start with http:// or https://.' };
  return { row: { site_id: siteId, ntfy_server: server, ntfy_topic: topic } };
}

/** Enough of the topic to recognise it, not enough to post to it: output may be pasted into an issue. */
export function maskTopic(topic) {
  const t = String(topic ?? '');
  return t.length <= 4 ? '****' : `${t.slice(0, 3)}${'*'.repeat(Math.min(8, t.length - 3))}`;
}
