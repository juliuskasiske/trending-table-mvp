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

/** Thin fetch wrapper: JSON in/out, cookies included, errors carry the detail. */
async function api<T>(path: string, opts: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = opts;
  const r = await fetch(path, {
    credentials: "include",
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
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

export function signup(email: string, password: string, role: "account" | "creator" = "account"):
  Promise<Principal & { dev_verify_token?: string }> {
  return api("/api/auth/signup", { method: "POST", json: { email, password, role } });
}

export function login(email: string, password: string, role: "account" | "creator" = "account"):
  Promise<Principal> {
  return api("/api/auth/login", { method: "POST", json: { email, password, role } });
}

export function logout(): Promise<{ ok: boolean }> {
  return api("/api/auth/logout", { method: "POST" });
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
  try {
    const data = await api<{ results?: PlaceSuggestion[] }>(
      `/api/places/search?q=${encodeURIComponent(query)}`,
    );
    return data.results ?? [];
  } catch {
    return [];
  }
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
