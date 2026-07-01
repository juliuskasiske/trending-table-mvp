/**
 * Trending Table MVP — API router.
 *
 * Proxies the two integrations that must keep their secret keys server-side:
 *   - Google Places API (New): restaurant search, details, and photo bytes.
 *   - Stripe: a SetupIntent so the restaurant can save a payment method.
 *
 * Mounted into the Vite dev server in development (see vite.config.ts) and by
 * server/index.mjs in production. All endpoints degrade gracefully when their
 * key is missing so the app still boots and the UI can explain what to add.
 */
import { Router } from "express";
import express from "express";
import Stripe from "stripe";
import Anthropic from "@anthropic-ai/sdk";

const PLACES_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_PUBLISHABLE = process.env.STRIPE_PUBLISHABLE_KEY || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";

const stripe = STRIPE_SECRET ? new Stripe(STRIPE_SECRET) : null;
// Reads ANTHROPIC_API_KEY from the environment; null when unset so the app boots.
const anthropic = ANTHROPIC_KEY ? new Anthropic() : null;

const PLACES_BASE = "https://places.googleapis.com/v1";

/** JSON Schema for a digitized menu — drives Claude's structured output. */
const MENU_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          section: { type: "string" },
          name: { type: "string" },
          price: { type: "string" },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

/** Map a Google `types` array to a friendly primary category + tag list. */
function classify(types = []) {
  const pretty = (t) =>
    t
      .replace(/_/g, " ")
      .replace(/\brestaurant\b/i, "")
      .trim()
      .replace(/^\w/, (c) => c.toUpperCase());
  const ignore = new Set([
    "point_of_interest",
    "establishment",
    "food",
    "restaurant",
  ]);
  const tags = types.filter((t) => !ignore.has(t)).map(pretty).filter(Boolean);
  const category = tags[0] || "Restaurant";
  return { category, tags: tags.slice(0, 4) };
}

