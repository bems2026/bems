#!/usr/bin/env bash
# Rehearse `scripts/install.sh` against a machine that has nothing on it — RM-033 / FI-003.
#
# WHY THIS EXISTS. `install.sh` has only ever run on one computer: the Pi that already had every
# package installed. So every "already satisfied" branch was taken and **not one of the "would
# install" branches has ever been exercised** — which is precisely the half a second institution
# runs, on a machine where nothing is present. A dry run that has only been read on a provisioned
# host is a dry run whose interesting path is untested.
#
# `supabase/rehearse.sh` does the same job for migrations: a throwaway container, the real
# artifact, no host touched. This is that, for the installer.
#
# TWO MODES.
#   (default)  the dry run, on a machine with nothing installed. Cheap, safe to repeat, and it
#              exercises detection, arithmetic, quoting and the completeness of the plan.
#   --apply    the real thing. Installs Node, the dependencies, Node-RED, mosquitto, writes
#              server/.env and the systemd units — inside the container, never on this machine.
#              This is the path `docs/replication.md` has always said was untested.
#
# WHAT --apply STILL CANNOT PROVE. A container has no systemd as PID 1, so every `systemctl` call
# fails there and always will. Those steps are named at the end rather than counted as passes —
# the same rule `scripts/preflight.mjs` holds to. What it does prove is everything up to them:
# whether the packages exist under those names, whether the mosquitto config heredoc lands,
# whether the unit files survive being rewritten for a different user and path, whether a clean
# checkout builds.
#
# THE HOST IS NEVER TOUCHED, IN EITHER MODE. Everything runs inside `docker run --rm`. The
# repository is copied in, not mounted, so even a bug that wrote to the checkout could not reach
# this one.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${IMAGE:-debian:bookworm}"
USER_NAME="rehearse"
MODE="dry"
TIMEOUT="${TIMEOUT:-2400}"
for arg in "$@"; do
  case "$arg" in
    --apply) MODE="apply" ;;
    *) printf 'unknown argument: %s\n' "$arg"; exit 2 ;;
  esac
done

red()  { printf '\033[31m%s\033[0m\n' "$1"; }
grn()  { printf '\033[32m%s\033[0m\n' "$1"; }
bold() { printf '\033[1m%s\033[0m\n' "$1"; }

command -v docker >/dev/null 2>&1 || { red "docker is not installed — this rehearsal needs it."; exit 2; }

bold "Rehearsing scripts/install.sh on a bare ${IMAGE}  [${MODE}]"
echo "  the host is not touched: the repo is copied into a --rm container"
[ "$MODE" = apply ] && echo "  --apply: the installer will really run, inside the container only"
echo

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Everything except a short exclude list — NOT an allow-list of the files install.sh "needs".
#
# The first version was an allow-list and it produced a false failure on the first apply run:
# `tsconfig.json` is a project-references stub pointing at `tsconfig.app.json` and
# `tsconfig.node.json`, only the stub was copied, and `npm run build` failed for a reason the
# installer had nothing to do with. A harness that omits a file reports a defect in the thing
# it is testing, which is worse than not testing it.
#
# node_modules and dist stay excluded on purpose: their ABSENCE is the branch that has never been
# exercised, and copying either would skip it again.
mkdir -p "$WORK/repo"
tar -C "$HERE" \
  --exclude=./node_modules --exclude=./.git --exclude=./dist --exclude=./reports \
  --exclude=./server/.env --exclude=./.env --exclude=./.env.local \
  -cf - . 2>/dev/null \
  | tar -C "$WORK/repo" -xf - || { red "could not stage the checkout"; exit 1; }

# server/.env must NOT travel into the container — it holds the live credentials, and install.sh
# takes a different branch depending on whether it exists. Both reasons say remove it.
rm -f "$WORK/repo/server/.env"

