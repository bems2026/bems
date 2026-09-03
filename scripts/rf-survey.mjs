#!/usr/bin/env node
/**
 * A read-only 2.4 GHz survey, for deciding and then proving an access-point change.
 *
 *     npm run rf:survey            # run it on the Pi, before and after
 *
 * IT WRITES NOTHING AND CHANGES NOTHING. It shells out to `nmcli` and reads `/proc/net/wireless`
 * and the kernel neighbour table. It does not touch the AP, and it cannot: the one action this
 * exists to inform is a change in the access point's own configuration, which is a person's job.
 *
 * WHY IT EXISTS. RM-046 — after a site power cycle, 4 of 20 devices stayed online and the rest
 * associated and dropped continuously. The obvious suspects were all wrong: the Pi's own link
 * logged zero disconnects, the bridge was healthy, and the vendor cloud saw the same flapping,
 * which rules out anything in this repository. What a survey found on 2026-09-03 was the thing
 * nobody had looked at — **the device SSID was on channel 11 with a foreign AP on channel 10 at
 * nearly the same signal**.
 *
 * ADJACENT-CHANNEL INTERFERENCE IS THE DESTRUCTIVE KIND, and this is the point most easily
 * missed. Two APs on the SAME channel hear each other and take turns — CSMA/CA is designed for
 * exactly that, and it degrades gracefully. Two APs on channels 10 and 11 overlap in frequency
 * but CANNOT decode each other, so neither defers: they simply corrupt each other's frames.
 * 2.4 GHz channels are 22 MHz wide at 5 MHz spacing, so only 1, 6 and 11 are mutually clear.
 *
 * It also explains WHICH devices survive, which is the part that makes the diagnosis testable
 * rather than plausible: a strong client close to the AP rides it out, a weak one does not. On
 * this site the Pi sits at about -35 dBm and never dropped, the meters in the panel stayed up,
 * and the switches and outlets spread around the room are the ones that churned.
 *
 * WHAT IT CANNOT SEE, said plainly rather than left implied: the AP's client limit, its DHCP
 * pool, and its association log. Those need the router's own admin page. A clean survey here
 * does not mean the AP is configured correctly — it means the radio environment is not the
 * problem.
 */

import { execFileSync } from 'node:child_process';

const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 30000 });
  } catch {
    return '';
  }
};

/** 2.4 GHz channel centre frequencies, MHz. Channel 14 is Japan-only and deliberately omitted. */
const CENTRE = (ch) => 2407 + ch * 5;
/** A 20 MHz carrier is ~22 MHz wide. Two channels interfere when their spans overlap at all. */
const HALF_WIDTH = 11;

/**
 * How much of a candidate channel's span another AP's span covers, in MHz.
 *
 * Zero means genuinely clear. The full 22 means co-channel, which is the SAFE kind — the radios
 * hear each other and defer. Anything in between is the kind that corrupts frames, and it is
 * scored worst-first below on that basis rather than on raw signal alone.
 */
function overlapMhz(a, b) {
  const lo = Math.max(CENTRE(a) - HALF_WIDTH, CENTRE(b) - HALF_WIDTH);
  const hi = Math.min(CENTRE(a) + HALF_WIDTH, CENTRE(b) + HALF_WIDTH);
  return Math.max(0, hi - lo);
}

export function scoreChannel(candidate, neighbours) {
  let cost = 0;
  for (const n of neighbours) {
    if (n.chan === candidate) {
      // Co-channel: they take turns. Real cost, but an order of magnitude gentler.
      cost += n.signal * 0.1;
      continue;
    }
    const share = overlapMhz(candidate, n.chan) / (HALF_WIDTH * 2);
    if (share > 0) cost += n.signal * share;
  }
  return Math.round(cost);
}

