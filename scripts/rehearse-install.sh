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
# WHAT IT PROVES AND WHAT IT CANNOT. The dry run changes nothing anywhere, so this is cheap and
# safe to repeat. It exercises detection, arithmetic, quoting and the completeness of the plan.
# It does NOT prove the apply path works: `--apply` needs systemd, and a container has no PID 1
# to talk to. Steps that cannot be exercised are listed at the end rather than counted as passes —
# the same rule `scripts/preflight.mjs` holds to.
#
# THE HOST IS NEVER TOUCHED. Everything runs inside `docker run --rm`. The repository is copied
# in, not mounted, so even a bug that wrote to the checkout could not reach this one.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${IMAGE:-debian:bookworm}"
USER_NAME="rehearse"

red()  { printf '\033[31m%s\033[0m\n' "$1"; }
grn()  { printf '\033[32m%s\033[0m\n' "$1"; }
bold() { printf '\033[1m%s\033[0m\n' "$1"; }

command -v docker >/dev/null 2>&1 || { red "docker is not installed — this rehearsal needs it."; exit 2; }

bold "Rehearsing scripts/install.sh on a bare ${IMAGE}"
echo "  the host is not touched: the repo is copied into a --rm container"
echo

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Copy only what install.sh reads. node_modules is deliberately excluded: its ABSENCE is one of
# the branches that has never been exercised, and copying a populated one would skip it again.
mkdir -p "$WORK/repo"
tar -C "$HERE" \
  --exclude=node_modules --exclude=.git --exclude=dist --exclude=reports \
  -cf - package.json package-lock.json scripts server shared src test index.html vite.config.ts tsconfig.json 2>/dev/null \
  | tar -C "$WORK/repo" -xf - || { red "could not stage the checkout"; exit 1; }

# server/.env must NOT travel into the container — it holds the live credentials, and install.sh
# takes a different branch depending on whether it exists. Both reasons say remove it.
rm -f "$WORK/repo/server/.env"

cat > "$WORK/entry.sh" <<'ENTRY'
set -u
# A non-root user with passwordless sudo, because install.sh refuses to run as root — correctly,
# since the services run as an ordinary account.
apt-get update -qq >/dev/null 2>&1
apt-get install -y -qq sudo curl ca-certificates >/dev/null 2>&1
useradd -m -s /bin/bash rehearse
echo 'rehearse ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/rehearse
chmod 0440 /etc/sudoers.d/rehearse
cp -r /staging /home/rehearse/bems
chown -R rehearse:rehearse /home/rehearse/bems
echo "=== dry run on a machine with nothing installed ==="
su rehearse -c 'cd /home/rehearse/bems && bash scripts/install.sh'
echo "exit=$?"
ENTRY

docker run --rm \
  -v "$WORK/repo":/staging:ro \
  -v "$WORK/entry.sh":/entry.sh:ro \
  "$IMAGE" bash /entry.sh 2>&1 | tee "$WORK/out.txt"

echo
bold "What this rehearsal could not exercise"
cat <<'GAPS'
  - systemctl (daemon-reload, enable, start) — a container has no systemd as PID 1
  - the Node-RED installer, which checks for Pi hardware
  - anything behind --apply: this was a dry run, which is the point
  These are not passes. They are the part of the installer that still has never been run.
GAPS

if grep -q 'Preflight failed' "$WORK/out.txt"; then
  echo
  red "The dry run stopped at preflight. On a bare machine that may be correct — read the FAILs above."
else
  echo
  grn "The dry run completed on a machine with nothing installed."
fi
