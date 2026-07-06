/**
 * Plain-English documentation of the Trending Table data model, rendered on the
 * control tower's "Data model" page. Kept in sync by hand with the SQL in
 * backend/src/db/control_schema.sql and backend/migrations/app/0001_init.sql.
 *
 * Each column is [name, type, plain-English description, key?] where key is
 * "pk" (primary key), "fk" (foreign key → another table) or "uk" (unique).
 */
export type Col = [name: string, type: string, desc: string, key?: "pk" | "fk" | "uk"];
export interface Table {
  name: string;
  db: "tt_control" | "tt_app";
  kind?: "view";
  summary: string;
  cols: Col[];
}
export interface Group {
  title: string;
  blurb: string;
  tables: Table[];
}

export const INTRO =
  "Trending Table runs on two databases. tt_control is the shared brain — who's " +
  "who, which creator worked with which restaurant, and every euro charged or " +
  "earned. tt_app holds each restaurant's own private content (its profile, menu " +
  "and guidelines), walled off so one restaurant can never see another's. The " +
  "life of the product flows left to right: a person signs up (account or " +
  "creator) → a restaurant is created → a restaurant books a creator (campaign) → " +
  "the creator posts → we measure the post's views → the restaurant is billed " +
  "€0.01/view and the creator earns €0.002/view.";

