/**
 * The complete restaurant data model.
 *
 * Design goal: the restaurant should *type* as little as possible during
 * onboarding. Everything under "Auto-filled from Google" is populated from a
 * single place lookup; the user only reviews it. The remaining groups are the
 * minimum the user has to provide themselves.
 */

/** A single menu entry. Menus are imported later; kept here for completeness. */
export interface MenuItem {
  name: string;
  price?: string;
  section?: string;
  source?: "llm" | "heuristic" | "manual" | string;
}

/** A search hit from Google Places (New) Text Search. */
export interface PlaceSuggestion {
  placeId: string;
  name: string;
  address: string;
  rating?: number;
  reviews?: number;
  primaryType?: string;
}

/** Full place details, used to prefill the profile. */
export interface PlaceDetails extends PlaceSuggestion {
  category: string; // Kategorisierung — friendly primary category
  tags: string[]; // secondary categories derived from Google types
  description: string; // Kurzbeschreibung — editorial summary when available
  city?: string; // pulled from Google's structured address components
  website?: string;
  priceLevel?: string;
  photoName?: string; // Google photo resource name (served via /api/places/photo)
}

/** Structured content guidelines with a free-text escape hatch. */
export interface ContentGuidelines {
  show: string[]; // what posts should feature
  mustInclude: string[]; // hard requirements on every post
  avoid: string[]; // restrictions
  handle: string; // social handle creators should tag
  notes: string; // free text
}

/** Saved Stripe payment method reference (no card data ever touches us). */
export interface PaymentInfo {
  connected: boolean;
  customerId?: string;
  paymentMethodId?: string;
  brand?: string;
  last4?: string;
}

/** The full profile assembled by the end of onboarding. */
export interface RestaurantProfile {
  /* Account (user input) */
  email: string;

  /* Auto-filled from Google (user only reviews) */
  placeId?: string;
  name: string;
  address: string;
  category: string;
  tags: string[];
  rating?: number;
  reviews?: number;
  description: string;
  website?: string;
  logoUrl?: string; // favicon of the website, or generated monogram
  photoName?: string;
  menu: MenuItem[];
  menuUrl?: string;

  /* Configuration (user input) */
  spendingLimit: number;
  payment: PaymentInfo;
  guidelines: ContentGuidelines;
}

/** Trending Table pricing — kept in sync with the marketing site. */
export const PRICING = {
  ratePerView: 0.01, // € per view
  platformFee: 50, // € per month
  cpm: 5, // creator reach benchmark, € per 1,000 views
} as const;

/** Preset options for the content-guidelines step. */
export const GUIDELINE_PRESETS = {
  show: [
    "Signature dishes",
    "Interior & atmosphere",
    "Drinks & cocktails",
    "Team & chef",
    "Plating close-ups",
    "Exterior / storefront",
  ],
  mustInclude: [
    "Tag our handle",
    "Add the location tag",
    "Show at least one dish",
  ],
  avoid: [
    "Other guests' faces",
    "Heavy alcohol focus",
    "Competitor mentions",
    "Off-brand filters",
  ],
} as const;

/** Sensible defaults so the guidelines step needs near-zero input. */
export function defaultGuidelines(): ContentGuidelines {
  return {
    show: ["Signature dishes", "Interior & atmosphere"],
    mustInclude: ["Tag our handle", "Add the location tag"],
    avoid: ["Other guests' faces"],
    handle: "",
    notes: "",
  };
}
