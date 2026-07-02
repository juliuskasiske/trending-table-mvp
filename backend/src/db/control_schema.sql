-- Trending Table CONTROL PLANE schema.
--
-- This database is SHARED across all tenants but holds no restaurant-private
-- data (that lives in tt_app under RLS). It holds identities, the marketplace
-- graph, billing, and audit. Applied wholesale on every migrate run, so it must
-- stay idempotent (IF NOT EXISTS / additive ALTERs only).
--
-- Phase 1: bookkeeping only. Identities/marketplace/billing tables land in the
-- phases that follow.

CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Identities & auth
-- ----------------------------------------------------------------------------
-- Two identity tables — one per side of the marketplace. Same auth machinery
-- (argon2id password, email verification, lockout) but different profiles and
-- permissions. Passwords are never stored in the clear.
-- ============================================================================

-- Restaurant operators (the login on the restaurant side).
CREATE TABLE IF NOT EXISTS accounts (
    id                BIGSERIAL PRIMARY KEY,
    email             TEXT NOT NULL UNIQUE,
    password_hash     TEXT NOT NULL,                 -- argon2id
    display_name      TEXT,
    email_verified_at TIMESTAMPTZ,                   -- NULL until the verify link is used
    failed_attempts   INTEGER NOT NULL DEFAULT 0,
    locked_until      TIMESTAMPTZ,                   -- brute-force backoff
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Creators (the other side).
CREATE TABLE IF NOT EXISTS creators (
    id                BIGSERIAL PRIMARY KEY,
    email             TEXT NOT NULL UNIQUE,
    password_hash     TEXT NOT NULL,
    display_name      TEXT,
    email_verified_at TIMESTAMPTZ,
    failed_attempts   INTEGER NOT NULL DEFAULT 0,
    locked_until      TIMESTAMPTZ,
    status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The tenant registry: one row per restaurant = one tenant. id IS the tenant_id
-- used by RLS over in tt_app. Billing columns fill in from Phase 4/6. `name` is
-- denormalized so the switcher lists restaurants without a cross-DB join.
CREATE TABLE IF NOT EXISTS restaurants (
    id                     BIGSERIAL PRIMARY KEY,
    name                   TEXT NOT NULL DEFAULT '',
    slug                   TEXT UNIQUE,
    status                 TEXT NOT NULL DEFAULT 'provisioning'
                           CHECK (status IN ('provisioning', 'active', 'suspended', 'deleting', 'deleted')),
    stripe_customer_id     TEXT,
    stripe_subscription_id TEXT,
    spending_limit_eur     NUMERIC(12, 2),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Which account manages which restaurant, and in what role. One account can own
-- many restaurants ("one account → many restaurants").
CREATE TABLE IF NOT EXISTS memberships (
    id            BIGSERIAL PRIMARY KEY,
    account_id    BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    restaurant_id BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    role          TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'manager')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, restaurant_id)
);
CREATE INDEX IF NOT EXISTS memberships_account_idx    ON memberships (account_id);
CREATE INDEX IF NOT EXISTS memberships_restaurant_idx ON memberships (restaurant_id);

-- Single-use, hashed, expiring links for email verification and password reset.
-- Polymorphic (account | creator). Only the SHA-256 hash of the raw token is
-- stored — the raw value lives only in the emailed URL.
CREATE TABLE IF NOT EXISTS auth_tokens (
    id           BIGSERIAL PRIMARY KEY,
    subject_type TEXT NOT NULL CHECK (subject_type IN ('account', 'creator')),
    subject_id   BIGINT NOT NULL,
    purpose      TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
    token_hash   TEXT NOT NULL UNIQUE,               -- sha256 hex of the raw token
    expires_at   TIMESTAMPTZ NOT NULL,
    consumed_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS auth_tokens_subject_idx ON auth_tokens (subject_type, subject_id, purpose);

-- Append-only trail of sensitive actions, for accountability.
CREATE TABLE IF NOT EXISTS audit_log (
    id            BIGSERIAL PRIMARY KEY,
    actor         TEXT,
    action        TEXT NOT NULL,
    detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
    account_id    BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
    creator_id    BIGINT REFERENCES creators(id) ON DELETE SET NULL,
    restaurant_id BIGINT REFERENCES restaurants(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC);

-- ============================================================================
-- Creator profiles & social connections
-- ============================================================================

CREATE TABLE IF NOT EXISTS creator_profiles (
    creator_id    BIGINT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
    bio           TEXT,
    city          TEXT,
    categories    TEXT[] NOT NULL DEFAULT '{}',
    languages     TEXT[] NOT NULL DEFAULT '{}',
    avatar_url    TEXT,
    base_rate_eur NUMERIC(12, 2),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A creator's connected Instagram/TikTok account. OAuth tokens are ENCRYPTED at
-- rest (Fernet / APP_SECRET_KEY) — a DB dump reveals no usable credential.
CREATE TABLE IF NOT EXISTS social_accounts (
    id                BIGSERIAL PRIMARY KEY,
    creator_id        BIGINT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
    platform          TEXT NOT NULL CHECK (platform IN ('instagram', 'tiktok')),
    handle            TEXT,
    platform_user_id  TEXT,
    follower_count    INTEGER,
    access_token_enc  TEXT,
    refresh_token_enc TEXT,
    token_expires_at  TIMESTAMPTZ,
    scopes            TEXT[] NOT NULL DEFAULT '{}',
    status            TEXT NOT NULL DEFAULT 'connected'
                      CHECK (status IN ('connected', 'expired', 'revoked')),
    connected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (creator_id, platform)
);
CREATE INDEX IF NOT EXISTS social_accounts_creator_idx ON social_accounts (creator_id);

-- ============================================================================
-- Marketplace graph (creator ↔ restaurant)
-- ============================================================================

-- A booking/agreement: restaurant engaged creator. `brief` snapshots the
-- guidelines at booking time so later edits don't rewrite history.
CREATE TABLE IF NOT EXISTS campaigns (
    id              BIGSERIAL PRIMARY KEY,
    restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    creator_id      BIGINT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'proposed'
                    CHECK (status IN ('proposed', 'accepted', 'live', 'completed', 'cancelled')),
    brief           JSONB NOT NULL DEFAULT '{}'::jsonb,
    agreed_rate_eur NUMERIC(12, 2),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS campaigns_restaurant_idx ON campaigns (restaurant_id);
CREATE INDEX IF NOT EXISTS campaigns_creator_idx    ON campaigns (creator_id);

-- THE billable unit: one creator post about a restaurant. The restaurant pays
-- for views on posts tied to it. billed_views is the high-water mark already
-- charged (see Phase 6 metering). Creators submit posts by pasting the URL.
CREATE TABLE IF NOT EXISTS posts (
    id               BIGSERIAL PRIMARY KEY,
    campaign_id      BIGINT REFERENCES campaigns(id) ON DELETE SET NULL,
    restaurant_id    BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    creator_id       BIGINT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
    platform         TEXT NOT NULL CHECK (platform IN ('instagram', 'tiktok')),
    platform_post_id TEXT,
    permalink        TEXT,
    caption          TEXT,
    posted_at        TIMESTAMPTZ,
    status           TEXT NOT NULL DEFAULT 'live'
                     CHECK (status IN ('detected', 'live', 'removed')),
    billed_views     BIGINT NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (platform, platform_post_id)
);
CREATE INDEX IF NOT EXISTS posts_restaurant_idx ON posts (restaurant_id);
CREATE INDEX IF NOT EXISTS posts_creator_idx    ON posts (creator_id);

-- ============================================================================
-- Metrics + view-based billing
-- ============================================================================

-- Cumulative metric snapshots pulled from IG/TikTok, one row per poll. Columns
-- are nullable because platforms differ (TikTok has no saves/reach). Billing
-- reads the latest `views` and charges the delta since posts.billed_views.
CREATE TABLE IF NOT EXISTS post_metrics (
    id          BIGSERIAL PRIMARY KEY,
    post_id     BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    views       BIGINT,
    likes       BIGINT,
    comments    BIGINT,
    shares      BIGINT,
    saves       BIGINT,
    reach       BIGINT,
    impressions BIGINT,
    source      JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS post_metrics_post_idx ON post_metrics (post_id, captured_at DESC);

-- Append-only customer billing ledger. `view` rows are derived from metric
-- deltas at €0.01; the €50/mo platform fee is the Stripe subscription base.
CREATE TABLE IF NOT EXISTS usage_events (
    id                     BIGSERIAL PRIMARY KEY,
    restaurant_id          BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    post_id                BIGINT REFERENCES posts(id) ON DELETE SET NULL,
    occurred_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    kind                   TEXT NOT NULL CHECK (kind IN ('view', 'platform_fee', 'adjustment')),
    quantity               BIGINT NOT NULL DEFAULT 0,
    unit_price_eur         NUMERIC(12, 6) NOT NULL DEFAULT 0,
    amount_eur             NUMERIC(14, 4) NOT NULL DEFAULT 0,
    currency               TEXT NOT NULL DEFAULT 'EUR',
    stripe_usage_record_id TEXT,
    meta                   JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS usage_events_restaurant_idx ON usage_events (restaurant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_post_idx       ON usage_events (post_id);

-- The creator's cut: €0.002/view (20% of the restaurant's €0.01).
CREATE TABLE IF NOT EXISTS creator_earnings (
    id         BIGSERIAL PRIMARY KEY,
    creator_id BIGINT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
    post_id    BIGINT REFERENCES posts(id) ON DELETE SET NULL,
    period     TEXT,                                     -- e.g. '2026-07'
    views      BIGINT NOT NULL DEFAULT 0,
    amount_eur NUMERIC(14, 4) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS creator_earnings_creator_idx ON creator_earnings (creator_id, created_at DESC);

-- Aggregated creator payouts per period (Stripe Connect execution: later phase).
CREATE TABLE IF NOT EXISTS payouts (
    id                 BIGSERIAL PRIMARY KEY,
    creator_id         BIGINT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
    period             TEXT NOT NULL,
    amount_eur         NUMERIC(14, 4) NOT NULL DEFAULT 0,
    status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
    stripe_transfer_id TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Internal cost metering for the menu-digitization LLM calls (reused from Iota).
CREATE TABLE IF NOT EXISTS llm_model_prices (
    id                    BIGSERIAL PRIMARY KEY,
    model                 TEXT NOT NULL,
    currency              TEXT NOT NULL DEFAULT 'USD',
    input_price_per_mtok  NUMERIC(20, 10) NOT NULL,
    output_price_per_mtok NUMERIC(20, 10) NOT NULL,
    effective_from        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (model, effective_from)
);

CREATE TABLE IF NOT EXISTS llm_usage_events (
    id                BIGSERIAL PRIMARY KEY,
    account_id        BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
    restaurant_id     BIGINT REFERENCES restaurants(id) ON DELETE SET NULL,
    occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    model             TEXT NOT NULL,
    request_kind      TEXT,
    prompt_tokens     INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost        NUMERIC(20, 10) NOT NULL DEFAULT 0,
    meta              JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Each restaurant's spend in the current calendar month.
CREATE OR REPLACE VIEW restaurant_month_spend AS
SELECT r.id AS restaurant_id,
       COALESCE(SUM(u.amount_eur) FILTER (WHERE u.occurred_at >= date_trunc('month', NOW())), 0)
           AS month_spend_eur
FROM restaurants r
LEFT JOIN usage_events u ON u.restaurant_id = r.id
GROUP BY r.id;
