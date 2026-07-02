# Trending Table — backend (FastAPI + Postgres)

Production backend for the Trending Table marketplace. FastAPI + psycopg3 (raw
SQL, no ORM), two Postgres databases: `tt_control` (platform brain) and `tt_app`
(restaurant-private data under Row-Level Security).

## Local setup

Uses the Postgres already running on `localhost:5432`. (Alternatively run the
isolated container in `infra/docker-compose.yml` and repoint `.env`.)

```bash
cd backend
python3.12 -m venv .venv
./.venv/bin/pip install -r requirements.txt
cp .env.example .env            # defaults already target localhost:5432

./.venv/bin/python -m src.db.migrate          # create DBs + role, apply schema
./.venv/bin/uvicorn src.api.app:app --port 8000 --reload
curl -s localhost:8000/healthz                # {"status":"ok", ...}
```

## Layout
```
src/db/connection.py    control / app(tenant) / maintenance connections
src/db/migrate.py       idempotent DB bootstrap + numbered app migrations
src/db/control_schema.sql   control-plane DDL (idempotent)
migrations/app/         numbered, tracked RLS-tenant migrations
src/api/app.py          FastAPI app
infra/                  docker-compose + initdb (optional isolated Postgres)
```
