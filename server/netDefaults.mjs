/**
 * Network defaults every long-running daemon sets before its first request. Imported first, for its
 * side effect: `import './netDefaults.mjs';` is the opening line of `ingest.mjs`, `proxy.mjs` and
 * `scheduler.mjs`, and `netDefaults.test.mjs` fails if it is not.
 *
 * WHY. Node 20 and later connect with "happy eyeballs" (`autoSelectFamily`): each resolved address
 * gets one attempt, and each attempt 250 ms. The Pi's resolver returns IPv6 addresses it has no route
 * for, and those fail at once, so every request rests on its IPv4 attempts — and a TCP SYN lost on the
 * Wi-Fi is not retried until about a second later. One lost packet therefore failed the whole request,
 * as `fetch failed` with `AggregateError [ETIMEDOUT]` naming every address in turn.
 *
 * Measured 2026-09-15: IPv4 connects to Supabase take 41–76 ms when the link is quiet, well inside
 * 250 ms, yet ingest logged "Supabase unreachable" 26–100 times a day all week, in bursts — and one of
 * those bursts was caught failing with exactly that error. The retry and buffering around every write
 * already make a failure harmless; this makes fewer of them happen.
 *
 * WHY 3500 MS. Linux retries an unanswered SYN after 1 s and again 2 s after that, so an attempt of
 * 3.5 s survives two lost packets. Two IPv4 attempts still fit inside fetch's own 10 s connect timeout,
 * and a healthy 50 ms connect finishes long before any of this is reached.
 */
import net from 'node:net';

export const CONNECT_ATTEMPT_TIMEOUT_MS = 3500;

net.setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_TIMEOUT_MS);
