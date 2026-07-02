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