export function createApiRouter() {
  const router = Router();
  // Menu PDFs arrive base64-encoded in the JSON body, so allow a large payload.
  router.use(express.json({ limit: "25mb" }));

  // ---- Public config (safe to expose) ---------------------------------
  router.get("/config", (_req, res) => {
    res.json({
      placesEnabled: Boolean(PLACES_KEY),
      menuAiEnabled: Boolean(anthropic),
      stripeEnabled: Boolean(stripe),
      stripePublishableKey: STRIPE_PUBLISHABLE || null,
      pricing: { ratePerView: 0.01, platformFee: 50 },
    });
  });

  // ---- Google Places: search ------------------------------------------
  router.get("/places/search", async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!PLACES_KEY) {
      return res
        .status(501)
        .json({ error: "not_configured", message: "Set GOOGLE_MAPS_API_KEY." });
    }
    if (q.length < 2) return res.json({ results: [] });

    try {
      const r = await fetch(`${PLACES_BASE}/places:searchText`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": PLACES_KEY,
          "X-Goog-FieldMask": [
            "places.id",
            "places.displayName",
            "places.formattedAddress",
            "places.rating",
            "places.userRatingCount",
            "places.primaryTypeDisplayName",
            "places.primaryType",
          ].join(","),
        },
        body: JSON.stringify({
          textQuery: q,
          includedType: "restaurant",
          maxResultCount: 5,
        }),
      });
      if (!r.ok) {
        const detail = await r.text();
        return res.status(502).json({ error: "places_error", detail });
      }
      const data = await r.json();
      const results = (data.places || []).map((p) => ({
        placeId: p.id,
        name: p.displayName?.text || "",
        address: p.formattedAddress || "",
        rating: p.rating,
        reviews: p.userRatingCount,
        primaryType: p.primaryTypeDisplayName?.text || p.primaryType || "",
      }));
      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: "server_error", message: String(err) });
    }
  });

  // ---- Google Places: details -----------------------------------------
  router.get("/places/details", async (req, res) => {
    const id = String(req.query.id || "").trim();
    if (!PLACES_KEY) {
      return res
        .status(501)
        .json({ error: "not_configured", message: "Set GOOGLE_MAPS_API_KEY." });
    }
    if (!id) return res.status(400).json({ error: "missing_id" });

    try {
      const r = await fetch(`${PLACES_BASE}/places/${encodeURIComponent(id)}`, {
        headers: {
          "X-Goog-Api-Key": PLACES_KEY,
          "X-Goog-FieldMask": [
            "id",
            "displayName",
            "formattedAddress",
            "rating",
            "userRatingCount",
            "types",
            "primaryTypeDisplayName",
            "editorialSummary",
            "websiteUri",
            "priceLevel",
            "photos",
          ].join(","),
        },
      });
      if (!r.ok) {
        const detail = await r.text();
        return res.status(502).json({ error: "places_error", detail });
      }
      const p = await r.json();
      const { category, tags } = classify(p.types || []);
      res.json({
        placeId: p.id,
        name: p.displayName?.text || "",
        address: p.formattedAddress || "",
        rating: p.rating,
        reviews: p.userRatingCount,
        category: p.primaryTypeDisplayName?.text || category,
        tags,
        description: p.editorialSummary?.text || "",
        website: p.websiteUri || "",
        priceLevel: p.priceLevel || "",
        photoName: p.photos?.[0]?.name || "",
      });
    } catch (err) {
      res.status(500).json({ error: "server_error", message: String(err) });
    }
  });

  // ---- Google Places: photo bytes (keeps the key server-side) ---------
  router.get("/places/photo", async (req, res) => {
    const name = String(req.query.name || "").trim();
    const maxWidth = Math.min(Number(req.query.w) || 320, 1200);
    if (!PLACES_KEY || !name) return res.status(404).end();
    try {
      const url = `${PLACES_BASE}/${name}/media?maxWidthPx=${maxWidth}&key=${PLACES_KEY}`;
      const r = await fetch(url, { redirect: "follow" });
      if (!r.ok) return res.status(502).end();
      res.setHeader("Content-Type", r.headers.get("content-type") || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      const buf = Buffer.from(await r.arrayBuffer());
      res.end(buf);
    } catch {
      res.status(500).end();
    }
  });

  // ---- Stripe: SetupIntent to save a payment method -------------------
  router.post("/stripe/setup-intent", async (req, res) => {
    if (!stripe) {
      return res
        .status(501)
        .json({ error: "not_configured", message: "Set STRIPE_SECRET_KEY." });
    }
    try {
      const email = String(req.body?.email || "").trim() || undefined;
      const name = String(req.body?.name || "").trim() || undefined;
      const customer = await stripe.customers.create({ email, name });
      const intent = await stripe.setupIntents.create({
        customer: customer.id,
        usage: "off_session", // we charge later for views + monthly fee
        automatic_payment_methods: { enabled: true },
      });
      res.json({ clientSecret: intent.client_secret, customerId: customer.id });
    } catch (err) {
      res.status(500).json({ error: "stripe_error", message: String(err) });
    }
  });

  // ---- Stripe: confirm which payment method got saved -----------------
  router.get("/stripe/payment-method", async (req, res) => {
    if (!stripe) return res.status(501).json({ error: "not_configured" });
    const id = String(req.query.id || "").trim(); // payment_method id
    if (!id) return res.status(400).json({ error: "missing_id" });
    try {
      const pm = await stripe.paymentMethods.retrieve(id);
      res.json({
        paymentMethodId: pm.id,
        brand: pm.card?.brand || pm.type,
        last4: pm.card?.last4 || "",
      });
    } catch (err) {
      res.status(500).json({ error: "stripe_error", message: String(err) });
    }
  });

  // ---- Menu: digitize a PDF into structured items --------------------
  router.post("/menu/digitize", async (req, res) => {
    if (!anthropic) {
      return res
        .status(501)
        .json({ error: "not_configured", message: "Set ANTHROPIC_API_KEY." });
    }
    const data = String(req.body?.data || ""); // base64 PDF, no data: prefix
    if (!data) return res.status(400).json({ error: "missing_pdf" });

    try {
      const message = await anthropic.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { format: { type: "json_schema", schema: MENU_SCHEMA } },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data },
              },
              {
                type: "text",
                text:
                  "This is a restaurant menu. Extract every menu item as structured data. " +
                  "For each item include its name, its price exactly as printed (e.g. \"€12,50\"), " +
                  "and the section/heading it appears under (e.g. \"Starters\", \"Pizza\", \"Drinks\"). " +
                  "Skip descriptions, allergen notes, and non-item text. Preserve the menu's order.",
              },
            ],
          },
        ],
      });
      // With output_config.format the first text block is the JSON payload.
      const text = message.content.find((b) => b.type === "text")?.text ?? "{}";
      const parsed = JSON.parse(text);
      const items = Array.isArray(parsed.items) ? parsed.items : [];
      res.json({ items, count: items.length });
    } catch (err) {
      res.status(500).json({ error: "digitize_error", message: String(err) });
    }
  });

  return router;
}

/**
 * A standalone Express app wrapping the router. Use this when mounting into a
 * connect-style host (like the Vite dev server) that doesn't provide Express's
 * `res.json` / `res.status` — the app augments req/res itself.
 */
export function createApiApp() {
  const app = express();
  app.use(createApiRouter());
  return app;
}
