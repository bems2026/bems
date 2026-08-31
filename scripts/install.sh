#!/usr/bin/env bash
#
# iBEMS installer for a fresh Raspberry Pi — RM-033 / FI-003, Milestone 6.
#
#     ./scripts/install.sh              # check and plan. Changes NOTHING.
#     ./scripts/install.sh --apply      # do it
#
# WHY A SCRIPT AND NOT AN IMAGE. An image is easier to hand over once and stale from the moment
# anything changes; this stays current with the repository, is reviewable line by line, and works
# on hardware nobody imaged. The trade is that the recipient needs a booted Pi and a terminal.
#
# DRY RUN BY DEFAULT, which is the same shape `set-device-ip:pi` uses and is not a formality: this
# installs system packages, writes systemd units and starts services on somebody else's machine.
# Read the plan first.
#
# IDEMPOTENT. Every step checks before acting, so a re-run after a failure resumes rather than
# duplicating. Nothing here overwrites a file that already has real content — `server/.env` in
# particular is created only if absent, never rewritten.
#
# WHAT IT DELIBERATELY WILL NOT DO, each for a reason this project has already paid for:
#
#   * IT NEVER TOUCHES WI-FI. `CLAUDE.md`: "Never change the Pi's Wi-Fi remotely. A wrong SSID or
#     credential loses the host with nobody on site to recover it." Joining the device SSID is a
#     person's job, on site, and it is step 1 of the manual list this prints at the end.
#   * IT NEVER OPENS THE MQTT BROKER BEYOND LOOPBACK. The broker listened on every interface with
#     anonymous access until 2026-08-26, on the same segment as the field devices. If mosquitto is
#     already configured here, this leaves it alone entirely; if it is installing it fresh, it
#     writes a loopback-only listener.
#   * IT WRITES NO SECRETS. It creates `server/.env` from the example with empty values and tells
#     you what to fill in. A script that took credentials as arguments would put them in shell
#     history and in this machine's logs.
#   * IT DOES NOT DEPLOY THE NODE-RED FLOW. That writes to a live flow file and wants a backup
#     taken first; `npm run deploy:pi` owns it, and it is on the manual list.
#
# TESTED: the check path, on a running Pi (2026-08-31). THE APPLY PATH HAS NEVER BEEN RUN END TO
# END on a fresh machine — there has not been a second Pi to run it on. Treat the first real
# install as the test, run the check first, and read the plan.

set -euo pipefail

APPLY=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --check|--dry-run) APPLY=0 ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="$(id -un)"
RUN_GROUP="$(id -gn)"
NODE_MAJOR_WANTED=22

ok()   { printf '  \033[32mok\033[0m    %s\n' "$1"; }
warn() { printf '  \033[33mwarn\033[0m  %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAILED=1; }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
plan() { printf '  would  %s\n' "$1"; }
did()  { printf '  did    %s\n' "$1"; }

# Runs a command, or prints it, depending on --apply. Everything that changes the machine goes
# through here — so the dry run cannot diverge from the real run by someone forgetting a branch.
act() {
  local what="$1"; shift
  if [ "$APPLY" -eq 1 ]; then
    local log; log="$(mktemp)"
    if "$@" >"$log" 2>&1; then
      did "$what"
      rm -f "$log"
    else
      bad "$what"
      # Show why. This used to discard the output entirely, so a failing step told the operator
      # only that it had failed — at the one moment they need the error most, standing in an
      # unfamiliar building. Found by rehearsing the apply path in a container: the build broke
      # and the run reported four words about it. Tail rather than all of it, because a failing
      # npm install can be thousands of lines and the end is the part that says why.
      sed -e 's/^/         /' "$log" | tail -20
      rm -f "$log"
      return 1
    fi
  else
    plan "$what"
  fi
}

FAILED=0

# =============================================================================
step "1. Preflight — nothing here changes anything"
# =============================================================================

if [ "$(id -u)" -eq 0 ]; then
  bad "running as root. The services run as an ordinary user; run this as that user (it will sudo where it must)."
else
  ok "running as $RUN_USER, not root"
fi

if command -v apt-get >/dev/null 2>&1; then
  ok "apt-based system ($(. /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-unknown}"))"