export function parseWifiList(text) {
  const out = [];
  for (const line of text.split('\n')) {
    // nmcli -t escapes colons inside the SSID; splitting from the right avoids that entirely.
    const parts = line.split(':');
    if (parts.length < 3) continue;
    const signal = Number(parts.pop());
    const chan = Number(parts.pop());
    const ssid = parts.join(':');
    if (!Number.isFinite(chan) || !Number.isFinite(signal) || chan < 1 || chan > 14) continue;
    out.push({ ssid: ssid || '<hidden>', chan, signal });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('rf-survey.mjs')) {
  sh('nmcli', ['dev', 'wifi', 'rescan']);
  await new Promise((r) => setTimeout(r, 8000));

  const neighbours = parseWifiList(sh('nmcli', ['-t', '-f', 'SSID,CHAN,SIGNAL', 'dev', 'wifi', 'list']));
  const active = sh('nmcli', ['-t', '-f', 'ACTIVE,SSID,CHAN,SIGNAL', 'dev', 'wifi', 'list'])
    .split('\n').find((l) => l.startsWith('yes:'));
  const mine = active ? parseWifiList(active.slice(4))[0] : null;

  console.log('2.4 GHz SURVEY — read-only, changes nothing\n');

  if (mine) {
    console.log(`This Pi is on "${mine.ssid}", channel ${mine.chan}, signal ${mine.signal}.`);
    const link = sh('cat', ['/proc/net/wireless']).split('\n').find((l) => l.trim().startsWith('wlan0'));
    if (link) {
      const f = link.trim().split(/\s+/);
      console.log(`Link quality ${f[2]}, level ${f[3]} dBm, ${f[8]} frames discarded on retry.`);
      console.log('A strong level here proves nothing about a device across the room — that gap is');
      console.log('the whole reason a survey is needed rather than "the Pi is fine, so the air is fine".');
    }
    console.log();
  }

  const foreign = neighbours.filter((n) => !mine || n.ssid !== mine.ssid);
  console.log(`Other 2.4 GHz networks in earshot: ${foreign.length}`);
  for (const n of [...foreign].sort((a, b) => b.signal - a.signal).slice(0, 10)) {
    console.log(`   ch ${String(n.chan).padStart(2)}  signal ${String(n.signal).padStart(3)}  ${n.ssid}`);
  }
  console.log();

  if (mine) {
    const clashes = foreign
      .filter((n) => n.chan !== mine.chan && overlapMhz(mine.chan, n.chan) > 0)
      .sort((a, b) => b.signal - a.signal);
    if (clashes.length) {
      console.log('ADJACENT-CHANNEL CLASHES with this network — the destructive kind, because these');
      console.log('radios overlap in frequency and cannot hear each other to take turns:');
      for (const n of clashes.slice(0, 5)) {
        console.log(`   ch ${n.chan} vs ours ${mine.chan}: ${overlapMhz(mine.chan, n.chan)} MHz of overlap, signal ${n.signal}  (${n.ssid})`);
      }
      console.log();
    } else {
      console.log('No adjacent-channel clash with this network. The radio environment is not the fault.\n');
    }
  }

  const ranked = [1, 6, 11].map((ch) => ({ ch, cost: scoreChannel(ch, foreign) })).sort((a, b) => a.cost - b.cost);
  console.log('The three non-overlapping channels, worst interference first is worst choice:');
  for (const r of ranked) {
    const flag = mine && r.ch === mine.chan ? '  <- currently in use' : '';
    console.log(`   channel ${String(r.ch).padStart(2)}  interference score ${String(r.cost).padStart(4)}${flag}`);
  }
  console.log(`\nBest available: channel ${ranked[0].ch}.`);
  if (mine && ranked[0].ch !== mine.chan) {
    console.log(`Currently on ${mine.chan}. Moving to ${ranked[0].ch} is the change this survey supports.`);
  }

  console.log('\nNOT VISIBLE FROM HERE, and each needs the router\'s own admin page:');
  console.log('  - the AP\'s maximum associated clients');
  console.log('  - the DHCP pool size and how much of it is leased');
  console.log('  - whether the AP is rejecting associations, and why');
  console.log('A clean survey means the air is not the problem. It does not mean the AP is right.');
}
