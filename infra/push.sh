#!/usr/bin/env bash
#
# Run this FROM YOUR MAC (not the server). It securely copies your local,
# gitignored env files (backend/.env.prod + infra/.env) up to the server over
# SSH, then pulls the latest code and relaunches the stack there.
#
#   bash infra/push.sh root@YOUR_SERVER_IP
#
# The env files never touch git — they go straight over the encrypted SSH
# connection to the server only. All three steps share ONE SSH connection, so
# you enter the server password only once.
#
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root on your Mac

SERVER="${1:-}"
[ -z "$SERVER" ] && { echo "Usage: bash infra/push.sh root@YOUR_SERVER_IP"; exit 1; }

[ -f backend/.env.prod ] || { echo "backend/.env.prod missing locally — create it first."; exit 1; }
[ -f infra/.env ]        || { echo "infra/.env missing locally — create it first."; exit 1; }

REMOTE=trending-table-mvp   # the clone directory on the server (~/trending-table-mvp)

# Multiplex all scp/ssh over a single authenticated connection so the password
# (or key passphrase) is asked for exactly once instead of per command.
CTRL="${TMPDIR:-/tmp}/tt-push-$$"
SSH_OPTS=(-o ControlMaster=auto -o "ControlPath=$CTRL" -o ControlPersist=120)
cleanup() { ssh -O exit -o "ControlPath=$CTRL" "$SERVER" 2>/dev/null || true; }
trap cleanup EXIT

echo "→ connecting to $SERVER (enter the password once) …"
ssh "${SSH_OPTS[@]}" "$SERVER" true   # single auth; opens the shared connection

echo "→ copying env files to $SERVER …"
scp "${SSH_OPTS[@]}" backend/.env.prod "$SERVER:$REMOTE/backend/.env.prod"
scp "${SSH_OPTS[@]}" infra/.env        "$SERVER:$REMOTE/infra/.env"

echo "→ pulling code + relaunching on the server (first build takes a few min) …"
ssh "${SSH_OPTS[@]}" "$SERVER" "cd $REMOTE && git pull --ff-only && docker compose -f infra/docker-compose.prod.yml up -d --build"

echo "✓ done → https://app.trending-table.de"
