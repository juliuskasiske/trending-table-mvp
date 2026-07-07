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
    stripe_subscription_status TEXT,
    stripe_usage_subscription_id TEXT,
    spending_limit_eur     NUMERIC(12, 2),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Additive columns for DBs created before these flows (idempotent).
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS stripe_subscription_status TEXT;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS stripe_usage_subscription_id TEXT;
-- Redesign: the saved card used for the €9.99 launch fee + off-session
-- per-approval charges. The old subscription/spending-limit columns above are
-- deprecated (kept for back-compat; no longer written).
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS stripe_payment_method_id TEXT;
-- Redesign: creator payouts via Stripe Connect (Express).
ALTER TABLE creators ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;
ALTER TABLE creators ADD COLUMN IF NOT EXISTS payouts_enabled BOOLEAN NOT NULL DEFAULT false;
-- Soft-delete tombstone for accounts (rows are kept, login is revoked).
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

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
    platform          TEXT NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'youtube')),
    handle            TEXT,
    platform_user_id  TEXT,
    follower_count    INTEGER,
    access_token_enc  TEXT,
    refresh_token_enc TEXT,
    token_expires_at  TIMESTAMPTZ,
    scopes            TEXT[] NOT NULL DEFAULT '{}',
    status            TEXT NOT NULL DEFAULT 'connected'
                      CHECK (status IN ('connected', 'expired', 'revoked', 'pending')),
    connected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (creator_id, platform)
);
CREATE INDEX IF NOT EXISTS social_accounts_creator_idx ON social_accounts (creator_id);

-- Widen the platform/status checks on DBs created before YouTube + handle-only
-- "pending" connections (idempotent — drop the inline-named check, re-add).
ALTER TABLE social_accounts DROP CONSTRAINT IF EXISTS social_accounts_platform_check;
ALTER TABLE social_accounts ADD CONSTRAINT social_accounts_platform_check
    CHECK (platform IN ('instagram', 'tiktok', 'youtube'));
ALTER TABLE social_accounts DROP CONSTRAINT IF EXISTS social_accounts_status_check;
ALTER TABLE social_accounts ADD CONSTRAINT social_accounts_status_check
    CHECK (status IN ('connected', 'expired', 'revoked', 'pending'));

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
    deliverable     TEXT,                      -- e.g. "1 Reel + Story" (the booking ask)
    scheduled_date  DATE,                      -- the collaboration date (calendar)
    agreed_rate_eur NUMERIC(12, 2),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS campaigns_restaurant_idx ON campaigns (restaurant_id);
CREATE INDEX IF NOT EXISTS campaigns_creator_idx    ON campaigns (creator_id);
-- Additive booking fields for older DBs (idempotent).
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS deliverable TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS scheduled_date DATE;

-- Redesign: a campaign is now a restaurant thing with a budget + deadline +
-- per-campaign guidelines, and 0..many creators (see campaign_creators). It is
-- no longer one-creator, and no longer billed per view. creator_id is retained
-- (nullable) only for back-compat with old rows.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS budget_eur NUMERIC(12, 2);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS content_deadline DATE;  -- post-by date
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS guidelines JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS estimated_views BIGINT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS fee_payment_intent_id TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS fee_paid_at TIMESTAMPTZ;
ALTER TABLE campaigns ALTER COLUMN creator_id DROP NOT NULL;
-- New status set: draft (created, unpaid) → active (launched) → completed | cancelled.
-- Drop the old CHECK first, then remap legacy statuses, then add the new CHECK.
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
UPDATE campaigns SET status = CASE
    WHEN status IN ('proposed', 'accepted') THEN 'draft'
    WHEN status = 'live' THEN 'active'
    ELSE status END
  WHERE status IN ('proposed', 'accepted', 'live');
ALTER TABLE campaigns ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE campaigns ADD CONSTRAINT campaigns_status_check
    CHECK (status IN ('draft', 'active', 'completed', 'cancelled'));

