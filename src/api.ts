/**
 * Frontend API client — wrappers over the FastAPI backend (same-origin via the
 * Vite dev proxy). All requests send cookies (the JWT session).
 */
import type { MenuItem, PlaceDetails, PlaceSuggestion } from "./types.ts";

export interface AppConfig {
  placesEnabled: boolean;
  menuAiEnabled: boolean;
  menuLlmEnabled: boolean;
  stripeEnabled: boolean;
  stripePublishableKey: string | null;
  // Real platform-fee amounts straight from Stripe, in cents. {} if unconfigured.
  stripePrices: {
    monthly?: { amount: number; currency: string };
    annual?: { amount: number; currency: string };
  };
  // When true, the subscription trials until subscriptionStart: card is saved
  // now, first charged on that date. Collect via SetupIntent, not PaymentIntent.
  subscriptionDeferredStart?: boolean;
  subscriptionStart?: string | null;
  pricing: { ratePerView: number; platformFee: number; creatorPerView?: number };
}

export interface Principal {
  id: number;
  email: string;
  role: "account" | "creator";
  display_name: string | null;
  email_verified: boolean;
}

/**
 * Session token. We keep the httponly cookie (browsers that store it send it
 * automatically), but ALSO carry the token in an `Authorization: Bearer` header
 * so auth works in browsers that refuse to persist the cookie — notably Safari
 * on the bare `localhost` hostname. The token is echoed by signup/login.
 */
const TOKEN_KEY = "tt_token";
let authToken: string | null = (() => {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
})();

export function setAuthToken(token: string | null): void {
  authToken = token;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore storage failures (private mode) — in-memory token still works */
  }
}

