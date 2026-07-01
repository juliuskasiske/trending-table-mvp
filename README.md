# Trending Table — MVP

The restaurant **onboarding flow** for Trending Table. Its whole job is to ask
the restaurant for as little as possible: they search Google once and we pull in
name, logo, address, rating, category and description automatically — they just
confirm, set a budget, save a card, and pick content guidelines.

Built with **TypeScript + Vite** on the front end, a small **Express** backend
for the two integrations that need server-side secrets (**Google Places** and
**Stripe**), and the in-house **Risograph** design system.

## Getting started

```bash
npm install
cp .env.example .env     # then fill in your keys (see below)
npm run dev              # app + API on http://localhost:5173
```

Other scripts:

```bash
npm run build            # type-check + static build into dist/
npm start                # run the production server (serves dist/ + /api)
npm run typecheck        # type-check only
```

> The app **boots and the full UI works without any keys** — Places search and
> Stripe just show a "not configured" notice and let you enter details manually
> / skip payment. Add the keys to enable the real integrations.

## Keys (`.env`)

| Variable                  | Where to get it                                                        |
| ------------------------- | --------------------------------------------------------------------- |
| `GOOGLE_MAPS_API_KEY`     | Google Cloud → enable **Places API (New)** → create an API key         |
| `STRIPE_SECRET_KEY`       | Stripe Dashboard → Developers → API keys (`sk_test_…` to start)        |
| `STRIPE_PUBLISHABLE_KEY`  | Same page (`pk_test_…`) — sent to the browser to init Stripe.js        |
| `ANTHROPIC_API_KEY`       | [console.anthropic.com](https://console.anthropic.com/settings/keys) — powers PDF menu digitization |

The secret keys never reach the browser. The frontend reads only what
`/api/config` exposes (the publishable key + feature flags).

## The flow

```
account  →  find restaurant  →  budget & payment  →  content guidelines  →  review  →  done
```

1. **Create account** — the only thing typed by hand: email + password.
2. **Find your restaurant** — Google Places search. Picking a result prefills
   **name, logo (website favicon / place photo), address, Google rating,
   category and description** — all editable. A menu link is prefilled from the
   website. Alternatively, **upload a PDF menu** and it's digitized into
   structured `{section, name, price}` items via Claude. "Enter manually" is the
   fallback for the profile fields.
3. **Budget** — a monthly spending-limit slider with live maths
   (**€0.01 / view + €50 fee**). Payment is deferred: when Stripe keys are set,
   this step also shows a **Stripe Payment Element** that saves a card via a
   SetupIntent; without keys it reads as "coming soon" and no card is required
   to finish signing up.
4. **Content guidelines** — structured presets (what to show / must include /
   avoid) pre-picked with sensible defaults, a handle to tag, plus a free-text
   field.
5. **Review & confirm** — a summary with per-section _Edit_ jumps and a
   terms/fee consent gate.
6. **Done** — success screen. The assembled `RestaurantProfile` is logged to the
   console (this is where the account-creation POST will go once there's a DB).

## What maps to what

The full data model lives in [`src/types.ts`](src/types.ts). Every field you
listed is captured, and the ones that can be are auto-filled:

| Field                    | Source                                                    |
| ------------------------ | --------------------------------------------------------- |
| Email + password         | Account step (user)                                       |
| Name                     | Google Places (editable)                                  |
| Logo                     | Website favicon or Google place photo, monogram fallback  |
| Address                  | Google Places (editable)                                  |
| Google rating (average)  | Google Places                                             |
| Kurzbeschreibung         | Google Places editorial summary (editable)                |
| Kategorisierung          | Google Places primary type (editable)                     |
| Menu                     | Website menu link, **or** upload a PDF → digitized into structured items via Claude |
| Spending limit           | Budget slider (user)                                      |
| Payment method           | Stripe SetupIntent (saved card)                           |
| Content guidelines       | Structured presets + free text (user, with defaults)      |

## Project structure

```
index.html                 # all step markup (Vite entry)
vite.config.ts             # build/dev config; mounts the API into the dev server
server/
  api.mjs                  # Express router: /config, /places/*, /stripe/*
  api.d.mts                # ambient types so vite.config type-checks
  index.mjs                # production server (serves dist/ + /api)
src/
  main.ts                  # entry: loads styles, boots the controller
  onboarding.ts            # the multi-step controller
  api.ts                   # frontend API client + logo/star helpers
  types.ts                 # full data model, pricing, guideline presets
  styles/
    theme.css              # Risograph design tokens (in sync with the site)
    onboarding.css         # component styles, all driven by the tokens
```

## Notes

- **Progress persists** to `localStorage` so a refresh mid-flow keeps input.
- Pricing constants live in [`src/types.ts`](src/types.ts) (`PRICING`).
- Copy is English-only for now (the marketing site is EN/DE); the same
  `data-i18n` approach can be dropped in later.