-- The internal assignment: which creators are on a campaign, what the restaurant
-- is charged, and what the creator is paid, each fired on restaurant approval.
-- (Creators are matched internally via the control tower for now.)
CREATE TABLE IF NOT EXISTS campaign_creators (
    id                     BIGSERIAL PRIMARY KEY,
    campaign_id            BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    creator_id             BIGINT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
    restaurant_charge_eur  NUMERIC(12, 2),  -- billed to the restaurant on approval
    creator_payout_eur     NUMERIC(12, 2),  -- transferred to the creator on approval
    status                 TEXT NOT NULL DEFAULT 'contacted'
                           CHECK (status IN ('contacted', 'posted', 'approved', 'paid',
                                             'declined', 'cancelled', 'payment_action')),
    contacted_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    posted_at              TIMESTAMPTZ,
    approved_at            TIMESTAMPTZ,
    paid_at                TIMESTAMPTZ,
    charge_payment_intent_id TEXT,
    transfer_id            TEXT,
    UNIQUE (campaign_id, creator_id)
);
CREATE INDEX IF NOT EXISTS campaign_creators_campaign_idx ON campaign_creators (campaign_id);
CREATE INDEX IF NOT EXISTS campaign_creators_creator_idx  ON campaign_creators (creator_id);

-- THE billable unit: one creator post about a restaurant. The restaurant pays
-- for views on posts tied to it. billed_views is the high-water mark already
-- charged (see Phase 6 metering). Creators submit posts by pasting the URL.
CREATE TABLE IF NOT EXISTS posts (
    id               BIGSERIAL PRIMARY KEY,
    campaign_id      BIGINT REFERENCES campaigns(id) ON DELETE SET NULL,
    restaurant_id    BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    creator_id       BIGINT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
    platform         TEXT NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'youtube')),
    platform_post_id TEXT,
    permalink        TEXT,
    caption          TEXT,
    thumbnail_url    TEXT,                     -- cover image for the restaurant's post view
    media_type       TEXT,                     -- IMAGE | VIDEO | CAROUSEL_ALBUM
    media_product_type TEXT,                   -- REELS | FEED | STORY
    posted_at        TIMESTAMPTZ,
    status           TEXT NOT NULL DEFAULT 'live'
                     CHECK (status IN ('detected', 'live', 'removed')),
    billed_views     BIGINT NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (platform, platform_post_id)
);
CREATE INDEX IF NOT EXISTS posts_restaurant_idx ON posts (restaurant_id);
CREATE INDEX IF NOT EXISTS posts_creator_idx    ON posts (creator_id);
-- Additive media fields + widened platform for older DBs (idempotent).
ALTER TABLE posts ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_type TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_product_type TEXT;
-- Which campaign assignment this submitted post belongs to (redesign).
ALTER TABLE posts ADD COLUMN IF NOT EXISTS campaign_creator_id BIGINT
    REFERENCES campaign_creators(id) ON DELETE SET NULL;
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_platform_check;
ALTER TABLE posts ADD CONSTRAINT posts_platform_check
    CHECK (platform IN ('instagram', 'tiktok', 'youtube'));

-- A restaurant's star rating of a creator, left after a collaboration. One
-- review per (restaurant, creator); a restaurant may only review a creator it
-- has actually worked with (a completed campaign — enforced in the route).
CREATE TABLE IF NOT EXISTS creator_reviews (
    id            BIGSERIAL PRIMARY KEY,
    creator_id    BIGINT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
    restaurant_id BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    campaign_id   BIGINT REFERENCES campaigns(id) ON DELETE SET NULL,
    rating        SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment       TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (restaurant_id, creator_id)
);
CREATE INDEX IF NOT EXISTS creator_reviews_creator_idx ON creator_reviews (creator_id);