/** Thin fetch wrapper: JSON in/out, cookie + bearer token, errors carry the detail. */
async function api<T>(path: string, opts: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = opts;
  const r = await fetch(path, {
    credentials: "include",
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    ...rest,
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { detail?: unknown };
    // FastAPI validation errors return detail as an array of {loc,msg,type};
    // flatten those to a readable string instead of "[object Object]".
    let msg: string;
    const d = body.detail;
    if (typeof d === "string") msg = d;
    else if (Array.isArray(d)) msg = d.map((e) => (e as { msg?: string }).msg ?? String(e)).join("; ");
    else if (d) msg = JSON.stringify(d);
    else msg = `${path} failed: ${r.status}`;
    const err = new Error(msg) as Error & { status?: number };
    err.status = r.status;
    throw err;
  }
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

/* ---- config -------------------------------------------------------------- */

let configCache: AppConfig | null = null;
export async function getConfig(): Promise<AppConfig> {
  if (configCache) return configCache;
  configCache = await api<AppConfig>("/api/config");
  return configCache;
}

/* ---- auth ---------------------------------------------------------------- */

export async function signup(email: string, password: string, role: "account" | "creator" = "account"):
  Promise<Principal & { dev_verify_token?: string }> {
  const p = await api<Principal & { token?: string; dev_verify_token?: string }>(
    "/api/auth/signup", { method: "POST", json: { email, password, role } },
  );
  if (p.token) setAuthToken(p.token);
  return p;
}

export async function login(email: string, password: string, role: "account" | "creator" = "account"):
  Promise<Principal> {
  const p = await api<Principal & { token?: string }>(
    "/api/auth/login", { method: "POST", json: { email, password, role } },
  );
  if (p.token) setAuthToken(p.token);
  return p;
}

export async function logout(): Promise<{ ok: boolean }> {
  try {
    return await api("/api/auth/logout", { method: "POST" });
  } finally {
    setAuthToken(null);
  }
}

export async function getMe(): Promise<Principal | null> {
  try {
    return await api<Principal>("/api/auth/me");
  } catch {
    return null;
  }
}

export function verifyEmail(token: string): Promise<{ ok: boolean }> {
  return api(`/api/auth/verify?token=${encodeURIComponent(token)}`);
}

export function resendVerification(): Promise<{ ok: boolean; dev_verify_token?: string }> {
  return api("/api/auth/resend-verification", { method: "POST" });
}

/* ---- places -------------------------------------------------------------- */

export async function searchPlaces(query: string): Promise<PlaceSuggestion[]> {
  // Let errors propagate so the UI can distinguish "no matches" from
  // "backend unreachable / not signed in".
  const data = await api<{ results?: PlaceSuggestion[] }>(
    `/api/places/search?q=${encodeURIComponent(query)}`,
  );
  return data.results ?? [];
}

export function getPlaceDetails(placeId: string): Promise<PlaceDetails> {
  return api<PlaceDetails>(`/api/places/details?id=${encodeURIComponent(placeId)}`);
}

export function placePhotoUrl(photoName: string, width = 320): string {
  return `/api/places/photo?name=${encodeURIComponent(photoName)}&w=${width}`;
}

export function faviconLogo(website: string | undefined, size = 128): string | undefined {
  if (!website) return undefined;
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(website).hostname}&sz=${size}`;
  } catch {
    return undefined;
  }
}

/* ---- restaurants (tenant CRUD) ------------------------------------------- */

export interface RestaurantProfileInput {
  name?: string;
  place_id?: string;
  address?: string;
  city?: string;
  category?: string;
  tags?: string[];
  google_rating?: number;
  google_reviews?: number;
  description?: string;
  website?: string;
  logo_url?: string;
  photo_ref?: string;
  price_level?: string;
}

export interface RestaurantSummary {
  id: number;
  name: string;
  status: string;
  spending_limit_eur: number | null;
  stripe_subscription_status: string | null;
  role: string;
}

export function listRestaurants(): Promise<{ restaurants: RestaurantSummary[] }> {
  return api("/api/restaurants");
}

export function createRestaurant(profile: RestaurantProfileInput & { name: string }):
  Promise<{ id: number; name: string; status: string }> {
  return api("/api/restaurants", { method: "POST", json: profile });
}

export function putProfile(id: number, profile: RestaurantProfileInput): Promise<{ ok: boolean }> {
  return api(`/api/restaurants/${id}/profile`, { method: "PUT", json: profile });
}

export function putMenu(id: number, items: MenuItem[]): Promise<{ ok: boolean; count: number }> {
  const payload = items.map((i) => ({
    section: i.section ?? null,
    name: i.name,
    price: i.price ?? null,
    source: (["llm", "heuristic", "manual"].includes(String(i.source)) ? i.source : "manual"),
  }));
  return api(`/api/restaurants/${id}/menu`, { method: "PUT", json: { items: payload } });
}

export function putGuidelines(
  id: number,
  g: { show: string[]; must_include: string[]; avoid: string[]; handle?: string; notes?: string },
): Promise<{ ok: boolean }> {
  return api(`/api/restaurants/${id}/guidelines`, { method: "PUT", json: g });
}

export function putBilling(id: number, spending_limit_eur: number): Promise<{ ok: boolean }> {
  return api(`/api/restaurants/${id}/billing`, { method: "PUT", json: { spending_limit_eur } });
}

export function activateRestaurant(id: number): Promise<{ ok: boolean; status: string }> {
  return api(`/api/restaurants/${id}/activate`, { method: "POST" });
}

/* ---- bookings (campaigns) + post view ------------------------------------ */

export interface Booking {
  id: number;
  creator_id: number;
  creator_name: string | null;
  creator_email: string | null;
  creator_avatar: string | null;
  status: string; // proposed | accepted | live | completed | cancelled
  agreed_rate_eur: number | null;
  deliverable: string | null;
  scheduled_date: string | null; // ISO "YYYY-MM-DD"
  created_at: string; // ISO datetime
  post_count: number;
}

export function listBookings(restaurantId: number): Promise<{ campaigns: Booking[] }> {
  return api(`/api/restaurants/${restaurantId}/campaigns`);
}

export interface RestaurantPost {
  id: number;
  platform: string; // instagram | tiktok | youtube
  permalink: string | null;
  caption: string | null;
  thumbnail_url: string | null;
  media_type: string | null; // IMAGE | VIDEO | CAROUSEL_ALBUM
  media_product_type: string | null; // REELS | FEED | STORY
  status: string;
  billed_views: number | null;
  posted_at: string | null; // ISO datetime
  campaign_id: number | null;
  creator_id: number;
  creator_name: string | null;
  creator_avatar: string | null;
  creator_handle: string | null;
  latest_views: number | null;
  latest_likes: number | null;
}

export function listPosts(restaurantId: number, campaignId?: number): Promise<{ posts: RestaurantPost[] }> {
  const q = campaignId ? `?campaign_id=${campaignId}` : "";
  return api(`/api/restaurants/${restaurantId}/posts${q}`);
}

/* ---- creators directory + reviews ---------------------------------------- */

export interface CreatorSocial {
  platform: string;
  handle: string | null;
  follower_count: number | null;
  status?: string;
}

export interface CreatorSummary {
  id: number;
  display_name: string | null;
  city: string | null;
  avatar_url: string | null;
  categories: string[];
  base_rate_eur: number | null;
  follower_total: number;
  socials: CreatorSocial[] | null;
  rating_avg: number | null;
  rating_count: number;
}

export interface CreatorReview {
  rating: number;
  comment: string | null;
  created_at: string;
  restaurant_name: string;
}

export interface CreatorDetail {
  creator: {
    id: number;
    display_name: string | null;
    bio: string | null;
    city: string | null;
    categories: string[];
    languages: string[];
    avatar_url: string | null;
    base_rate_eur: number | null;
  };
  socials: CreatorSocial[];
  rating_avg: number | null;
  rating_count: number;
  reviews: CreatorReview[];
  my_review: { rating: number; comment: string | null } | null;
  can_review: boolean;
  already_invited: boolean;
}

export function listCreators(opts: { q?: string; platform?: string; category?: string } = {}):
  Promise<{ creators: CreatorSummary[] }> {
  const p = new URLSearchParams();
  if (opts.q) p.set("q", opts.q);
  if (opts.platform) p.set("platform", opts.platform);
  if (opts.category) p.set("category", opts.category);
  const qs = p.toString();
  return api(`/api/creators${qs ? "?" + qs : ""}`);
}

export function getCreator(creatorId: number, restaurantId?: number): Promise<CreatorDetail> {
  const q = restaurantId ? `?restaurant_id=${restaurantId}` : "";
  return api(`/api/creators/${creatorId}${q}`);
}

export function inviteCreator(restaurantId: number, creatorId: number):
  Promise<{ id: number; status: string }> {
  return api(`/api/restaurants/${restaurantId}/campaigns`, {
    method: "POST",
    json: { creator_id: creatorId, status: "proposed" },
  });
}

export function reviewCreator(restaurantId: number, creatorId: number, rating: number, comment: string):
  Promise<{ id: number; rating: number; comment: string | null }> {
  return api(`/api/restaurants/${restaurantId}/creators/${creatorId}/review`, {
    method: "POST",
    json: { rating, comment: comment || null },
  });
}

/* ---- messaging ----------------------------------------------------------- */

export interface Message {
  id: number;
  sender_role: "restaurant" | "creator";
  body: string;
  created_at: string;
}

export interface ThreadPeer {
  id: number;
  name: string | null;
  avatar: string | null;
}

export interface ThreadDetail {
  peer: ThreadPeer;
  messages: Message[];
}

// Restaurant's view: threads keyed by creator.
export interface RestaurantThread {
  creator_id: number;
  creator_name: string | null;
  creator_avatar: string | null;
  last_body: string | null;
  last_at: string | null;
  last_sender: string | null;
  unread: number;
}

// Creator's view: threads keyed by restaurant.
export interface CreatorThread {
  restaurant_id: number;
  restaurant_name: string | null;
  last_body: string | null;
  last_at: string | null;
  last_sender: string | null;
  unread: number;
}

export function listThreads(restaurantId: number): Promise<{ threads: RestaurantThread[] }> {
  return api(`/api/restaurants/${restaurantId}/messages`);
}
export function getThread(restaurantId: number, creatorId: number): Promise<ThreadDetail> {
  return api(`/api/restaurants/${restaurantId}/messages/${creatorId}`);
}
export function sendMessage(restaurantId: number, creatorId: number, body: string): Promise<Message> {
  return api(`/api/restaurants/${restaurantId}/messages/${creatorId}`, { method: "POST", json: { body } });
}

export function listCreatorThreads(): Promise<{ threads: CreatorThread[] }> {
  return api(`/api/creator/messages`);
}
export function getCreatorThread(restaurantId: number): Promise<ThreadDetail> {
  return api(`/api/creator/messages/${restaurantId}`);
}
export function sendCreatorMessage(restaurantId: number, body: string): Promise<Message> {
  return api(`/api/creator/messages/${restaurantId}`, { method: "POST", json: { body } });
}

/* ---- account management (reads + mutations) ------------------------------ */

export interface RestaurantProfileData {
  place_id?: string | null;
  name?: string;
  address?: string | null;
  city?: string | null;
  category?: string | null;
  tags?: string[];
  google_rating?: number | null;
  google_reviews?: number | null;
  description?: string | null;
  website?: string | null;
  logo_url?: string | null;
  price_level?: string | null;
}

export function getRestaurant(id: number):
  Promise<{ id: number; role: string; profile: RestaurantProfileData | null }> {
  return api(`/api/restaurants/${id}`);
}

export function getMenu(id: number): Promise<{ items: MenuItem[] }> {
  return api(`/api/restaurants/${id}/menu`);
}

export interface GuidelinesData {
  show: string[];
  must_include: string[];
  avoid: string[];
  handle: string | null;
  notes: string | null;
}

export function getGuidelines(id: number): Promise<{ guidelines: GuidelinesData | null }> {
  return api(`/api/restaurants/${id}/guidelines`);
}

export function deleteRestaurant(id: number): Promise<{ ok: boolean; status: string }> {
  return api(`/api/restaurants/${id}`, { method: "DELETE" });
}

export interface SubDetail {
  status: string;
  cadence?: "monthly" | "annual" | null;
  cancel_at_period_end?: boolean;
  current_period_end?: number | null;
  trial_end?: number | null;
}

export interface BillingDetail {
  spending_limit_eur: number | null;
  platform: SubDetail | null;
  usage: SubDetail | null;
}

export function getBilling(id: number): Promise<BillingDetail> {
  return api(`/api/restaurants/${id}/billing`);
}

export function cancelBilling(id: number): Promise<{ ok: boolean }> {
  return api(`/api/restaurants/${id}/billing/cancel`, { method: "POST" });
}

export function updateMe(display_name: string): Promise<{ ok: boolean }> {
  return api("/api/auth/me", { method: "PATCH", json: { display_name } });
}

export function changePassword(current_password: string, new_password: string): Promise<{ ok: boolean }> {
  return api("/api/auth/change-password", { method: "POST", json: { current_password, new_password } });
}

export function deleteAccount(): Promise<{ ok: boolean }> {
  return api("/api/auth/delete-account", { method: "POST" });
}

/* ---- menu digitization (auth-only; not restaurant-scoped) ---------------- */

export type MenuSource = { data: string } | { url: string };

async function postDigitize(source: MenuSource, mode: "fast" | "ai" = "fast"): Promise<MenuItem[]> {
  const data = await api<{ items?: MenuItem[] }>("/api/menu/digitize", {
    method: "POST",
    json: { ...source, mode },
  });
  return data.items ?? [];
}

export function digitizeMenu(base64Pdf: string): Promise<MenuItem[]> {
  return postDigitize({ data: base64Pdf });
}

export function digitizeMenuUrl(url: string): Promise<MenuItem[]> {
  return postDigitize({ url });
}

export function improveMenuWithAi(source: MenuSource): Promise<MenuItem[]> {
  return postDigitize(source, "ai");
}

/* ---- stripe (only used when configured) ---------------------------------- */

export function createSetupIntent(restaurantId: number):
  Promise<{ clientSecret: string; publishableKey: string | null }> {
  return api(`/api/restaurants/${restaurantId}/billing/setup-intent`, { method: "POST" });
}

export function createSubscription(restaurantId: number, cadence: "monthly" | "annual", promoCode?: string):
  Promise<{ clientSecret: string; publishableKey: string | null; subscriptionId: string; status: string; mode: "setup" | "payment" }> {
  return api(`/api/restaurants/${restaurantId}/billing/subscribe`, {
    method: "POST",
    json: { cadence, promo_code: promoCode || null },
  });
}

export interface PromoResult {
  valid: boolean;
  code?: string;
  percentOff?: number;
  amountOff?: number; // cents
}

export function validatePromo(restaurantId: number, code: string): Promise<PromoResult> {
  return api(`/api/restaurants/${restaurantId}/billing/promo`, { method: "POST", json: { code } });
}

/* ---- creator registration ------------------------------------------------ */

export interface SocialAccount {
  platform: "instagram" | "tiktok" | "youtube" | string;
  handle: string | null;
  follower_count: number | null;
  status: string; // pending | connected | expired | revoked
}

export function setCreatorHandles(h: { instagram?: string; tiktok?: string; youtube?: string }):
  Promise<{ ok: boolean }> {
  return api("/api/creator/handles", { method: "POST", json: h });
}

export function getCreatorHandles(): Promise<{ accounts: SocialAccount[]; instagramEnabled: boolean }> {
  return api("/api/creator/handles");
}

export function instagramConnectUrl(): Promise<{ url: string }> {
  return api("/api/creator/instagram/connect");
}

/* ---- admin (control tower) ----------------------------------------------- */

export interface FunnelStage {
  label: string;
  value: number;
}

export interface AdminOverview {
  restaurant_funnel: FunnelStage[];
  creator_funnel: FunnelStage[];
  payments: {
    // All monthly €. spending_limit already includes the platform fee.
    platform_fee: number | string;
    verified_restaurants: number;
    total_limit_incl_fee: number | string;
    total_limit_excl_fee: number | string;
    avg_limit_incl_fee: number | string;
    est_monthly_fees: number | string;
    all_restaurants_limit_incl_fee: number | string;
  };
  stats: {
    restaurants_total: number;
    restaurants_active: number;
    by_status: Record<string, number>;
    multi_restaurant_owners: number;
    creators_connected: number;
    signups_7d: number;
    signups_30d: number;
  };
}

export interface AdminRestaurant {
  id: number;
  name: string;
  status: string;
  spending_limit_eur: number | string | null;
  created_at: string;
  member_count: number;
  owner_emails: string;
  owner_verified: boolean;
}

export interface AdminAccount {
  id: number;
  email: string;
  display_name: string | null;
  email_verified: boolean;
  created_at: string;
  restaurant_count: number;
  restaurants: string; // comma-separated names of restaurants this account created
}

export interface AdminCreator {
  id: number;
  email: string;
  display_name: string | null;
  status: string;
  email_verified: boolean;
  created_at: string;
}

// Control-tower access is a single key (no account), sent as X-Admin-Key and
// kept in localStorage so it persists across reloads.
const ADMIN_KEY_STORAGE = "tt_admin_key";
let adminKey: string | null = (() => {
  try {
    return window.localStorage.getItem(ADMIN_KEY_STORAGE);
  } catch {
    return null;
  }
})();

export function setAdminKey(key: string | null): void {
  adminKey = key;
  try {
    if (key) window.localStorage.setItem(ADMIN_KEY_STORAGE, key);
    else window.localStorage.removeItem(ADMIN_KEY_STORAGE);
  } catch {
    /* ignore */
  }
}

export const getAdminKey = (): string | null => adminKey;

const adminHeaders = (): Record<string, string> =>
  adminKey ? { "X-Admin-Key": adminKey } : {};

export const getAdminOverview = () =>
  api<AdminOverview>("/api/admin/overview", { headers: adminHeaders() });
export const getAdminRestaurants = () =>
  api<{ restaurants: AdminRestaurant[] }>("/api/admin/restaurants", { headers: adminHeaders() });
export const getAdminAccounts = () =>
  api<{ accounts: AdminAccount[] }>("/api/admin/accounts", { headers: adminHeaders() });
export const getAdminCreators = () =>
  api<{ creators: AdminCreator[] }>("/api/admin/creators", { headers: adminHeaders() });

/* ---- outreach CRM (control tower) ---------------------------------------- */

export interface StageEvent {
  stage: string; // l1..l5
  changed_at: string; // ISO timestamp
}

export interface OutreachLead {
  id: number;
  place_id: string | null;
  name: string;
  address: string | null;
  outreach_date: string | null;
  stage: string; // l1..l5
  planned_l3: string | null;
  status: string; // active | cancelled
  cancel_reason: string | null; // reason code when cancelled
  created_at: string;
  events: StageEvent[]; // stage-transition log, oldest first
}

export const crmSearchPlaces = (q: string) =>
  api<{ results: PlaceSuggestion[] }>(
    `/api/admin/places/search?q=${encodeURIComponent(q)}`, { headers: adminHeaders() });

export const listLeads = () =>
  api<{ leads: OutreachLead[] }>("/api/admin/leads", { headers: adminHeaders() });

export const createLead = (place_id: string | null, name: string, address: string | null) =>
  api<OutreachLead>("/api/admin/leads", {
    method: "POST", json: { place_id, name, address }, headers: adminHeaders(),
  });

export const updateLead = (id: number, patch: Record<string, string | null>) =>
  api<OutreachLead>(`/api/admin/leads/${id}`, {
    method: "PATCH", json: patch, headers: adminHeaders(),
  });

export const setLeadStage = (id: number, stage: string) =>
  api<OutreachLead>(`/api/admin/leads/${id}/stage`, {
    method: "POST", json: { stage }, headers: adminHeaders(),
  });

export const deleteLead = (id: number) =>
  api<{ ok: boolean }>(`/api/admin/leads/${id}`, { method: "DELETE", headers: adminHeaders() });
