-- tt_app — restaurant-PRIVATE data, one shared database isolated per tenant by
-- Row-Level Security. Every table carries tenant_id (= tt_control.restaurants.id).
-- The app connects as the non-owner role tt_app_rw and runs
-- `SET app.current_tenant = <id>`; the policies below then scope every query to
-- that one restaurant. A connection with the GUC unset sees nothing.

CREATE TABLE IF NOT EXISTS restaurant_profiles (
    tenant_id      BIGINT PRIMARY KEY,
    place_id       TEXT,
    name           TEXT NOT NULL DEFAULT '',
    address        TEXT,
    city           TEXT,
    category       TEXT,
    tags           TEXT[] NOT NULL DEFAULT '{}',
    google_rating  NUMERIC(3, 2),
    google_reviews INTEGER,
    description    TEXT,
    website        TEXT,
    logo_url       TEXT,
    photo_ref      TEXT,
    price_level    TEXT,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menu_items (
    id         BIGSERIAL PRIMARY KEY,
    tenant_id  BIGINT NOT NULL,
    section    TEXT,
    name       TEXT NOT NULL,
    price      TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    source     TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('llm', 'heuristic', 'manual')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS menu_items_tenant_idx ON menu_items (tenant_id, sort_order);

CREATE TABLE IF NOT EXISTS content_guidelines (
    tenant_id    BIGINT PRIMARY KEY,
    show         TEXT[] NOT NULL DEFAULT '{}',
    must_include TEXT[] NOT NULL DEFAULT '{}',
    avoid        TEXT[] NOT NULL DEFAULT '{}',
    handle       TEXT,
    notes        TEXT,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menu_sources (
    tenant_id    BIGINT PRIMARY KEY,
    kind         TEXT CHECK (kind IN ('pdf', 'link')),
    url          TEXT,
    engine       TEXT,
    item_count   INTEGER,
    digitized_at TIMESTAMPTZ
);

-- Enable + FORCE RLS and a single tenant-isolation policy on each table.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['restaurant_profiles', 'menu_items', 'content_guidelines', 'menu_sources'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I'
      ' USING (tenant_id = current_setting(''app.current_tenant'', true)::bigint)'
      ' WITH CHECK (tenant_id = current_setting(''app.current_tenant'', true)::bigint)', t);
  END LOOP;
END $$;

-- The app role gets CRUD but is NOT the owner, so RLS applies to it.
GRANT USAGE ON SCHEMA public TO tt_app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tt_app_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tt_app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tt_app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO tt_app_rw;