cat > "$WORK/entry.sh" <<ENTRY
set -u
MODE="$MODE"
ENTRY
cat >> "$WORK/entry.sh" <<'ENTRY'
# A non-root user with passwordless sudo, because install.sh refuses to run as root — correctly,
# since the services run as an ordinary account.
apt-get update -qq >/dev/null 2>&1
apt-get install -y -qq sudo curl ca-certificates >/dev/null 2>&1
useradd -m -s /bin/bash rehearse
echo 'rehearse ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/rehearse
chmod 0440 /etc/sudoers.d/rehearse
# In the `sudo` GROUP as well, which is how a Raspberry Pi account is actually set up. The first
# apply run had only the sudoers.d rule and step 4 failed with "User rehearse not in sudoers
# group" — a real difference between the two, and the reason install.sh's preflight now checks
# for the group rather than only for sudo working.
usermod -aG sudo rehearse
cp -r /staging /home/rehearse/bems
chown -R rehearse:rehearse /home/rehearse/bems

if [ "$MODE" = apply ]; then
  echo "=== APPLY on a machine with nothing installed ==="
  # `script` gives the installer a tty. Without one the Node-RED installer behaves differently,
  # and a difference introduced by the harness would be indistinguishable from a real finding.
  su rehearse -c 'cd /home/rehearse/bems && bash scripts/install.sh --apply < /dev/null'
  echo "exit=$?"
  echo "=== what actually landed ==="
  echo "-- node:";        su rehearse -c 'command -v node && node -v' 2>&1 | tail -2
  echo "-- serve:";       su rehearse -c 'command -v serve' 2>&1 | tail -1
  echo "-- mosquitto conf:"; cat /etc/mosquitto/conf.d/ibems.conf 2>&1 | head -5
  echo "-- server/.env perms:"; stat -c '%a %n' /home/rehearse/bems/server/.env 2>&1
  echo "-- units installed:"; ls -1 /etc/systemd/system/ibems-*.service 2>&1
  echo "-- one unit, rewritten:"; grep -E '^(User|Group|WorkingDirectory|EnvironmentFile)=' /etc/systemd/system/ibems-dashboard.service 2>&1
  echo "-- dist built:"; ls -1 /home/rehearse/bems/dist/index.html 2>&1
else
  echo "=== dry run on a machine with nothing installed ==="
  su rehearse -c 'cd /home/rehearse/bems && bash scripts/install.sh'
  echo "exit=$?"
fi
ENTRY

timeout "$TIMEOUT" docker run --rm \
  -v "$WORK/repo":/staging:ro \
  -v "$WORK/entry.sh":/entry.sh:ro \
  "$IMAGE" bash /entry.sh 2>&1 | tee "$WORK/out.txt" || true

echo
bold "What this rehearsal could not exercise"
if [ "$MODE" = apply ]; then
  cat <<'GAPS'
  - systemctl daemon-reload / enable / start — a container has no systemd as PID 1, so these
    FAIL here and always will. Their failure says nothing about a real Pi.
  - whether the services actually run, for the same reason.
  Everything else above really happened. These two are not passes.
GAPS
else
  cat <<'GAPS'
  - systemctl (daemon-reload, enable, start) — a container has no systemd as PID 1
  - the Node-RED installer, which checks for Pi hardware
  - anything behind --apply: this was a dry run, which is the point
  These are not passes. They are the part of the installer that still has never been run.
GAPS
fi

echo
if grep -q 'Preflight failed' "$WORK/out.txt"; then
  red "It stopped at preflight. On a bare machine that may be correct — read the FAILs above."
elif [ "$MODE" = apply ]; then
  # Count what the installer itself reported, rather than trusting an exit code that a failing
  # systemctl would dominate.
  #
  # Strip the colour codes FIRST. The first version counted the raw log, where `FAIL` is wrapped
  # in an escape sequence and `did` is not — so it matched every success and no failure, and
  # printed "0 reported FAIL" onto a screen with a FAIL visible on it. A summary that cannot see
  # failures is worse than no summary.
  plain="$WORK/plain.txt"
  sed -e 's/\x1b\[[0-9;]*m//g' "$WORK/out.txt" > "$plain"
  did="$(grep -c '^  did ' "$plain" || true)"
  bad_n="$(grep -c '^  FAIL ' "$plain" || true)"
  printf '%s step(s) performed, %s reported FAIL.\n' "$did" "$bad_n"
  if [ "$bad_n" -gt 0 ]; then
    echo "  the failures were:"
    grep '^  FAIL ' "$plain" | sed -e 's/^/  /'
    echo "  systemctl failures are expected here; anything else is a real finding."
  fi
else
  grn "The dry run completed on a machine with nothing installed."
fi
