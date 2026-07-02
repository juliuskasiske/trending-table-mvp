# Deploying to a Hetzner box

Single-box Docker Compose deploy: **Postgres (on an attached Volume) + FastAPI +
Caddy** (serves the SPA, proxies `/api`, auto-HTTPS). DNS via Cloudflare.

## 1. Provision the server + volume

- **Server:** Hetzner Cloud → create a **`CAX11`** (2 vCPU ARM, 4 GB RAM) — the
  cheapest tier that fits this stack (~€3.79/mo). Image: Ubuntu 24.04.
- **Volume:** create a **10 GB Volume in the same location** and attach it to the
  server. This holds the Postgres data, independent of the box.
- **Firewall:** allow inbound **22, 80, 443**.

Mount the volume (its device path is stable under `/dev/disk/by-id/`):

```bash
ls -l /dev/disk/by-id/ | grep HC_Volume        # find scsi-0HC_Volume_XXXXXXXX
mkfs.ext4 -F /dev/disk/by-id/scsi-0HC_Volume_XXXXXXXX   # ONLY on a brand-new volume
mkdir -p /mnt/pgdata
# persist the mount (use the by-id path, not /dev/sdb which can move):
echo '/dev/disk/by-id/scsi-0HC_Volume_XXXXXXXX /mnt/pgdata ext4 discard,nofail,defaults 0 0' >> /etc/fstab
mount -a
```

## 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
```

## 3. Get the code + configure

```bash
git clone https://github.com/juliuskasiske/trending-table-mvp.git
cd trending-table-mvp/mvp        # (repo layout: the app lives in mvp/)

cp infra/.env.example infra/.env
cp backend/.env.prod.example backend/.env.prod
```

Edit **`infra/.env`** — set `POSTGRES_PASSWORD`, `SITE_ADDRESS=app.yourdomain.com`,
and keep `PGDATA_DIR=/mnt/pgdata`.

Edit **`backend/.env.prod`**:

- Put the **same** owner DB password into the three `tt_owner:...@db:5432/...`
  URLs, and a **separate strong password** in `APP_RW_DATABASE_URL`
  (`tt_app_rw:...`) — the migration runner creates/syncs that role to it.
- Generate secrets:
  ```bash
  openssl rand -hex 32                      # -> SESSION_SECRET
  openssl rand -hex 24                      # -> ADMIN_KEY (>= 16 chars)
  openssl rand -hex 24                      # -> APP_RW password
  python3 -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"  # -> APP_SECRET_KEY
  ```
- `COOKIE_SECURE=1` and `APP_BASE_URL=https://app.yourdomain.com`.
- `ADMIN_KEY` is the single key you enter at `/admin` (no email/account login).
- **SMTP** — fill in a provider so verification emails actually send (Resend,
  Postmark, Mailgun, SES, or a Gmail app password). Leave `SMTP_HOST` blank and
  emails are only logged.
- `GOOGLE_MAPS_API_KEY`, `LLM_*` as in dev.

> The backend **refuses to start** in production (`COOKIE_SECURE=1`) if
> `SESSION_SECRET`, `APP_SECRET_KEY`, `ADMIN_KEY`, or `APP_BASE_URL` are weak,
> missing, or non-HTTPS — a misconfigured deploy fails loudly instead of running
> insecurely.

## 4. DNS (Cloudflare)

Your nameservers are already on Cloudflare, so **checkdomain needs no changes**.
In the Cloudflare dashboard → **DNS → Add record**:

- Type **A**, Name **`app`**, IPv4 = your Hetzner IP.
- **Proxy status: DNS only (grey cloud)** — lets Caddy get its own Let's Encrypt
  cert on first boot.

## 5. Launch

```bash
docker compose -f infra/docker-compose.prod.yml up -d --build
```