else
  bad "no apt-get. This script targets Raspberry Pi OS / Debian / Ubuntu."
fi

if sudo -n true 2>/dev/null; then
  ok "passwordless sudo available"
elif sudo -v 2>/dev/null; then
  ok "sudo available (will prompt)"
else
  bad "no sudo. System packages and systemd units need it."
fi

# Membership in the `sudo` GROUP is a different fact from sudo working, and step 4 needs the
# group specifically: the official Node-RED installer tests group membership and exits with
# "User <name> not in sudoers group" regardless of whether sudo itself is configured. A machine
# granted sudo through a /etc/sudoers.d rule therefore passes the check above and fails four
# steps later, after the packages and the build have already been installed.
#
# Found by rehearsing the apply path in a container, where exactly that combination existed. A
# warning rather than a FAIL: the account may legitimately be an administrator through another
# group, and this script should not refuse to run on a machine it has only guessed about.
if id -nG 2>/dev/null | tr ' ' '\n' | grep -qx sudo; then
  ok "in the 'sudo' group (step 4's Node-RED installer requires it)"
else
  warn "not in the 'sudo' group. sudo working is not the same thing: the Node-RED installer in step 4 checks group membership and will exit. Add with: sudo usermod -aG sudo $RUN_USER, then log out and back in."
fi

if curl -fsS -m 10 https://registry.npmjs.org/ >/dev/null 2>&1; then
  ok "internet reachable (npm registry)"
else
  bad "cannot reach the npm registry. This install needs the internet; the RUNNING system does not."
fi

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  # `package.json` declares `engines: >=22 <25`. RM-022 is the scar behind checking: five tests
  # passed on one Node version and failed on another, and nothing had declared which was expected.
  if [ "$NODE_MAJOR" -ge 22 ] && [ "$NODE_MAJOR" -lt 25 ]; then
    ok "node $(node -v) satisfies engines >=22 <25"
  else
    warn "node $(node -v) is outside engines >=22 <25 — will install Node ${NODE_MAJOR_WANTED}"
  fi
else
  warn "node not installed — will install Node ${NODE_MAJOR_WANTED}"
fi

AVAIL_MB="$(df -Pm "$HERE" | awk 'NR==2 {print $4}')"
if [ "${AVAIL_MB:-0}" -ge 2048 ]; then
  ok "${AVAIL_MB} MB free on the checkout's filesystem"
else
  warn "only ${AVAIL_MB} MB free. node_modules plus a build wants ~2 GB."
fi

if [ -f "$HERE/package.json" ] && [ -d "$HERE/shared" ]; then
  ok "running from a checkout at $HERE"
else
  bad "not a checkout — expected package.json and shared/ beside scripts/"
fi

if [ "$FAILED" -ne 0 ]; then
  printf '\n\033[31mPreflight failed. Nothing was changed.\033[0m Fix the FAILs above and run again.\n'
  exit 1
fi

# =============================================================================
step "2. Node ${NODE_MAJOR_WANTED}"
# =============================================================================
NODE_MAJOR="$(command -v node >/dev/null 2>&1 && node -p 'process.versions.node.split(".")[0]' || echo 0)"
if [ "$NODE_MAJOR" -ge 22 ] && [ "$NODE_MAJOR" -lt 25 ]; then
  ok "already satisfied"
else
  # NodeSource rather than the distribution's package: Raspberry Pi OS ships a Node far older
  # than this project's floor, and the version mismatch is exactly RM-022's failure mode.
  act "add the NodeSource repository for Node ${NODE_MAJOR_WANTED}" \
    bash -c "curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR_WANTED}.x | sudo -E bash -"
  act "apt-get install nodejs" sudo apt-get install -y nodejs
