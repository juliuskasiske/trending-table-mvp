#!/usr/bin/env bash
#
# Run this FROM YOUR MAC (not the server). It securely copies your local,
# gitignored env files (backend/.env.prod + infra/.env) up to the server over
# SSH, then pulls the latest code and relaunches the stack there.
#
#   bash infra/push.sh root@YOUR_SERVER_IP
#
# The env files never touch git — they go straight over the encrypted SSH
# connection to the server only.
#
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root on your Mac

SERVER="${1:-}"
[ -z "$SERVER" ] && { echo "Usage: bash infra/push.sh root@YOUR_SERVER_IP"; exit 1; }

[ -f backend/.env.prod ] || { echo "backend/.env.prod missing locally — create it first."; exit 1; }
[ -f infra/.env ]        || { echo "infra/.env missing locally — create it first."; exit 1; }

REMOTE=trending-table-mvp   # the clone directory on the server (~/trending-table-mvp)

echo "→ copying env files to $SERVER …"
scp backend/.env.prod "$SERVER:$REMOTE/backend/.env.prod"
scp infra/.env        "$SERVER:$REMOTE/infra/.env"

echo "→ pulling code + relaunching on the server (first build takes a few min) …"
ssh "$SERVER" "cd $REMOTE && git pull --ff-only && docker compose -f infra/docker-compose.prod.yml up -d --build"

echo "✓ done → https://app.trending-table.de"
