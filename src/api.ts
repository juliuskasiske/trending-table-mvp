/**
 * Frontend API client — thin wrappers over the backend endpoints, plus a
 * couple of pure helpers (favicon logo, star markup) used by the UI.
 */
import type { MenuItem, PlaceDetails, PlaceSuggestion } from "./types.ts";

export interface AppConfig {
  placesEnabled: boolean;
  menuAiEnabled: boolean; // MarkItDown available (PDF → markdown)
  menuLlmEnabled: boolean; // gpt-oss-120b structuring available
  stripeEnabled: boolean;
  stripePublishableKey: string | null;
  pricing: { ratePerView: number; platformFee: number };
}

let configCache: AppConfig | null = null;

export async function getConfig(): Promise<AppConfig> {
  if (configCache) return configCache;
  const r = await fetch("/api/config");
  configCache = (await r.json()) as AppConfig;
  return configCache;
}

/** Search Google Places for restaurants. Returns [] when not configured. */
export async function searchPlaces(query: string): Promise<PlaceSuggestion[]> {
  const r = await fetch(`/api/places/search?q=${encodeURIComponent(query)}`);
  if (!r.ok) return [];
  const data = (await r.json()) as { results?: PlaceSuggestion[] };
  return data.results ?? [];
}

/** Fetch full details for a selected place. */
export async function getPlaceDetails(placeId: string): Promise<PlaceDetails> {
  const r = await fetch(`/api/places/details?id=${encodeURIComponent(placeId)}`);
  if (!r.ok) throw new Error(`details failed: ${r.status}`);
  return (await r.json()) as PlaceDetails;
}

/** URL for a Google place photo, proxied so the API key stays server-side. */
export function placePhotoUrl(photoName: string, width = 320): string {
  return `/api/places/photo?name=${encodeURIComponent(photoName)}&w=${width}`;
}

/** Best-effort logo: the website's favicon via Google's favicon service. */
export function faviconLogo(website: string | undefined, size = 128): string | undefined {
  if (!website) return undefined;
  try {
    const host = new URL(website).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=${size}`;
  } catch {
    return undefined;
  }
}

/** POST a digitize request (PDF bytes or a menu URL) and return the items. */
async function postDigitize(body: { data: string } | { url: string }): Promise<MenuItem[]> {
  const r = await fetch("/api/menu/digitize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message || `digitize failed: ${r.status}`);
  }
  const data = (await r.json()) as { items?: MenuItem[] };
  return data.items ?? [];
}

/** Digitize an uploaded PDF menu (base64, no data: prefix) into items. */
export function digitizeMenu(base64Pdf: string): Promise<MenuItem[]> {
  return postDigitize({ data: base64Pdf });
}

/** Digitize a menu web page (HTML link) into items via MarkItDown. */
export function digitizeMenuUrl(url: string): Promise<MenuItem[]> {
  return postDigitize({ url });
}

/** Create a Stripe SetupIntent so the restaurant can save a payment method. */
export async function createSetupIntent(
  email: string,
  name: string,
): Promise<{ clientSecret: string; customerId: string }> {
  const r = await fetch("/api/stripe/setup-intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, name }),
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message || `setup-intent failed: ${r.status}`);
  }
  return (await r.json()) as { clientSecret: string; customerId: string };
}

/** Look up the saved payment method to display brand + last4. */
export async function getPaymentMethod(
  id: string,
): Promise<{ paymentMethodId: string; brand: string; last4: string }> {
  const r = await fetch(`/api/stripe/payment-method?id=${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(`payment-method failed: ${r.status}`);
  return (await r.json()) as { paymentMethodId: string; brand: string; last4: string };
}