The backend waits for Postgres to be healthy, runs migrations (creates
`tt_control` + `tt_app` + the `tt_app_rw` role on the volume), then serves. Caddy
fetches a TLS cert for `SITE_ADDRESS` automatically.

Check it:

```bash
docker compose -f infra/docker-compose.prod.yml ps
curl -s https://app.yourdomain.com/api/config        # feature flags
docker compose -f infra/docker-compose.prod.yml logs -f backend
```

- App: `https://app.yourdomain.com` → sign up → you get a verification email.
- **Control tower:** `https://app.yourdomain.com/admin` → enter your `ADMIN_KEY`.

## 6. Going through Cloudflare's proxy later (optional)

To put Cloudflare's CDN/DDoS in front, flip the record to **Proxied (orange)** and
set SSL/TLS mode to **Full (strict)**. Then either install a **Cloudflare Origin
Certificate** in Caddy, or switch Caddy to the DNS-01 challenge with a Cloudflare
API token. Don't use "Flexible" (that leaves origin traffic on HTTP).

## Operating it

- **Update:** `git pull && docker compose -f infra/docker-compose.prod.yml up -d --build`
- **Backups:** snapshot the Hetzner Volume, or `pg_dump`:
  ```bash
  docker compose -f infra/docker-compose.prod.yml exec db \
    pg_dump -U tt_owner tt_control > control-$(date +%F).sql
  docker compose -f infra/docker-compose.prod.yml exec db \
    pg_dump -U tt_owner tt_app > app-$(date +%F).sql
  ```
- **Logs:** `docker compose -f infra/docker-compose.prod.yml logs -f backend`
- **Rough cost:** CAX11 ~€3.79 + IPv4 ~€0.50 + 10 GB volume ~€0.44 ≈ **€4.75/mo**.

## Subdomains

Want the app at `get.yourdomain.com` instead? Change the Cloudflare record name
and set `SITE_ADDRESS` + `APP_BASE_URL` to match, then `up -d --build`.

## Security notes

What's already in place:

- **Secrets** live only in `backend/.env.prod` / `infra/.env` (both gitignored;
  `.dockerignore` keeps them out of the images — env is injected at runtime, not
  baked in). No secret has ever been committed.
- **Fail-closed:** the API refuses to boot in prod with weak/missing
  `SESSION_SECRET`, `APP_SECRET_KEY`, `ADMIN_KEY`, or a non-HTTPS `APP_BASE_URL`.
- **At rest:** passwords are argon2id, email/verify tokens are SHA-256-hashed,
  social OAuth tokens are Fernet-encrypted (`APP_SECRET_KEY`). The API never
  returns hashes or tokens.
- **Postgres** publishes **no host port** — it's reachable only on the internal
  Docker network; the `tt_app_rw` role uses the strong password you set. RLS
  isolates each restaurant's private data.
- **Edge:** Caddy terminates TLS (auto Let's Encrypt) and sends HSTS,
  `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, and a
  `Permissions-Policy`. The backend container runs as a non-root user.
- **Auth:** httponly + `Secure` + SameSite=Lax session cookie, plus failed-login
  lockout. The control tower is a single `ADMIN_KEY` (constant-time compared).

Your operational responsibilities:

- Keep `.env.prod` off the box's backups/screen-shares; rotate `ADMIN_KEY` and
  `SESSION_SECRET` if leaked (rotating `SESSION_SECRET` logs everyone out;
  rotating `APP_SECRET_KEY` invalidates stored social tokens — re-link needed).
- Restrict the `GOOGLE_MAPS_API_KEY` (HTTP-referrer/IP + Places API only) in the
  Google console, and use test/restricted keys until launch.
- Keep the server patched (`apt upgrade`, `docker compose pull` for base images).
- The `ADMIN_KEY` is sent from the browser over HTTPS and kept in localStorage —
  fine for a solo owner tool; if you want it tighter later, add IP-allowlisting
  on `/api/admin/*` or move to per-user admin logins.