fi

# =============================================================================
step "3. The application"
# =============================================================================
if [ -d "$HERE/node_modules" ]; then
  ok "node_modules present (re-run 'npm ci' by hand to refresh)"
else
  act "npm ci" bash -c "cd '$HERE' && npm ci"
fi
act "npm run build (tsc + vite)" bash -c "cd '$HERE' && npm run build"

if command -v serve >/dev/null 2>&1; then
  ok "'serve' present ($(command -v serve))"
else
  act "npm install -g serve  (the dashboard unit runs /usr/bin/serve)" sudo npm install -g serve
fi

# =============================================================================
step "4. Node-RED and the Tuya node"
# =============================================================================
if command -v node-red >/dev/null 2>&1; then
  ok "node-red present"
else
  act "install Node-RED (official Pi script, --confirm-install --node22 --no-init)" \
    bash -c "curl -sL https://raw.githubusercontent.com/node-red/linux-installers/master/deb/update-nodejs-and-nodered | bash -s -- --confirm-install --confirm-pi --no-init"
fi

if [ -d "$HOME/.node-red/node_modules/node-red-contrib-tuya-smart-device" ]; then
  ok "node-red-contrib-tuya-smart-device present"
else
  act "install node-red-contrib-tuya-smart-device" \
    bash -c "cd '$HOME/.node-red' && npm install node-red-contrib-tuya-smart-device"
fi

# =============================================================================
step "5. MQTT broker — loopback only"
# =============================================================================
# Only relevant for RM-026's inverter bridge. Installed loopback-only or left entirely alone;
# see this file's header for why widening it is reinstating a problem rather than configuring a
# feature.
# `command -v mosquitto` is NOT the test, and the dry run on a real Pi is what proved it: the
# binary lives in /usr/sbin, which is not on an ordinary user's PATH, so the check said "not
# installed" on a machine that has had it installed and hand-hardened for weeks. This script
# would then have written a SECOND listener config beside the existing one. Presence is checked
# where the package actually leaves evidence.
mosquitto_present() {
  [ -d /etc/mosquitto ] || [ -x /usr/sbin/mosquitto ] || command -v mosquitto >/dev/null 2>&1     || systemctl list-unit-files 2>/dev/null | grep -q '^mosquitto\.service'
}

if [ -f /etc/mosquitto/conf.d/ibems.conf ]; then
  ok "mosquitto already configured by a previous run — left untouched"
elif mosquitto_present; then
  warn "mosquitto is installed and configured by someone else. Leaving it alone. Confirm it is NOT listening beyond loopback: 'ss -lntp | grep 1883'"
else
  act "apt-get install mosquitto" sudo apt-get install -y mosquitto
  act "write a loopback-only listener to /etc/mosquitto/conf.d/ibems.conf" \
    sudo tee /etc/mosquitto/conf.d/ibems.conf <<<'# iBEMS: loopback only. See scripts/install.sh and CLAUDE.md before changing.
listener 1883 127.0.0.1
listener 1883 ::1
allow_anonymous true'
  act "enable mosquitto" sudo systemctl enable --now mosquitto
fi

# =============================================================================
step "6. server/.env — created empty if absent, NEVER overwritten"
# =============================================================================
if [ -f "$HERE/server/.env" ]; then
  ok "server/.env exists — left exactly as it is"
else
  act "copy server/.env.example to server/.env (values blank; fill them in yourself)" \
    cp "$HERE/server/.env.example" "$HERE/server/.env"
  act "chmod 600 server/.env" chmod 600 "$HERE/server/.env"
fi

