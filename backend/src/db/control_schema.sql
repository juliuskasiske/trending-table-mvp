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
