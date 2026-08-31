/**
 * Guards on `scripts/install.sh` — RM-033 / FI-003.
 *
 * An installer is the one script in this repository that runs on somebody else's machine, once,
 * often unattended, usually by someone who has never read it. It cannot be exercised the way the
 * rest of the code is: the apply path needs a fresh Raspberry Pi, and there has only ever been
 * one Pi. So the properties that matter most are asserted against the source instead.
 *
 * These are text checks, deliberately, and the same shape as `envHygiene.test.mjs` and
 * `migration-idempotency.test.mjs`: they cannot prove the install works, only that it has not
 * quietly acquired a behaviour this project has already decided against.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PATH_ = join(ROOT, 'scripts', 'install.sh');
const src = readFileSync(PATH_, 'utf8');
const code = src.replace(/^\s*#.*$/gm, ''); // comments explain the rules; they are not the rules

test('it parses', () => {
  try {
    execFileSync('bash', ['-n', PATH_], { stdio: 'pipe' });
  } catch (err) {
    // A missing bash is not a failing script. Say which happened rather than reporting one as
    // the other — this suite runs on Windows workstations as well as on the Pi.
    if (err.code === 'ENOENT') {
      console.log('    (bash not available here — syntax check skipped, text checks still run)');
      return;
    }
    assert.fail(`scripts/install.sh does not parse:\n${err.stderr?.toString() ?? err.message}`);
  }
});

test('it changes nothing unless asked', () => {
  // The default has to be the safe one. An installer that acts on an argument-less invocation is
  // a machine changed by someone who ran it to see what it did.
  assert.match(code, /^APPLY=0$/m, 'APPLY must default to 0');
  const setsApply = [...code.matchAll(/APPLY=1/g)].length;
  assert.equal(setsApply, 1, 'exactly one thing may set APPLY=1');
  assert.match(code, /--apply\)\s*APPLY=1/, 'and it must be the --apply flag');
});

test('every change goes through the one function that honours the dry run', () => {
  // The dry run is only trustworthy if it cannot diverge from the real run: anything shelling out
  // to sudo outside `act` is a branch someone forgot, and it would act during a "check".
  //
  // Two things have to be handled before scanning, and the first draft of this test got both
  // wrong. Backslash continuations must be joined, or an `act "..." \` line and the `sudo` on the
  // next line look unrelated. And quoted strings must be stripped, or every message containing
  // the word "sudo" — of which this script has four, deliberately — reads as an invocation.
  // ...and heredoc bodies must go too. The closing report TELLS the operator to run
  // `sudo systemctl start ...`; instructions about sudo are not uses of it, and this guard
  // flagged that line until it learned the difference.
  const joined = code.replace(/\\\n\s*/g, ' ').replace(/<<-?'?EOF'?\n[\s\S]*?\nEOF\n/g, '<<EOF\nEOF\n');
  const strays = joined
    .split('\n')
    .map((l, i) => [i + 1, l])
    .map(([n, l]) => [n, l, l.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')])
    .filter(([, , bare]) => /(^|[^_a-zA-Z-])sudo /.test(bare))
    .filter(([, , bare]) => !/^\s*act /.test(bare))
    // `sudo -n true` and `sudo -v` in preflight test FOR sudo without using it; the unit loop
    // calls `sudo install` inside an explicit `if [ "$APPLY" -eq 1 ]` branch.
    .filter(([, , bare]) => !/sudo -n true|sudo -v|sudo install -m/.test(bare))
    .map(([n, l]) => `line ${n}: ${l.trim().slice(0, 90)}`);
  assert.deepEqual(strays, [], 'these call sudo outside act() — a dry run would perform them');
});

test('it never touches Wi-Fi', () => {
  // CLAUDE.md: "Never change the Pi's Wi-Fi remotely. A wrong SSID or credential loses the host
  // with nobody on site to recover it." An installer is exactly where that would creep back in,
  // because joining the device SSID is genuinely part of standing a site up.
  for (const forbidden of ['wpa_supplicant', 'nmcli', 'wpa_cli', 'iwconfig', 'raspi-config']) {
    assert.equal(code.includes(forbidden), false, `install.sh references ${forbidden}`);
  }
});

test('it never opens the MQTT broker past loopback', () => {
  // The broker listened on every interface with anonymous access until EX-131, on the same
  // segment as the field devices. Any listener this script writes must be loopback.
  const listeners = [...code.matchAll(/^\s*listener\s+\d+\s+(\S+)/gm)].map((m) => m[1]);
  assert.ok(listeners.length > 0, 'expected the script to write at least one listener');
  for (const addr of listeners) {
    assert.ok(['127.0.0.1', '::1'].includes(addr), `listener bound to ${addr}, which is not loopback`);
  }
  assert.equal(code.includes('0.0.0.0'), false, 'install.sh mentions 0.0.0.0');
});

test('it writes no secrets and never overwrites an existing env file', () => {
  for (const key of ['SUPABASE_SERVICE_ROLE_KEY', 'TUYA_ACCESS_SECRET', 'BREAK_GLASS_PASSWORD']) {
    assert.equal(code.includes(key), false, `install.sh mentions ${key} — it must never handle credentials`);
  }
  // The env file is created from the example only when absent; the guard is the `if [ -f ... ]`.
  assert.match(code, /if \[ -f "\$HERE\/server\/\.env" \]/, 'server/.env must be created only if absent');
});

test('every systemd unit it installs exists in this repository', () => {
  // The dry run on the real Pi reported `ibems-dashboard.service not in the repo — skipped`,
  // which is how it was noticed that the unit had been running for weeks and was declared
  // nowhere. Four of five services were in the repo; that one was not.
  const units = [...code.matchAll(/^for unit in ([^;]+); do$/gm)].flatMap((m) => m[1].trim().split(/\s+/));
  assert.ok(units.length >= 4, `expected the unit list, parsed ${JSON.stringify(units)}`);
  for (const unit of units) {
    assert.equal(
      existsSync(join(ROOT, 'server', `${unit}.service`)),
      true,
      `${unit}.service is installed by the script but is not in server/`,
    );
  }
});

test('it says plainly where the testing stops', () => {
  // The honest limit, in the file itself rather than only in a commit message nobody will read
  // while holding a Raspberry Pi.
  //
  // The claim this guards has been sharpened rather than dropped. The apply path HAS now been run
  // — in a container, 21 steps, artifacts read back. What has never happened is a run on a real
  // machine, because `systemctl` was stubbed and no unit was ever validated by systemd. Asserting
  // the old blanket "never been run" would now be false; asserting nothing would let the file
  // quietly start implying the services are known to come up. So the guard moved to the part that
  // is still true.
  assert.match(src, /NEVER BEEN RUN END TO\s*#?\s*END ON A REAL MACHINE/i, 'the header must state that no real machine has been installed');
  assert.match(src, /systemctl.{0,40}STUB/is, 'the header must say systemd was never exercised');
});