# =============================================================================
step "7. systemd units"
# =============================================================================
# The units in server/ name this project's original account and path. They are rewritten for
# whoever is running this, so a deployment under a different user or checkout works unedited.
for unit in ibems-dashboard ibems-proxy ibems-ingest ibems-scheduler; do
  src="$HERE/server/$unit.service"
  [ -f "$src" ] || { warn "$unit.service not in the repo — skipped"; continue; }
  if [ "$APPLY" -eq 1 ]; then
    tmp="$(mktemp)"
    sed -e "s|^User=.*|User=$RUN_USER|" \
        -e "s|^Group=.*|Group=$RUN_GROUP|" \
        -e "s|^WorkingDirectory=.*|WorkingDirectory=$HERE|" \
        -e "s|^EnvironmentFile=.*|EnvironmentFile=$HERE/server/.env|" "$src" > "$tmp"
    sudo install -m 0644 "$tmp" "/etc/systemd/system/$unit.service" && did "install $unit.service (User=$RUN_USER, WorkingDirectory=$HERE)"
    rm -f "$tmp"
  else
    plan "install $unit.service rewritten for User=$RUN_USER, WorkingDirectory=$HERE"
  fi
done
act "systemctl daemon-reload" sudo systemctl daemon-reload

# =============================================================================
step "8. Start the services"
# =============================================================================
# The dashboard is started; the three that talk to Supabase are ENABLED but not started, because
# server/.env has no credentials yet and a service that fails on boot four times and gives up is
# a worse first impression than one that was never asked to run.
act "enable + start ibems-dashboard" sudo systemctl enable --now ibems-dashboard
for unit in ibems-proxy ibems-ingest ibems-scheduler; do
  act "enable $unit (NOT started — needs server/.env first)" sudo systemctl enable "$unit"
done

# =============================================================================
step "Done. What is still yours to do — none of it can be scripted safely"
# =============================================================================
cat <<EOF
  1. NETWORK. Join this Pi to the 2.4 GHz segment the Tuya devices are on, on the machine
     itself. The devices are 2.4 GHz-only, and a Pi on a 5 GHz SSID has working internet while
     every device reads offline — which looks like a code fault and is not. This script will
     never touch Wi-Fi: a wrong credential entered remotely loses the host.

  2. CREDENTIALS. Fill in $HERE/server/.env — Supabase URL and keys, and the Tuya cloud
     credentials. Then: sudo systemctl start ibems-proxy ibems-ingest ibems-scheduler

  3. YOUR SITE. npm run site:new -- <your-building-slug>, then follow docs/replication.md.
     Until you do, this deployment describes somebody else's building.

  4. DATABASE. Create a Supabase project and apply supabase/*.sql in filename order, UNEDITED.
     Both files name this project's original site id, and neither needs changing: phase20's
     backfill matches nothing on a fresh database and the defaults it sets are dropped again by
     phase22. Then add your own row with: npm run site:sql  (it prints one statement; it
     executes nothing).

  5. THE FLOW. npm run build:flow, back up ~/.node-red/flows.json, then npm run deploy:pi.
     Deploying a flow is not scripted here on purpose — it writes to a live file.

  6. VERIFY. npm run preflight — credentials, database, vendor account, the radio segment, the
     bridge, the services — then npm run verify:pi, and read the live system back. A green test
     suite is not proof; this project has that written down twice, both times earned.

  7. TWO UNITS THIS SCRIPT DELIBERATELY DID NOT INSTALL, if you want them:
     server/ibems-kiosk.service     — the on-site display. A --user unit, because it has to run
                                      inside the logged-in graphical session; install it as that
                                      user, not with sudo. See its own header.
     server/ibems-wifi-prefer.service + .timer — returns the Pi to its preferred network. Not
                                      installed here because this script never touches Wi-Fi.
     Both carry their own instructions at the top of the file.
EOF

if [ "$APPLY" -eq 0 ]; then
  printf '\n\033[1mThis was a dry run. Nothing changed.\033[0m Re-run with --apply to perform it.\n'
fi
