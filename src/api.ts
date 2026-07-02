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
    const detail = (await r.json().catch(() => ({}))) as { detail?: string };
    const err = new Error(detail.detail || `${path} failed: ${r.status}`) as Error & { status?: number };
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

/* ---- admin (control tower) ----------------------------------------------- */

export interface FunnelStage {
  label: string;
  value: number;
}

export interface AdminOverview {
  restaurant_funnel: FunnelStage[];
  creator_funnel: FunnelStage[];
  payments: {
    // All monthly €. spending_limit already includes the €50/mo platform fee.
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
