/**
 * Guards server/netDefaults.mjs — the connection-attempt window every daemon gets before its first
 * request.
 *
 * Node's default gives each address 250 ms. On the Pi the IPv6 addresses fail at once and a TCP SYN
 * lost on the Wi-Fi is retried after about a second, so a single lost packet failed a whole request as
 * `fetch failed` / `AggregateError [ETIMEDOUT]` — measured 2026-09-15 against connects that normally
 * take 41–76 ms. These tests pin the wider window, and that each daemon sets it before anything else
 * can open a socket.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CONNECT_ATTEMPT_TIMEOUT_MS } from './netDefaults.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('each connection attempt gets long enough for a retransmitted SYN', () => {
  // Linux retries an unanswered SYN after 1 s and again 2 s later; the window covers both.
  assert.ok(CONNECT_ATTEMPT_TIMEOUT_MS > 3000, `a ${CONNECT_ATTEMPT_TIMEOUT_MS} ms attempt ends before the second retransmit`);
  // And stays inside undici's own 10 s connect timeout across two IPv4 addresses.
  assert.ok(CONNECT_ATTEMPT_TIMEOUT_MS * 2 < 10_000, 'two attempts must fit inside fetch’s connect timeout');
});

test('importing it sets the process-wide default that fetch connects with', () => {
  assert.equal(net.getDefaultAutoSelectFamilyAttemptTimeout(), CONNECT_ATTEMPT_TIMEOUT_MS);
});

test('every long-running daemon imports it first, before any module that could open a socket', () => {
  for (const daemon of ['ingest.mjs', 'proxy.mjs', 'scheduler.mjs']) {
    const source = readFileSync(join(HERE, daemon), 'utf8');
    // `\r?\n`: a Windows checkout has CRLF endings, and a line kept with its `\r` is not the import.
    const firstImport = source.split(/\r?\n/).find((line) => /^import\s/.test(line));
    assert.equal(firstImport, "import './netDefaults.mjs';", `${daemon} imports something before netDefaults: ${firstImport}`);
  }
});