-- Direct messages between a restaurant and a creator. One logical thread per
-- (restaurant, creator); sender_role says who wrote each line. The per-side
-- read timestamps drive unread badges.
CREATE TABLE IF NOT EXISTS messages (
    id                    BIGSERIAL PRIMARY KEY,
    restaurant_id         BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    creator_id            BIGINT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
    sender_role           TEXT NOT NULL CHECK (sender_role IN ('restaurant', 'creator')),
    body                  TEXT NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_by_restaurant_at TIMESTAMPTZ,
    read_by_creator_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages (restaurant_id, creator_id, created_at);
CREATE INDEX IF NOT EXISTS messages_creator_idx ON messages (creator_id, created_at);

-- Restaurant-outreach CRM (control-tower only). Each row is a prospect the team
-- is working through the sales funnel; the restaurant is identified via Google
-- Places (place_id + name + address). Stage gates L1..L5; dates are team-set.
CREATE TABLE IF NOT EXISTS outreach_leads (
    id            BIGSERIAL PRIMARY KEY,
    place_id      TEXT,
    name          TEXT NOT NULL,
    address       TEXT,
    outreach_date DATE,
    stage         TEXT NOT NULL DEFAULT 'l1'
                  CHECK (stage IN ('l1', 'l2', 'l3', 'l4', 'l5')),
    planned_l3    DATE,
    planned_l5    DATE,
    status        TEXT NOT NULL DEFAULT 'active',
    cancel_reason TEXT,
    comment       TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- The actual date a lead reached each gate is derived from the stage log below,
-- not hand-entered (idempotent drop for DBs created with the old columns).
ALTER TABLE outreach_leads DROP COLUMN IF EXISTS actual_l3;
ALTER TABLE outreach_leads DROP COLUMN IF EXISTS actual_l1;
-- Lead status: active, or cancelled with a reason. Idempotent add + checks.
ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS planned_l5 DATE;
ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS comment TEXT;
ALTER TABLE outreach_leads DROP CONSTRAINT IF EXISTS outreach_leads_status_check;
ALTER TABLE outreach_leads ADD CONSTRAINT outreach_leads_status_check
    CHECK (status IN ('active', 'cancelled'));
ALTER TABLE outreach_leads DROP CONSTRAINT IF EXISTS outreach_leads_cancel_reason_check;
ALTER TABLE outreach_leads ADD CONSTRAINT outreach_leads_cancel_reason_check
    CHECK (cancel_reason IS NULL OR cancel_reason IN
        ('social_presence', 'closing', 'no_need', 'sub_cost', 'usage_cost', 'low_control', 'other'));

-- Every stage transition, timestamped — the source of truth for when a lead
-- actually reached each gate (auto-logged when the team hits "Update stage").
CREATE TABLE IF NOT EXISTS lead_stage_events (
    id         BIGSERIAL PRIMARY KEY,
    lead_id    BIGINT NOT NULL REFERENCES outreach_leads(id) ON DELETE CASCADE,
    stage      TEXT NOT NULL CHECK (stage IN ('l1', 'l2', 'l3', 'l4', 'l5')),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lead_stage_events_lead_idx ON lead_stage_events (lead_id, changed_at);

-- Backfill: L1 (Outreach) events adopt the lead's entered outreach_date, so
-- leads created before that rule get corrected too. Idempotent — only touches
-- rows that still diverge, and is a no-op once everything is in sync.
UPDATE lead_stage_events e
   SET changed_at = (l.outreach_date + TIME '12:00')
  FROM outreach_leads l
 WHERE e.lead_id = l.id AND e.stage = 'l1'
   AND l.outreach_date IS NOT NULL
   AND e.changed_at::date <> l.outreach_date;

-- Single-row settings for the pipeline chart's L5 (Subscribed) ramp-up target.
CREATE TABLE IF NOT EXISTS pipeline_settings (
    id          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    l5_target   INTEGER NOT NULL DEFAULT 50,
    target_date DATE NOT NULL DEFAULT DATE '2026-07-31',
    start_date  DATE,  -- null = ramp from the first day we have pipeline data
    curve_shape TEXT NOT NULL DEFAULT 's' CHECK (curve_shape IN ('s', 'linear')),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO pipeline_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

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
-- Redesign: unified ledger now records the €9.99 campaign fee + per-approval
-- creator charges (view rows are deprecated). Widen the kind CHECK.
ALTER TABLE usage_events DROP CONSTRAINT IF EXISTS usage_events_kind_check;
ALTER TABLE usage_events ADD CONSTRAINT usage_events_kind_check
    CHECK (kind IN ('view', 'platform_fee', 'adjustment', 'campaign_fee', 'creator_charge'));

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