export const SCHEMA_DOC: Group[] = [
  {
    title: "Who can log in",
    blurb:
      "The marketplace has two sides, each with its own login table but the same " +
      "security machinery: scrambled passwords, email verification, and lockout " +
      "after too many wrong guesses.",
    tables: [
      {
        name: "accounts",
        db: "tt_control",
        summary: "One row per person on the restaurant side who signs up to manage restaurants.",
        cols: [
          ["id", "bigint", "Unique number for this account.", "pk"],
          ["email", "text", "Their login email. No two accounts can share one.", "uk"],
          ["password_hash", "text", "A scrambled (argon2id) version of the password. The real password is never stored."],
          ["display_name", "text", "An optional friendly name for the person."],
          ["email_verified_at", "timestamp", "When they clicked the verify link. Empty means not verified yet."],
          ["failed_attempts", "int", "How many wrong passwords in a row — used to slow down guessing."],
          ["locked_until", "timestamp", "If they fail too often, login is blocked until this moment."],
          ["created_at", "timestamp", "When the account was created."],
          ["deleted_at", "timestamp", "When the account was deactivated. The row is kept, but login is blocked and billing is cancelled."],
        ],
      },
      {
        name: "creators",
        db: "tt_control",
        summary: "One row per creator (influencer). Same login machinery as accounts, plus an on/off status.",
        cols: [
          ["id", "bigint", "Unique number for this creator.", "pk"],
          ["email", "text", "Their login email.", "uk"],
          ["password_hash", "text", "Scrambled password (argon2id)."],
          ["display_name", "text", "Optional friendly name."],
          ["email_verified_at", "timestamp", "When they verified their email."],
          ["failed_attempts", "int", "Wrong-password counter for lockout."],
          ["locked_until", "timestamp", "Login blocked until this moment after too many failures."],
          ["status", "text", "'active' or 'suspended' — lets us pause a creator."],
          ["created_at", "timestamp", "When the creator signed up."],
        ],
      },
      {
        name: "memberships",
        db: "tt_control",
        summary: "Links accounts to the restaurants they can manage. One account can manage many restaurants.",
        cols: [
          ["id", "bigint", "Unique row id.", "pk"],
          ["account_id", "bigint", "Which account this is about. → accounts.", "fk"],
          ["restaurant_id", "bigint", "Which restaurant they can manage. → restaurants.", "fk"],
          ["role", "text", "'owner' (full control) or 'manager' (helper)."],
          ["created_at", "timestamp", "When access was granted."],
        ],
      },
      {
        name: "auth_tokens",
        db: "tt_control",
        summary: "The one-time links we email to verify an address or reset a password. Only a fingerprint of the link is stored — never the link itself.",
        cols: [
          ["id", "bigint", "Unique row id.", "pk"],
          ["subject_type", "text", "Whose link it is: 'account' or 'creator'."],
          ["subject_id", "bigint", "The id of that account or creator."],
          ["purpose", "text", "'verify' (confirm email) or 'reset' (new password)."],
          ["token_hash", "text", "A one-way fingerprint (sha256) of the emailed link.", "uk"],
          ["expires_at", "timestamp", "After this, the link no longer works."],
          ["consumed_at", "timestamp", "When the link was used. A used link can't be reused."],
          ["created_at", "timestamp", "When the link was issued."],
        ],
      },
    ],
  },
  {
    title: "Restaurants and the marketplace",
    blurb:
      "Restaurants are the paying customers; creators connect their social " +
      "accounts; a campaign is a booking between the two; a post is the piece of " +
      "content we ultimately bill for.",
    tables: [
      {
        name: "restaurants",
        db: "tt_control",
        summary: "The list of restaurants. Each one is a 'tenant', and its id is the key that keeps its private data (over in tt_app) separate from everyone else's.",
        cols: [
          ["id", "bigint", "Unique number — this is also the 'tenant id' used everywhere.", "pk"],
          ["name", "text", "Restaurant name (kept here too so lists load fast)."],
          ["slug", "text", "A short URL-friendly name (reserved for later).", "uk"],
          ["status", "text", "Lifecycle: provisioning → active → suspended / deleted."],
          ["stripe_customer_id", "text", "Its customer record in Stripe (our payment provider)."],
          ["stripe_subscription_id", "text", "The €49.99/mo platform-fee subscription in Stripe."],
          ["stripe_subscription_status", "text", "Live state of that subscription (trialing, active, past_due, canceled…)."],
          ["stripe_usage_subscription_id", "text", "A separate monthly subscription that bills the per-view usage."],
          ["spending_limit_eur", "numeric", "The most this restaurant wants to spend per month (platform fee included)."],
          ["created_at", "timestamp", "When the restaurant was created."],
        ],
      },
      {
        name: "creator_profiles",
        db: "tt_control",
        summary: "Extra profile details for a creator — the stuff a restaurant looks at when choosing who to work with.",
        cols: [
          ["creator_id", "bigint", "Which creator this profile belongs to. → creators.", "pk"],
          ["bio", "text", "Short self-description."],
          ["city", "text", "Where they're based."],
          ["categories", "text[]", "Topics they cover, e.g. food, lifestyle."],
          ["languages", "text[]", "Languages they post in."],
          ["avatar_url", "text", "Link to their profile picture."],
          ["base_rate_eur", "numeric", "Their typical asking price."],
          ["updated_at", "timestamp", "When the profile was last edited."],
        ],
      },
      {
        name: "social_accounts",
        db: "tt_control",
        summary: "A creator's connected Instagram or TikTok account. The access keys are encrypted, so a database leak reveals nothing usable.",
        cols: [
          ["id", "bigint", "Unique row id.", "pk"],
          ["creator_id", "bigint", "Which creator owns this connection. → creators.", "fk"],
          ["platform", "text", "'instagram' or 'tiktok'."],
          ["handle", "text", "Their @username on that platform."],
          ["platform_user_id", "text", "The platform's own id for the account."],
          ["follower_count", "int", "Their follower number at last check."],
          ["access_token_enc", "text", "Encrypted key we use to read their stats."],
          ["refresh_token_enc", "text", "Encrypted key used to renew access."],
          ["token_expires_at", "timestamp", "When the access key needs renewing."],
          ["scopes", "text[]", "What the platform allows us to read."],
          ["status", "text", "'connected', 'expired' or 'revoked'."],
          ["connected_at", "timestamp", "When they linked the account."],
        ],
      },
      {
        name: "campaigns",
        db: "tt_control",
        summary: "A booking — a restaurant hiring a creator. It snapshots the guidelines at booking time, so later edits don't rewrite history.",
        cols: [
          ["id", "bigint", "Unique booking id.", "pk"],
          ["restaurant_id", "bigint", "The hiring restaurant. → restaurants.", "fk"],
          ["creator_id", "bigint", "The hired creator. → creators.", "fk"],
          ["status", "text", "proposed → accepted → live → completed (or cancelled)."],
          ["brief", "json", "A frozen copy of the restaurant's guidelines for this booking."],
          ["agreed_rate_eur", "numeric", "The price both sides agreed on."],
          ["created_at", "timestamp", "When the booking was made."],
        ],
      },
      {
        name: "posts",
        db: "tt_control",
        summary: "The thing we actually bill for: one creator post about a restaurant. Creators add a post by pasting its link.",
        cols: [
          ["id", "bigint", "Unique post id.", "pk"],
          ["campaign_id", "bigint", "The booking it belongs to, if any. → campaigns.", "fk"],
          ["restaurant_id", "bigint", "The restaurant being promoted (who pays). → restaurants.", "fk"],
          ["creator_id", "bigint", "The creator who posted (who earns). → creators.", "fk"],
          ["platform", "text", "'instagram' or 'tiktok'."],
          ["platform_post_id", "text", "The platform's own id for the post."],
          ["permalink", "text", "The public link to the post."],
          ["caption", "text", "The post's text."],
          ["posted_at", "timestamp", "When it went live."],
          ["status", "text", "'detected', 'live' or 'removed'."],
          ["billed_views", "bigint", "How many views we've already charged for — the high-water mark, so we never bill the same view twice."],
          ["created_at", "timestamp", "When the post was added to our system."],
        ],
      },
    ],
  },
  {
    title: "Measuring and charging",
    blurb:
      "As a post gathers views we snapshot its numbers, charge the restaurant " +
      "€0.01 per new view, and credit the creator €0.002 (20%). Everything is an " +
      "append-only ledger, so the money history can always be re-checked.",
    tables: [
      {
        name: "post_metrics",
        db: "tt_control",
        summary: "A snapshot of a post's numbers each time we check it — one row per check. Billing compares the newest view count to what we've already billed.",
        cols: [
          ["id", "bigint", "Unique snapshot id.", "pk"],
          ["post_id", "bigint", "Which post this snapshot is of. → posts.", "fk"],
          ["captured_at", "timestamp", "When we took this snapshot."],
          ["views", "bigint", "Total views so far (the number we bill on)."],
          ["likes", "bigint", "Total likes."],
          ["comments", "bigint", "Total comments."],
          ["shares", "bigint", "Total shares."],
          ["saves", "bigint", "Total saves (Instagram only)."],
          ["reach", "bigint", "Unique people reached (Instagram only)."],
          ["impressions", "bigint", "Total times shown."],
          ["source", "json", "The raw data as it came from Instagram/TikTok."],
        ],
      },
      {
        name: "usage_events",
        db: "tt_control",
        summary: "The restaurant's billing ledger — an append-only list of charges. 'view' rows are new views × €0.01; the platform fee is the Stripe base.",
        cols: [
          ["id", "bigint", "Unique charge id.", "pk"],
          ["restaurant_id", "bigint", "Who is being charged. → restaurants.", "fk"],
          ["post_id", "bigint", "The post that caused the charge, if any. → posts.", "fk"],
          ["occurred_at", "timestamp", "When the charge was recorded."],
          ["kind", "text", "'view' (per-view charge), 'platform_fee', or 'adjustment'."],
          ["quantity", "bigint", "How many views this row covers."],
          ["unit_price_eur", "numeric", "Price per view (€0.01)."],
          ["amount_eur", "numeric", "The total for this row (quantity × price)."],
          ["currency", "text", "Always EUR for now."],
          ["stripe_usage_record_id", "text", "The matching entry we sent to Stripe — prevents double-billing."],
          ["meta", "json", "Any extra detail about the charge."],
        ],
      },
      {
        name: "creator_earnings",
        db: "tt_control",
        summary: "The creator's share of each billed view: €0.002 (20% of what the restaurant pays).",
        cols: [
          ["id", "bigint", "Unique row id.", "pk"],
          ["creator_id", "bigint", "Who earned it. → creators.", "fk"],
          ["post_id", "bigint", "The post it came from. → posts.", "fk"],
          ["period", "text", "The month it belongs to, e.g. '2026-07'."],
          ["views", "bigint", "How many views were credited."],
          ["amount_eur", "numeric", "The creator's earnings for this row."],
          ["created_at", "timestamp", "When it was credited."],
        ],
      },
      {
        name: "payouts",
        db: "tt_control",
        summary: "Money actually sent to a creator for a period (paid out via Stripe in a later phase).",
        cols: [
          ["id", "bigint", "Unique payout id.", "pk"],
          ["creator_id", "bigint", "Who is being paid. → creators.", "fk"],
          ["period", "text", "The month being paid out."],
          ["amount_eur", "numeric", "How much."],
          ["status", "text", "'pending', 'paid' or 'failed'."],
          ["stripe_transfer_id", "text", "Stripe's id for the transfer."],
          ["created_at", "timestamp", "When the payout was created."],
        ],
      },
      {
        name: "restaurant_month_spend",
        db: "tt_control",
        kind: "view",
        summary: "Not a stored table — a live calculation that adds up each restaurant's charges for the current calendar month. Used for the spending-limit check.",
        cols: [
          ["restaurant_id", "bigint", "Which restaurant. → restaurants.", "fk"],
          ["month_spend_eur", "numeric", "Total charged so far this month."],
        ],
      },
    ],
  },
  {
    title: "Each restaurant's private content",
    blurb:
      "This is the second database, tt_app. Every table is locked to one " +
      "restaurant at a time by row-level security, so no restaurant can ever read " +
      "another's data. The key everywhere is tenant_id, which equals restaurants.id.",
    tables: [
      {
        name: "restaurant_profiles",
        db: "tt_app",
        summary: "The restaurant's public profile, mostly pulled from Google at signup and then editable.",
        cols: [
          ["tenant_id", "bigint", "Which restaurant this is (= restaurants.id).", "pk"],
          ["place_id", "text", "Google's id for the place."],
          ["name", "text", "Restaurant name."],
          ["address", "text", "Street address."],
          ["city", "text", "City."],
          ["category", "text", "Cuisine or type, e.g. Italian."],
          ["tags", "text[]", "Extra keywords, e.g. pasta, wine."],
          ["google_rating", "numeric", "Star rating from Google."],
          ["google_reviews", "int", "Number of Google reviews."],
          ["description", "text", "A short blurb about the place."],
          ["website", "text", "Their website."],
          ["logo_url", "text", "Link to their logo."],
          ["photo_ref", "text", "Reference to a Google photo."],
          ["price_level", "text", "Rough price range, e.g. €€."],
          ["updated_at", "timestamp", "When the profile was last edited."],
        ],
      },
      {
        name: "menu_items",
        db: "tt_app",
        summary: "The restaurant's menu — one row per dish.",
        cols: [
          ["id", "bigint", "Unique item id.", "pk"],
          ["tenant_id", "bigint", "Which restaurant it belongs to."],
          ["section", "text", "Menu section, e.g. Starters."],
          ["name", "text", "Dish name."],
          ["price", "text", "Price as shown, e.g. €12."],
          ["sort_order", "int", "Position in the list."],
          ["source", "text", "How it was captured: 'llm' (AI), 'heuristic' (quick parse) or 'manual' (typed)."],
          ["created_at", "timestamp", "When it was added."],
        ],
      },
      {
        name: "content_guidelines",
        db: "tt_app",
        summary: "What creators should and shouldn't show when posting about this restaurant.",
        cols: [
          ["tenant_id", "bigint", "Which restaurant this is.", "pk"],
          ["show", "text[]", "Things to feature, e.g. the dining room."],
          ["must_include", "text[]", "Hard requirements, e.g. the logo."],
          ["avoid", "text[]", "Things to keep out, e.g. prices."],
          ["handle", "text", "The social handle creators should tag."],
          ["notes", "text", "Any free-text extra guidance."],
          ["updated_at", "timestamp", "When guidelines were last edited."],
        ],
      },
      {
        name: "menu_sources",
        db: "tt_app",
        summary: "Where the menu came from (a PDF or a link) and when it was digitized.",
        cols: [
          ["tenant_id", "bigint", "Which restaurant this is.", "pk"],
          ["kind", "text", "'pdf' or 'link'."],
          ["url", "text", "The source link, if any."],
          ["engine", "text", "Which digitizer read it."],
          ["item_count", "int", "How many items it produced."],
          ["digitized_at", "timestamp", "When it was read."],
        ],
      },
    ],
  },
  {
    title: "Housekeeping",
    blurb: "Behind-the-scenes tables that keep the system accountable and track internal costs.",
    tables: [
      {
        name: "audit_log",
        db: "tt_control",
        summary: "An append-only record of sensitive actions (logins, verifications, deletions) so anything important can be traced later.",
        cols: [
          ["id", "bigint", "Unique row id.", "pk"],
          ["actor", "text", "Who or what did it."],
          ["action", "text", "What happened, e.g. 'account_deleted'."],
          ["detail", "json", "Any extra context."],
          ["account_id", "bigint", "Related account, if any. → accounts.", "fk"],
          ["creator_id", "bigint", "Related creator, if any. → creators.", "fk"],
          ["restaurant_id", "bigint", "Related restaurant, if any. → restaurants.", "fk"],
          ["created_at", "timestamp", "When it happened."],
        ],
      },
      {
        name: "llm_usage_events",
        db: "tt_control",
        summary: "One row per AI menu-reading call, so we can track what the menu digitizer costs us.",
        cols: [
          ["id", "bigint", "Unique row id.", "pk"],
          ["account_id", "bigint", "Who triggered it, if known. → accounts.", "fk"],
          ["restaurant_id", "bigint", "Which restaurant it was for. → restaurants.", "fk"],
          ["occurred_at", "timestamp", "When the call happened."],
          ["model", "text", "Which AI model was used."],
          ["request_kind", "text", "What kind of request it was."],
          ["prompt_tokens", "int", "Words in (as tokens)."],
          ["completion_tokens", "int", "Words out (as tokens)."],
          ["total_cost", "numeric", "What it cost us."],
          ["meta", "json", "Extra detail."],
        ],
      },
      {
        name: "llm_model_prices",
        db: "tt_control",
        summary: "The price list for each AI model, effective-dated so past costs stay accurate when prices change.",
        cols: [
          ["id", "bigint", "Unique row id.", "pk"],
          ["model", "text", "The AI model name."],
          ["currency", "text", "Usually USD."],
          ["input_price_per_mtok", "numeric", "Cost per million input tokens."],
          ["output_price_per_mtok", "numeric", "Cost per million output tokens."],
          ["effective_from", "timestamp", "When this price took effect."],
        ],
      },
      {
        name: "schema_migrations",
        db: "tt_control",
        summary: "A simple checklist of which database updates have already run.",
        cols: [
          ["version", "text", "The migration's id.", "pk"],
          ["applied_at", "timestamp", "When it ran."],
        ],
      },
    ],
  },
];
