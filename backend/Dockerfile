# Trending Table API — FastAPI + psycopg3.
FROM python:3.12-slim

# psql is needed by the migration runner (applies the .sql files); the others
# are runtime niceties. Kept minimal for a small image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Drop root: run as an unprivileged user (the app writes nothing to disk).
RUN useradd --create-home --uid 10001 appuser && chown -R appuser /app
USER appuser

EXPOSE 8000

# Apply migrations (idempotent: creates DBs + tt_app_rw role, runs pending SQL),
# then serve. The DB is waited on via the compose healthcheck before this runs.
CMD ["sh", "-c", "python -m src.db.migrate && exec uvicorn src.api.app:app --host 0.0.0.0 --port 8000"]
