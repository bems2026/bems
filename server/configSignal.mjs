/**
 * "The configuration changed — read it again": a file the proxy touches and the scheduler watches.
 * RM-159.
 *
 * WHY. The scheduler read its whole configuration from Supabase every minute — 1,440 requests a day,
 * each a line in the project's log, to notice the handful of changes a week a person makes. Every one
 * of those changes passes the edge first: a setting is saved by a page the edge serves (which then says
 * so, `POST /api/config/changed`), and a person's command is sent through the proxy. So the proxy tells
 * the scheduler, and the scheduler reads when told, plus a slow safety-net read for anything changed
 * some other way (the SQL editor).
 *
 * WHY A FILE. Two processes on one host, and the proxy already writes its state under `server/data/`.
 * A file needs no port, no listener and no protocol; its modification time is the whole message, and
 * a missed touch costs at most one safety-net interval. One writer: the proxy.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Marks the configuration as changed now. Never throws: a lost signal only delays a read. */
export function touchSignal(file, now = new Date()) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${now.toISOString()}\n`);
    fs.utimesSync(file, now, now);
    return true;
  } catch {
    return false;
  }
}

/** When the configuration was last marked changed (epoch ms), or null if it never was. */
export function signalAt(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}
