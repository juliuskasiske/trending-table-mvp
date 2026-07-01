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
import OpenAI from "openai";
import { execFile } from "node:child_process";
import { writeFile, unlink, mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

const PLACES_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_PUBLISHABLE = process.env.STRIPE_PUBLISHABLE_KEY || "";

const stripe = STRIPE_SECRET ? new Stripe(STRIPE_SECRET) : null;

const PLACES_BASE = "https://places.googleapis.com/v1";

/* ---- Menu digitization: MarkItDown (PDF → markdown) + gpt-oss-120b --- */

// Python that runs MarkItDown. Prefer the project venv, else PYTHON_BIN/python3.
const PYTHON_BIN =
  process.env.PYTHON_BIN || join(__dirname, "..", ".venv", "bin", "python");
const MARKITDOWN_PY =
  "import sys\nfrom markitdown import MarkItDown\nsys.stdout.write(MarkItDown().convert(sys.argv[1]).text_content)";

// OpenAI-compatible LLM for the "agent" step (structuring markdown → items).
const LLM_BASE_URL = process.env.LLM_BASE_URL || "";
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "gpt-oss-120b";
const llm =
  LLM_BASE_URL && LLM_API_KEY
    ? new OpenAI({ baseURL: LLM_BASE_URL, apiKey: LLM_API_KEY })
    : null;

let markitdownReady = null; // cached availability check
async function isMarkitdownReady() {
  if (markitdownReady === null) {
    markitdownReady = execFileP(PYTHON_BIN, ["-c", "import markitdown"])
      .then(() => true)
      .catch(() => false);
  }
  return markitdownReady;
}

/** Convert a base64 PDF to markdown text via MarkItDown. */
async function pdfToMarkdown(base64) {
  const dir = await mkdtemp(join(tmpdir(), "tt-menu-"));
  const file = join(dir, "menu.pdf");
  await writeFile(file, Buffer.from(base64, "base64"));
  try {
    const { stdout } = await execFileP(PYTHON_BIN, ["-c", MARKITDOWN_PY, file], {
      maxBuffer: 25 * 1024 * 1024,
    });
    return stdout;
  } finally {
    await unlink(file).catch(() => {});
    await rmdir(dir).catch(() => {});
  }
}

/** Structure menu markdown into items using gpt-oss-120b (agent step). */
async function structureMenuWithLlm(markdown) {
  const resp = await llm.chat.completions.create({
    model: LLM_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          'You extract restaurant menu items from markdown. Respond with ONLY a JSON object of the form ' +
          '{"items":[{"section":string,"name":string,"price":string}]}. ' +
          "Use the price exactly as printed (e.g. €12,50). " +
          '"section" is the heading the item falls under (e.g. "Starters"). ' +
          "Omit dish descriptions, allergen notes, and non-item text. Preserve the menu's order.",
      },
      { role: "user", content: markdown },
    ],
  });
  const text = resp.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(text);
  return Array.isArray(parsed.items) ? parsed.items : [];
}

/**
 * Heuristic fallback when no LLM is configured: pull "Name … price" lines out of
 * the markdown, tracking the most recent heading as the section.
 */
function parseMenuMarkdown(markdown) {
  const priceRe = /^(.*\S)\s+((?:€|EUR|£|\$)?\s?\d{1,4}(?:[.,]\d{2})?\s?(?:€|EUR)?)\s*$/;
  const items = [];
  let section = "";
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.replace(/\*\*/g, "").trim();
    if (!line) continue;
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      section = heading[1].trim();
      continue;
    }
    const m = line.match(priceRe);
    if (m && m[1].length > 1) {
      items.push({ section, name: m[1].trim(), price: m[2].trim() });
    } else if (line.length < 40 && !/\d/.test(line)) {
      // short, price-free line → likely a section heading
      section = line;
    }
  }
  return items;
}

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
  router.get("/config", async (_req, res) => {
    res.json({
      placesEnabled: Boolean(PLACES_KEY),
      menuAiEnabled: await isMarkitdownReady(), // PDF → markdown available
      menuLlmEnabled: Boolean(llm), // gpt-oss-120b structuring available
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
  //  MarkItDown turns the PDF into markdown; gpt-oss-120b (or a heuristic
  //  fallback) turns the markdown into structured {section, name, price} items.
  router.post("/menu/digitize", async (req, res) => {
    if (!(await isMarkitdownReady())) {
      return res.status(501).json({
        error: "not_configured",
        message: "MarkItDown isn't installed on the server.",
      });
    }
    const data = String(req.body?.data || ""); // base64 PDF, no data: prefix
    if (!data) return res.status(400).json({ error: "missing_pdf" });

    try {
      const markdown = await pdfToMarkdown(data);
      const items = llm
        ? await structureMenuWithLlm(markdown)
        : parseMenuMarkdown(markdown);
      res.json({ items, count: items.length, source: llm ? "llm" : "heuristic" });
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
