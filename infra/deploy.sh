#!/usr/bin/env bash
#
# One-shot deploy. Generates all secrets, writes infra/.env + backend/.env.prod,
# and launches the production stack. Run it on the server from the repo root.
#
#   bash infra/deploy.sh app.yourdomain.com
#
# It will prompt for your Google Maps + LLM API keys (or set them inline:
#   GOOGLE_MAPS_API_KEY=... LLM_API_KEY=... bash infra/deploy.sh app.yourdomain.com )
#
# Re-running is blocked (it would rotate secrets / mismatch the existing DB).
# To intentionally regenerate on a FRESH volume: FORCE=1 bash infra/deploy.sh <domain>
#
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root

command -v docker >/dev/null || { echo "Docker is not installed. Run: curl -fsSL https://get.docker.com | sh"; exit 1; }
command -v openssl >/dev/null || { echo "openssl is required."; exit 1; }

DOMAIN="${1:-}"
[ -z "$DOMAIN" ] && read -rp "Your subdomain (e.g. app.yourdomain.com): " DOMAIN
[ -z "$DOMAIN" ] && { echo "No domain given. Aborting."; exit 1; }
case "$DOMAIN" in
  *yourdomain.com*) echo "Replace 'yourdomain.com' with your real domain."; exit 1 ;;
esac

if { [ -e infra/.env ] || [ -e backend/.env.prod ]; } && [ "${FORCE:-0}" != "1" ]; then
  echo "env files already exist — not overwriting (that would rotate secrets and break the existing DB)."
  echo "For a fresh redeploy on an empty volume: FORCE=1 bash infra/deploy.sh $DOMAIN"
  exit 1
fi

gen()    { openssl rand -hex "$1"; }
fernet() { openssl rand -base64 32 | tr '+/' '-_'; }   # valid urlsafe Fernet key

OWNER_PW=$(gen 24); RW_PW=$(gen 24); SESSION=$(gen 32); ADMIN=$(gen 24); FERNET=$(fernet)

GKEY="${GOOGLE_MAPS_API_KEY:-}"; [ -z "$GKEY" ] && read -rp "Google Maps API key: " GKEY
LKEY="${LLM_API_KEY:-}";         [ -z "$LKEY" ] && read -rp "LLM API key: "        LKEY

# Optional overrides (defaults shown). e.g. MAIL_FROM=hello@yourdomain.com
MAIL_FROM="${MAIL_FROM:-no-reply@$DOMAIN}"
MAIL_FROM_NAME="${MAIL_FROM_NAME:-Trending Table}"

cat > infra/.env <<EOF
POSTGRES_USER=tt_owner
POSTGRES_PASSWORD=$OWNER_PW
PGDATA_DIR=/mnt/pgdata
SITE_ADDRESS=$DOMAIN
EOF

cat > backend/.env.prod <<EOF
CONTROL_DATABASE_URL=postgresql://tt_owner:$OWNER_PW@db:5432/tt_control
APP_DATABASE_URL=postgresql://tt_owner:$OWNER_PW@db:5432/tt_app
MAINTENANCE_DATABASE_URL=postgresql://tt_owner:$OWNER_PW@db:5432/postgres
APP_RW_DATABASE_URL=postgresql://tt_app_rw:$RW_PW@db:5432/tt_app
SESSION_SECRET=$SESSION
APP_SECRET_KEY=$FERNET
COOKIE_SECURE=1
APP_BASE_URL=https://$DOMAIN
ADMIN_KEY=$ADMIN
SMTP_HOST=${SMTP_HOST:-}
SMTP_PORT=${SMTP_PORT:-587}
SMTP_USER=${SMTP_USER:-}
SMTP_PASSWORD=${SMTP_PASSWORD:-}
SMTP_STARTTLS=${SMTP_STARTTLS:-1}
SMTP_SSL=${SMTP_SSL:-0}
MAIL_FROM=$MAIL_FROM
MAIL_FROM_NAME=$MAIL_FROM_NAME
GOOGLE_MAPS_API_KEY=$GKEY
LLM_BASE_URL=https://api.llmbase.ai/v1
LLM_API_KEY=$LKEY
LLM_MODEL=openai/gpt-oss-120b
EOF

chmod 600 infra/.env backend/.env.prod
echo "→ wrote infra/.env and backend/.env.prod"
echo "→ building + launching (first run takes a few minutes)…"
docker compose -f infra/docker-compose.prod.yml up -d --build

cat <<EOF

============================================================
 Deployed.
   App:    https://$DOMAIN
   Admin:  https://$DOMAIN/admin
   ADMIN_KEY (your admin login) → $ADMIN
============================================================
 SMTP is blank, so verification emails only log until you set it.
 Check status:  docker compose -f infra/docker-compose.prod.yml ps
============================================================
EOF
