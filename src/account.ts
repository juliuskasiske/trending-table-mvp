/**
 * The logged-in restaurant "app" shell. Until the platform (dashboard,
 * creators, bookings, messages) is live, those nav tabs show a blurred
 * "coming soon" screen; the working account management lives under the
 * restaurant selector's Einstellungen (Settings) as two sub-tabs:
 * Restaurants and Konto. In-app route `/account`, lazy-loaded by the SPA.
 */
import "./styles/theme.css";
import "./styles/onboarding.css"; // shared card / field / input / button / chip
import "./styles/admin.css"; // shared .admin-title + .pill
import "./styles/account.css";
import "./styles/platform.css";
import {
  changePassword,
  createCampaign,
  createRestaurant,
  deleteAccount,
  deleteRestaurant,
  digitizeMenuUrl,
  getCampaign,
  getCampaignAnalytics,
  getMe,
  getMenu,
  getPlaceDetails,
  getRestaurant,
  launchCampaign,
  listCampaigns,
  listRestaurants,
  logout,
  putMenu,
  putProfile,
  resendVerification,
  searchPlaces,
  type Campaign,
  type CampaignAnalytics,
  type CampaignDetail,
  type CampaignPost,
  type Principal,
  type RestaurantProfileInput,
  type RestaurantSummary,
} from "./api.ts";
import { MenuItem, GUIDELINE_PRESETS, defaultGuidelines, type PlaceDetails, type PlaceSuggestion } from "./types.ts";
import { getLang, initI18n, onLangChange, setLang, t, tChip } from "./i18n.ts";
import { fmtEur } from "./format.ts";

const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T | null;

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

const locale = () => (getLang() === "de" ? "de-DE" : "en-US");

const svg = (paths: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ic = {
  restaurants: svg('<path d="M3 9l1.3-4.6A1 1 0 0 1 5.3 4h13.4a1 1 0 0 1 1 .7L21 9"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M9.5 20v-5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v5"/>'),
  creators: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 12 0v1"/>'),
  campaigns: svg('<path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>'),
  messages: svg('<path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  food: svg('<path d="M4 3v6a2 2 0 0 0 2 2 2 2 0 0 0 2-2V3M6 11v10M17 3c-1.7 0-3 2-3 4.5S15.3 12 17 12m0-9v18"/>'),
  chevron: svg('<path d="m6 9 6 6 6-6"/>'),
  logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'),
  heart: svg('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/>'),
  image: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>'),
  external: svg('<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
  at: svg('<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>'),
  pin: svg('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>'),
  people: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'),
  send: svg('<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>'),
  close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  chevronLeft: svg('<path d="m15 18-6-6 6-6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  wallet: svg('<path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M16 12h.01M3 9h14"/>'),
  target: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
  calendar: svg('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 9h18"/>'),
  comment: svg('<path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/>'),
  share: svg('<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v14"/>'),
  bookmark: svg('<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'),
  star: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2Z"/></svg>',
  starEmpty: svg('<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2Z"/>'),
};


// Brand-colored platform logos (fill-based, not the stroke icons above).
const LOGOS: Record<string, string> = {
  instagram: `<svg viewBox="0 0 24 24"><defs><linearGradient id="ig" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stop-color="#feda75"/><stop offset="25%" stop-color="#fa7e1e"/><stop offset="50%" stop-color="#d62976"/><stop offset="75%" stop-color="#962fbf"/><stop offset="100%" stop-color="#4f5bd5"/></linearGradient></defs><path fill="url(#ig)" d="M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.3 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.3 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.3 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .3-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.3-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.3-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c.1-1.2.3-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.3 2.2-.4C8.4 2.2 8.8 2.2 12 2.2m0 5.3A4.5 4.5 0 1 0 16.5 12 4.5 4.5 0 0 0 12 7.5m0 7.4A2.9 2.9 0 1 1 14.9 12 2.9 2.9 0 0 1 12 14.9m4.7-7.6a1.05 1.05 0 1 0 1.05 1.05A1.05 1.05 0 0 0 16.7 7.3"/></svg>`,
  tiktok: `<svg viewBox="0 0 24 24"><path fill="#171717" d="M16.6 5.8a4.3 4.3 0 0 1-1-2.8h-3v12.3a2.5 2.5 0 1 1-2.5-2.5c.26 0 .5.04.74.11V9.8a5.6 5.6 0 0 0-.74-.05A5.6 5.6 0 1 0 15.7 15.3V9.3a7.3 7.3 0 0 0 4.3 1.4V7.7a4.3 4.3 0 0 1-3.4-1.9"/></svg>`,
  youtube: `<svg viewBox="0 0 24 24"><path fill="#FF0000" d="M23.5 6.5a3 3 0 0 0-2.1-2.1C19.5 3.9 12 3.9 12 3.9s-7.5 0-9.4.5A3 3 0 0 0 .5 6.5 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.5 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.5"/><path fill="#fff" d="M9.6 15.5V8.5l6.2 3.5z"/></svg>`,
};
const platformLabel = (p: string): string =>
  ({ instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" })[p] || p;

/** Compact metric count: 12345 → "12,3k" (de) / "12.3k" (en). */
const metricNum = (n: number | null | undefined): string => {
  if (n == null) return "—";
  const dec = (v: number) => v.toFixed(1).replace(/\.0$/, "").replace(".", getLang() === "de" ? "," : ".");
  if (n >= 1_000_000) return dec(n / 1_000_000) + "M";
  if (n >= 1_000) return dec(n / 1_000) + "k";
  return new Intl.NumberFormat(locale()).format(n);
};

/** ISO "YYYY-MM-DD" → localized date (bookings scheduled_date is a date, not unix). */
const fmtISODate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "—";
  return new Intl.DateTimeFormat(locale(), { day: "numeric", month: "long", year: "numeric" })
    .format(new Date(y, m - 1, d));
};

/** Full ISO datetime string (e.g. posted_at "2026-07-06T21:27:16+02:00") → localized date. */
const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ""
    : new Intl.DateTimeFormat(locale(), { day: "numeric", month: "long", year: "numeric" }).format(d);
};

// Uniform status pill (shared .tt-pill base + per-status modifier). Campaign and
// restaurant statuses both use it so every pill is the same width and shape.
const CAMPAIGN_STATUSES = ["draft", "active", "completed", "cancelled"] as const;
const REST_STATUSES = ["provisioning", "active", "suspended", "deleted"] as const;
const campaignPill = (s: string): string =>
  `tt-pill tt-pill--${(CAMPAIGN_STATUSES as readonly string[]).includes(s) ? s : "draft"}`;
const restPill = (s: string): string =>
  `tt-pill tt-pill--${(REST_STATUSES as readonly string[]).includes(s) ? s : "provisioning"}`;


/* ---- state --------------------------------------------------------------- */

type MainView = "restaurants" | "campaigns" | "creators" | "messages" | "settings";
type Tab = "profile" | "menu";

let me: Principal | null = null;
let restaurants: RestaurantSummary[] = [];
let mainView: MainView = "restaurants";
let detail: { id: number; tab: Tab } | null = null; // open restaurant (manage) within the Restaurants view
let campaignView: { rid: number; cid: number } | null = null; // open campaign (detail view)

const main = () => byId("acct-main")!;
const acctName = () => me?.display_name || me?.email || "Account";
const avatarStyle = (url: string | null | undefined) =>
  url ? ` style="background-image:url('${esc(url)}')"` : "";

/* ---- shell (dark platform nav) ------------------------------------------- */

function shell(): string {
  const item = (v: MainView) =>
    `<button type="button" class="pnav-item" data-view="${v}">${ic[v as keyof typeof ic]}<span>${esc(t(`account.nav.${v}`))}</span></button>`;
  return `
<div class="platform-app">
  <aside class="pnav">
    <div class="pnav-logo">tt<span class="dot">.</span></div>
    <nav class="pnav-list">
      ${item("restaurants")}
      ${item("campaigns")}
      ${item("creators")}
      ${item("messages")}
    </nav>
    <div class="pnav-foot">
      <div class="rest-menu" id="rest-menu" hidden>
        <button type="button" class="rest-menu-item" id="menu-settings">${ic.settings}<span>${esc(t("account.nav.settings"))}</span></button>
        <div class="rest-menu-lang">
          <span>${esc(t("account.language"))}</span>
          <div class="account-lang" id="acct-lang"><button type="button" data-lang="de">DE</button><button type="button" data-lang="en">EN</button></div>
        </div>
        <button type="button" class="rest-menu-item" id="menu-logout">${ic.logout}<span>${esc(t("account.signout"))}</span></button>
      </div>
      <button type="button" class="rest-selector" id="rest-selector">
        <span class="rest-food">${ic.settings}</span>
        <span class="rest-name">${esc(acctName())}</span>
        <span class="rest-chevron">${ic.chevron}</span>
      </button>
    </div>
  </aside>
  <main class="platform-main" id="acct-main"></main>
</div>`;
}

function setNavActive(): void {
  document.querySelectorAll<HTMLElement>(".pnav-item").forEach((b) =>
    b.classList.toggle("on", b.dataset.view === mainView),
  );
  const sel = byId("rest-selector");
  if (sel) sel.classList.toggle("on", mainView === "settings");
}

/* ---- render -------------------------------------------------------------- */

function render(): void {
  setNavActive();
  const m = main();
  if (mainView === "restaurants") {
    if (detail) { renderRestaurantDetail(detail.id, detail.tab, m); return; }
    renderRestaurants(m);
    return;
  }
  if (mainView === "campaigns") { void renderCampaigns(m); return; }
  if (mainView === "creators") return renderComingSoon(m, "creators", "creators.verifying");
  if (mainView === "messages") return renderComingSoon(m, "messages", "messages.comingSoon");
  renderSettings(m);
}

/** Plausible (blurred) faux content per tab, so the coming-soon screen looks
 * like a real, densely populated page behind frosted glass. Only the creators
 * directory is blurred for now ("verifying creators"). */
function fauxContent(): string {
  const line = (w: string) => `<span class="fx-line" style="width:${w}"></span>`;
  const rep = (n: number, fn: (i: number) => string) => Array.from({ length: n }, (_, i) => fn(i)).join("");
  const av = () => `<span class="fx-avatar"></span>`;
  const pill = () => `<span class="fx-pill"></span>`;
  const btn = (c = "") => `<span class="fx-btn ${c}"></span>`;
  const toolbar = (right: string) => `<div class="fx-toolbar">${line("200px")}${right}</div>`;
  const card = () => `
    <div class="card fx-creator">
      <div class="fx-crow">${av()}<span class="fx-body">${line("74%")}${line("48%")}</span><span class="fx-num sm">12k</span></div>
      ${line("94%")}${line("72%")}
      <div class="fx-pills">${pill()}${pill()}${pill()}</div>
      <div class="fx-crow2">${line("42%")}${btn("sm")}</div>
    </div>`;
  return `
    ${toolbar(`<span class="fx-search"></span>`)}
    <div class="fx-filters row">${pill()}${pill()}${pill()}${pill()}</div>
    <div class="fx-cards">${rep(9, card)}</div>`;
}

function renderComingSoon(m: HTMLElement, key: MainView, subtitleKey: string): void {
  m.innerHTML = `
    <div class="coming-wrap">
      <div class="coming-blur" aria-hidden="true">
        <h1 class="admin-title">${esc(t(`account.nav.${key}`))}</h1>
        ${fauxContent()}
      </div>
      <div class="coming-overlay">
        <div class="coming-badge">${esc(t("account.comingSoon"))}</div>
        <p>${esc(t(subtitleKey))}</p>
      </div>
    </div>`;
}

/* ---- restaurants (the account's restaurants) ----------------------------- */

function renderRestaurants(m: HTMLElement): void {
  m.innerHTML = `
    <div class="pl-toolbar">
      <h1 class="admin-title">${esc(t("account.nav.restaurants"))}</h1>
      <button type="button" class="btn-invite" id="dash-new">${ic.plus}<span>${esc(t("restaurants.new"))}</span></button>
    </div>
    <p class="pl-sub">${esc(t("restaurants.sub"))}</p>
    <div id="dash-create" hidden></div>
    <div class="dash-grid" id="dash-grid"></div>`;
  byId("dash-new")?.addEventListener("click", toggleRestaurantForm);
  renderRestaurantCards();
}

function renderRestaurantCards(): void {
  const grid = byId("dash-grid");
  if (!grid) return;
  grid.innerHTML = restaurants.length
    ? restaurants.map((r) => `
      <div class="dash-card">
        <button type="button" class="dash-card-open" data-manage="${r.id}">
          <span class="dash-card-food">${ic.food}</span>
          <span class="dash-card-body">
            <span class="dash-card-name">${esc(r.name || "—")}</span>
            <span class="${restPill(r.status)}">${esc(t(`account.rstatus.${r.status}`) || r.status)}</span>
          </span>
        </button>
        <button type="button" class="dash-card-manage" data-manage="${r.id}">${esc(t("restaurants.manage"))}</button>
      </div>`).join("")
    : `<div class="pl-empty">${esc(t("restaurants.empty"))}</div>`;
  grid.querySelectorAll<HTMLElement>("[data-manage]").forEach((b) =>
    b.addEventListener("click", () => openRestaurant(Number(b.dataset.manage))));
}

async function createAndRefresh(profile: RestaurantProfileInput & { name: string }): Promise<void> {
  await createRestaurant(profile);
  restaurants = (await listRestaurants().catch(() => ({ restaurants }))).restaurants;
  const box = byId("dash-create");
  if (box) { box.hidden = true; box.innerHTML = ""; }
  renderRestaurantCards();
}

function toggleRestaurantForm(): void {
  const box = byId("dash-create");
  if (!box) return;
  if (!box.hidden) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  renderRestaurantSearch(box);
}

/** Step 1: search Google, or jump to the manual review form. */
function renderRestaurantSearch(box: HTMLElement): void {
  box.innerHTML = `
    <div class="camp-create">
      <div class="camp-field"><label>${esc(t("restaurants.search"))}</label>
        <div class="dash-search-row">
          <input class="input" id="dash-q" type="text" autocomplete="off" placeholder="${esc(t("restaurants.searchPh"))}" />
          <button type="button" class="btn-review" id="dash-search-btn">${esc(t("restaurants.searchBtn"))}</button>
        </div>
        <div class="dash-results" id="dash-results" hidden></div>
      </div>
      <div class="dash-manual">
        <span class="dash-or">${esc(t("restaurants.or"))}</span>
        <button type="button" class="linklike" id="dash-manual-toggle">${esc(t("restaurants.manualToggle"))}</button>
      </div>
      <p class="field-error" id="dash-err" hidden></p>
    </div>`;

  const results = byId("dash-results")!;
  const runSearch = async () => {
    const q = byId<HTMLInputElement>("dash-q")!.value.trim();
    if (q.length < 2) return;
    const btn = byId<HTMLButtonElement>("dash-search-btn")!;
    btn.disabled = true;
    results.hidden = false;
    results.innerHTML = `<div class="dash-result-empty">${esc(t("restaurants.searching"))}</div>`;
    let places: PlaceSuggestion[];
    try {
      places = await searchPlaces(q);
    } catch {
      results.innerHTML = `<div class="dash-result-empty">${esc(t("account.error.load"))}</div>`;
      return;
    } finally {
      btn.disabled = false;
    }
    if (!places.length) { results.innerHTML = `<div class="dash-result-empty">${esc(t("restaurants.noMatch"))}</div>`; return; }
    results.innerHTML = places.map((p) =>
      `<button type="button" class="dash-result" data-pid="${esc(p.placeId)}">
        <span class="dash-result-name">${esc(p.name)}</span><span class="dash-result-addr">${esc(p.address)}</span></button>`).join("");
    results.querySelectorAll<HTMLElement>(".dash-result").forEach((el) =>
      el.addEventListener("click", async () => {
        const p = places.find((x) => x.placeId === el.dataset.pid);
        if (!p) return;
        results.innerHTML = `<div class="dash-result-empty">${esc(t("restaurants.loadingDetails"))}</div>`;
        // Prefill the review form from Google, exactly like onboarding does.
        const details = await getPlaceDetails(p.placeId).catch(() => null);
        renderRestaurantReview(box, details ?? { placeId: p.placeId, name: p.name, address: p.address } as Partial<PlaceDetails>);
      }));
  };
  byId("dash-search-btn")?.addEventListener("click", () => void runSearch());
  byId<HTMLInputElement>("dash-q")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); void runSearch(); }
  });
  byId("dash-manual-toggle")?.addEventListener("click", () => renderRestaurantReview(box, {}));
  byId<HTMLInputElement>("dash-q")?.focus();
}

/** Step 2: review / edit the details (same fields onboarding collected) and create. */
function renderRestaurantReview(box: HTMLElement, p: Partial<PlaceDetails> & { city?: string }): void {
  const field = (id: string, label: string, value: string, area = false) => {
    const control = area
      ? `<textarea class="input" id="${id}" rows="2">${esc(value)}</textarea>`
      : `<input class="input" id="${id}" value="${esc(value)}" autocomplete="off" />`;
    return `<div class="camp-field"><label for="${id}">${esc(label)}</label>${control}</div>`;
  };
  box.innerHTML = `
    <div class="camp-create">
      <button type="button" class="linklike rest-back" id="rest-back">${esc(t("restaurants.backToSearch"))}</button>
      ${field("rf-name", t("account.profile.name"), p.name ?? "")}
      ${field("rf-category", t("account.profile.category"), p.category ?? "")}
      <div class="camp-row">
        ${field("rf-address", t("account.profile.address"), p.address ?? "")}
        ${field("rf-city", t("account.profile.city"), p.city ?? "")}
      </div>
      ${field("rf-website", t("account.profile.website"), p.website ?? "")}
      ${field("rf-description", t("account.profile.description"), p.description ?? "", true)}
      <p class="field-error" id="dash-err" hidden></p>
      <div class="camp-actions">
        <button type="button" class="btn-review" id="rf-create">${esc(t("restaurants.new"))}</button>
      </div>
    </div>`;
  byId("rest-back")?.addEventListener("click", () => renderRestaurantSearch(box));
  byId("rf-create")?.addEventListener("click", async () => {
    const val = (id: string) => byId<HTMLInputElement>(id)?.value.trim() ?? "";
    const name = val("rf-name");
    if (!name) { showDashErr(t("restaurants.err.name")); return; }
    const btn = byId<HTMLButtonElement>("rf-create")!;
    btn.disabled = true;
    try {
      await createAndRefresh({
        name,
        place_id: p.placeId,
        category: val("rf-category") || undefined,
        address: val("rf-address") || undefined,
        city: val("rf-city") || undefined,
        website: val("rf-website") || undefined,
        description: val("rf-description") || undefined,
        photo_ref: p.photoName,
        tags: p.tags,
        google_rating: p.rating,
        google_reviews: p.reviews,
        price_level: p.priceLevel,
      });
    } catch (e) {
      btn.disabled = false;
      showDashErr((e as Error).message);
    }
  });
  byId<HTMLInputElement>("rf-name")?.focus();
}

function showDashErr(msg: string): void {
  const err = byId("dash-err");
  if (err) { err.hidden = false; err.textContent = msg || t("account.error.save"); }
}

/* ---- campaigns (restaurant) ---------------------------------------------- */

// Internal only — used to preview the expected-views estimate as the user types
// a budget. Never labelled as a rate in the UI (budget ÷ rate = views).
const VIEW_ESTIMATE_RATE = 0.015;
const estimateViews = (budget: number) => (budget > 0 ? Math.floor(budget / VIEW_ESTIMATE_RATE) : 0);

async function renderCampaigns(m: HTMLElement): Promise<void> {
  if (campaignView !== null) return renderCampaignDetail(m, campaignView.rid, campaignView.cid);
  if (!restaurants.length) {
    m.innerHTML = `<h1 class="admin-title">${esc(t("account.nav.campaigns"))}</h1>
      <div class="pl-empty">${esc(t("campaigns.noRestaurant"))}</div>`;
    return;
  }
  m.innerHTML = `
    <div class="pl-toolbar">
      <h1 class="admin-title">${esc(t("account.nav.campaigns"))}</h1>
      <button type="button" class="btn-invite" id="camp-new">${ic.plus}<span>${esc(t("campaigns.new"))}</span></button>
    </div>
    <p class="pl-sub">${esc(t("campaigns.sub"))}</p>
    <div id="camp-form" hidden></div>
    <div id="pl-body"><p class="acct-loading">…</p></div>`;
  byId("camp-new")?.addEventListener("click", toggleCampaignForm);
  await loadCampaignList();
}

function toggleCampaignForm(): void {
  const box = byId("camp-form");
  if (!box) return;
  if (!box.hidden) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  const restOptions = restaurants.map((r) => `<option value="${r.id}">${esc(r.name || "—")}</option>`).join("");
  box.innerHTML = `
    <div class="camp-create">
      <div class="camp-field"><label>${esc(t("campaigns.f.restaurant"))}</label>
        <select class="input" id="cf-restaurant">${restOptions}</select></div>
      <div class="camp-field"><label>${esc(t("campaigns.f.title"))}</label>
        <input class="input" id="cf-title" type="text" maxlength="120" /></div>
      <div class="camp-row">
        <div class="camp-field"><label>${esc(t("campaigns.f.budget"))}</label>
          <input class="input" id="cf-budget" type="number" min="1" step="1" /></div>
        <div class="camp-field"><label>${esc(t("campaigns.f.deadline"))}</label>
          <input class="input" id="cf-deadline" type="date" /></div>
      </div>
      <p class="camp-estimate" id="cf-estimate">${esc(t("campaigns.estimateHint"))}</p>
      <div class="camp-guidelines">
        <p class="camp-gl-label">${esc(t("campaigns.f.guidelines"))}</p>
        ${GUIDELINE_GROUPS.map(guidelineGroupHtml).join("")}
        <div class="camp-field"><label>${esc(t("account.g.notes"))}</label>
          <textarea class="input" id="cf-notes" rows="2" placeholder="${esc(t("campaigns.g.notesPh"))}"></textarea></div>
      </div>
      <p class="field-error" id="cf-err" hidden></p>
      <div class="camp-actions">
        <button type="button" class="btn-review" id="cf-create">${esc(t("campaigns.create"))}</button>
      </div>
    </div>`;
  const budget = byId<HTMLInputElement>("cf-budget")!;
  const est = byId("cf-estimate")!;
  budget.addEventListener("input", () => {
    const v = Number(budget.value);
    est.textContent = v > 0
      ? t("campaigns.estimate", { n: new Intl.NumberFormat(locale()).format(estimateViews(v)) })
      : t("campaigns.estimateHint");
  });
  // Preset chips toggle on click; the + button lets the user add their own.
  const toggleChip = (c: HTMLElement) => c.addEventListener("click", () => c.classList.toggle("on"));
  box.querySelectorAll<HTMLElement>(".cf-chip").forEach(toggleChip);
  box.querySelectorAll<HTMLElement>(".cf-add").forEach((addBtn) => {
    addBtn.addEventListener("click", () => {
      const chips = addBtn.parentElement!;
      const input = document.createElement("input");
      input.className = "input cf-chip-input";
      input.placeholder = t("campaigns.g.addPh");
      chips.insertBefore(input, addBtn);
      addBtn.hidden = true;
      input.focus();
      let done = false;
      const commit = () => {
        if (done) return;
        done = true;
        const v = input.value.trim();
        if (v) {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "cf-chip on";
          chip.dataset.val = v;
          chip.textContent = v;
          toggleChip(chip);
          chips.insertBefore(chip, addBtn);
        }
        input.remove();
        addBtn.hidden = false;
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        else if (e.key === "Escape") { done = true; input.remove(); addBtn.hidden = false; }
      });
      input.addEventListener("blur", commit);
    });
  });
  byId("cf-create")?.addEventListener("click", async () => {
    const rid = Number(byId<HTMLSelectElement>("cf-restaurant")!.value);
    const title = byId<HTMLInputElement>("cf-title")!.value.trim();
    const budgetV = Number(budget.value);
    const err = byId("cf-err")!;
    err.hidden = true;
    if (!rid || !title || !(budgetV > 0)) {
      err.hidden = false; err.textContent = t("campaigns.err.required"); return;
    }
    const pick = (group: string) => Array.from(
      box.querySelectorAll<HTMLElement>(`.cf-chips[data-group="${group}"] .cf-chip.on`)).map((c) => c.dataset.val || "");
    const notes = byId<HTMLTextAreaElement>("cf-notes")!.value.trim();
    const guidelines = {
      show: pick("show"),
      must_include: pick("mustInclude"),
      avoid: pick("avoid"),
      ...(notes ? { notes } : {}),
    };
    const btn = byId<HTMLButtonElement>("cf-create")!;
    btn.disabled = true;
    try {
      await createCampaign(rid, {
        title,
        budget_eur: budgetV,
        content_deadline: byId<HTMLInputElement>("cf-deadline")!.value || null,
        guidelines,
      });
      box.hidden = true; box.innerHTML = "";
      await loadCampaignList();
    } catch (e) {
      btn.disabled = false;
      err.hidden = false; err.textContent = (e as Error).message || t("account.error.save");
    }
  });
  byId<HTMLSelectElement>("cf-restaurant")?.focus();
}

// Structured content guidelines — the same shape used across the app
// (show / must-include / avoid + notes), with the shared presets pre-checked
// from defaultGuidelines(). Each group ends with a + to add a custom value.
const GUIDELINE_GROUPS: Array<{ group: "show" | "mustInclude" | "avoid"; labelKey: string; presets: readonly string[] }> = [
  { group: "show", labelKey: "account.g.show", presets: GUIDELINE_PRESETS.show },
  { group: "mustInclude", labelKey: "account.g.must", presets: GUIDELINE_PRESETS.mustInclude },
  { group: "avoid", labelKey: "account.g.avoid", presets: GUIDELINE_PRESETS.avoid },
];
function guidelineGroupHtml(g: { group: "show" | "mustInclude" | "avoid"; labelKey: string; presets: readonly string[] }): string {
  const def = defaultGuidelines();
  const preselected = new Set<string>(def[g.group] as string[]);
  return `<div class="camp-field">
    <label>${esc(t(g.labelKey))}</label>
    <div class="cf-chips" data-group="${g.group}">
      ${g.presets.map((p) => `<button type="button" class="cf-chip${preselected.has(p) ? " on" : ""}" data-val="${esc(p)}">${esc(tChip(p))}</button>`).join("")}
      <button type="button" class="cf-add" aria-label="${esc(t("campaigns.g.add"))}" title="${esc(t("campaigns.g.add"))}">+</button>
    </div>
  </div>`;
}

type CampaignWithRest = Campaign & { _rname: string };

async function loadCampaignList(): Promise<void> {
  const body = byId("pl-body");
  if (!body) return;
  let all: CampaignWithRest[];
  try {
    const lists = await Promise.all(restaurants.map((r) =>
      listCampaigns(r.id).then((res) => res.campaigns.map((c) => ({ ...c, _rname: r.name || "—" })))));
    all = lists.flat().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  } catch {
    body.innerHTML = `<div class="pl-empty">${esc(t("account.error.load"))}</div>`;
    return;
  }
  if (mainView !== "campaigns" || campaignView !== null) return;
  if (!all.length) {
    body.innerHTML = `<div class="pl-empty">${esc(t("campaigns.empty"))}</div>`;
    return;
  }
  const card = (c: CampaignWithRest): string => {
    return `<button type="button" class="camp-card" data-cid="${c.id}" data-rid="${c.restaurant_id}">
      <div class="camp-card-head">
        <span class="camp-card-title">${esc(c.title || t("campaigns.untitled"))}</span>
        <span class="${campaignPill(c.status)}">${esc(t(`campaigns.status.${c.status}`))}</span>
      </div>
      <div class="camp-card-rest">${ic.food}<span>${esc(c._rname)}</span></div>
      <div class="camp-card-stats">
        <span><b>${esc(fmtEur(c.budget_eur))}</b> ${esc(t("campaigns.budget"))}</span>
        <span><b>${esc(metricNum(c.estimated_views))}</b> ${esc(t("campaigns.estViews"))}</span>
        <span><b>${esc(metricNum(c.total_views))}</b> ${esc(t("campaigns.views"))}</span>
        <span><b>${c.posted_count}/${c.creators_count}</b> ${esc(t("campaigns.posted"))}</span>
      </div>
      ${c.content_deadline ? `<div class="camp-card-deadline">${ic.calendar}${esc(t("campaigns.by", { date: fmtISODate(c.content_deadline) }))}</div>` : ""}
    </button>`;
  };
  body.innerHTML = `<div class="camp-grid">${all.map(card).join("")}</div>`;
  body.querySelectorAll<HTMLElement>(".camp-card").forEach((el) =>
    el.addEventListener("click", () => {
      campaignView = { rid: Number(el.dataset.rid), cid: Number(el.dataset.cid) };
      render();
    }));
}

/** Round a value up to a "nice" axis maximum (1/2/5 × 10ⁿ). */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / pow;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * pow;
}

/** Views-over-time line chart (risograph SVG), scaling to the container width. */
function buildViewsChart(series: Array<{ date: string; views: number }>): string {
  const W = 720, H = 240, mL = 52, mR = 18, mT = 16, mB = 34;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const n = series.length;
  const maxV = niceMax(Math.max(1, ...series.map((s) => s.views)));
  const x = (i: number) => mL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => mT + plotH - (v / maxV) * plotH;

  // horizontal gridlines + y labels at 0 / ½ / max
  const grid = [0, 0.5, 1].map((f) => {
    const gy = (mT + plotH - f * plotH).toFixed(1);
    return `<line x1="${mL}" y1="${gy}" x2="${mL + plotW}" y2="${gy}" stroke="rgba(23,23,23,0.12)" stroke-width="1"/>`
      + `<text x="${mL - 8}" y="${(Number(gy) + 4).toFixed(1)}" text-anchor="end" class="cv-lbl">${esc(metricNum(Math.round(f * maxV)))}</text>`;
  }).join("");

  const pts = series.map((s, i) => `${x(i).toFixed(1)},${y(s.views).toFixed(1)}`);
  const area = `<polygon points="${x(0).toFixed(1)},${(mT + plotH).toFixed(1)} ${pts.join(" ")} ${x(n - 1).toFixed(1)},${(mT + plotH).toFixed(1)}" fill="rgba(43,85,255,0.10)"/>`;
  const line = `<polyline points="${pts.join(" ")}" fill="none" stroke="var(--accent-2)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  const dots = n <= 12
    ? series.map((s, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(s.views).toFixed(1)}" r="3.5" fill="var(--accent-2)"/>`).join("")
    : "";

  // x labels: first + last date
  const xlabel = (i: number, anchor: string) =>
    `<text x="${x(i).toFixed(1)}" y="${H - 12}" text-anchor="${anchor}" class="cv-lbl">${esc(fmtISODate(series[i].date))}</text>`;
  const xlabels = n >= 1
    ? xlabel(0, "start") + (n > 1 ? xlabel(n - 1, "end") : "")
    : "";

  return `<svg viewBox="0 0 ${W} ${H}" class="cv-svg" role="img" aria-label="Views over time">
    ${grid}
    <line x1="${mL}" y1="${mT + plotH}" x2="${mL + plotW}" y2="${mT + plotH}" stroke="var(--ink)" stroke-width="1.5"/>
    ${area}${line}${dots}${xlabels}
  </svg>`;
}

function analyticsSection(a: CampaignAnalytics | null): string {
  if (!a || !a.totals || a.totals.post_count < 1) return "";
  const nnum = (v: number | string) => (typeof v === "string" ? parseFloat(v) : v) || 0;
  const stat = (icon: string, val: string, lbl: string) => `
    <div class="ct-stat"><span class="ct-stat-ic">${icon}</span><span class="ct-stat-txt">
      <span class="ct-stat-val">${esc(val)}</span><span class="ct-stat-lbl">${esc(lbl)}</span>
    </span></div>`;
  const chart = a.series.length
    ? buildViewsChart(a.series)
    : `<p class="camp-nodata">${esc(t("campaigns.noData"))}</p>`;
  return `
    <div class="ct-panel camp-analytics">
      <h3 class="camp-gl-title">${esc(t("campaigns.viewsOverTime"))}</h3>
      ${chart}
      <div class="ct-stats camp-engagement">
        ${stat(ic.heart, metricNum(nnum(a.totals.likes)), t("content.likes"))}
        ${stat(ic.comment, metricNum(nnum(a.totals.comments)), t("campaigns.comments"))}
        ${stat(ic.share, metricNum(nnum(a.totals.shares)), t("campaigns.shares"))}
        ${stat(ic.bookmark, metricNum(nnum(a.totals.saves)), t("campaigns.saves"))}
      </div>
    </div>`;
}

async function renderCampaignDetail(m: HTMLElement, rid: number, cid: number): Promise<void> {
  m.innerHTML = `
    <button type="button" class="ct-back" id="ct-back">← ${esc(t("campaigns.back"))}</button>
    <div id="pl-body"><p class="acct-loading">…</p></div>`;
  byId("ct-back")!.addEventListener("click", () => { campaignView = null; render(); });
  const body = byId("pl-body")!;

  let data: CampaignDetail;
  let analytics: CampaignAnalytics | null;
  try {
    [data, analytics] = await Promise.all([
      getCampaign(rid, cid),
      getCampaignAnalytics(rid, cid).catch(() => null),
    ]);
  } catch {
    body.innerHTML = `<div class="pl-empty">${esc(t("account.error.load"))}</div>`;
    return;
  }
  if (campaignView?.cid !== cid || mainView !== "campaigns") return;
  const c = data.campaign;
  const g = (c.guidelines || {}) as { show?: string[]; must_include?: string[]; avoid?: string[]; notes?: string };
  const glGroup = (labelKey: string, vals?: string[]) =>
    vals && vals.length
      ? `<div class="camp-gl-row"><span class="camp-gl-key">${esc(t(labelKey))}</span>
          <span class="camp-gl-vals">${vals.map((v) => `<span class="camp-gl-chip">${esc(tChip(v))}</span>`).join("")}</span></div>`
      : "";
  const glHtml = [
    glGroup("account.g.show", g.show),
    glGroup("account.g.must", g.must_include),
    glGroup("account.g.avoid", g.avoid),
  ].join("");

  const stat = (icon: string, val: string, lbl: string) => `
    <div class="ct-stat"><span class="ct-stat-ic">${icon}</span><span class="ct-stat-txt">
      <span class="ct-stat-val">${esc(val)}</span><span class="ct-stat-lbl">${esc(lbl)}</span>
    </span></div>`;

  const totalViews = data.posts.reduce((s, p) => s + (p.latest_views || 0), 0);
  const contacted = data.assignments.length;
  const posted = data.assignments.filter((a) => ["posted", "approved", "paid"].includes(a.status)).length;
  const launchBtn = c.status === "draft"
    ? `<button type="button" class="btn-review" id="camp-launch">${esc(t("campaigns.launch", { fee: "€9,99" }))}</button>`
    : "";

  const header = `
    <div class="ct-panel">
      <div class="camp-detail-head">
        <div>
          <div class="ct-name">${esc(c.title || t("campaigns.untitled"))}</div>
          <span class="${campaignPill(c.status)}">${esc(t(`campaigns.status.${c.status}`))}</span>
        </div>
        ${launchBtn}
      </div>
      <div class="ct-stats camp-detail-stats">
        ${stat(ic.wallet, fmtEur(c.budget_eur), t("campaigns.budget"))}
        ${stat(ic.target, metricNum(c.estimated_views), t("campaigns.estViews"))}
        ${stat(ic.eye, metricNum(totalViews), t("campaigns.views"))}
        ${stat(ic.people, `${posted}/${contacted}`, t("campaigns.creators"))}
        ${stat(ic.calendar, c.content_deadline ? fmtISODate(c.content_deadline) : "—", t("campaigns.deadline"))}
      </div>
      ${(glHtml || g.notes) ? `<div class="camp-gl-view"><h3 class="camp-gl-title">${esc(t("campaigns.guidelines"))}</h3>${glHtml}${g.notes ? `<p class="camp-gl-notes">${esc(g.notes)}</p>` : ""}</div>` : ""}
    </div>`;

  const postCard = (p: CampaignPost): string => {
    const type = p.media_product_type || p.media_type || "";
    const shot = p.thumbnail_url
      ? `<div class="ct-shot"${avatarStyle(p.thumbnail_url)}>`
      : `<div class="ct-shot"><span class="ct-shot-empty">${ic.image}</span>`;
    const logo = LOGOS[p.platform] ? `<span class="ct-logo">${LOGOS[p.platform]}</span>` : "";
    const typeBadge = type ? `<span class="ct-type">${esc(type.toLowerCase())}</span>` : "";
    const watch = p.permalink
      ? `<a class="ct-watch" href="${esc(p.permalink)}" target="_blank" rel="noopener noreferrer">${ic.external}${esc(t("content.watchOn", { platform: platformLabel(p.platform) }))}</a>`
      : "";
    return `
      <div class="ct-post">
        ${shot}${typeBadge}${logo}</div>
        <div class="ct-post-creator">${esc(p.creator_name || t("bookings.creatorFallback"))}</div>
        <div class="ct-stats">
          ${stat(ic.eye, metricNum(p.latest_views), t("content.views"))}
          ${stat(ic.heart, metricNum(p.latest_likes), t("content.likes"))}
        </div>
        <div class="ct-foot"><span class="ct-date">${esc(fmtDateTime(p.posted_at))}</span>${watch}</div>
      </div>`;
  };
  const grid = data.posts.length
    ? `<h2 class="ct-section-title">${esc(t("content.published"))}</h2><div class="ct-grid">${data.posts.map(postCard).join("")}</div>`
    : `<div class="pl-empty">${esc(t("campaigns.noPosts"))}</div>`;

  body.innerHTML = header + analyticsSection(analytics) + grid;
  byId("camp-launch")?.addEventListener("click", async () => {
    const btn = byId<HTMLButtonElement>("camp-launch")!;
    btn.disabled = true;
    try {
      await launchCampaign(rid, cid);
      await renderCampaignDetail(m, rid, cid);
    } catch (e) {
      btn.disabled = false;
      alert((e as Error).message || t("account.error.save"));
    }
  });
}

function renderSettings(m: HTMLElement): void {
  m.innerHTML = `
    <h1 class="admin-title">${esc(t("account.nav.settings"))}</h1>
    <div id="settings-body"><p class="acct-loading">…</p></div>`;
  renderAccountView(byId("settings-body")!);
}

/* ---- restaurant detail (manage: profile + menu) -------------------------- */

function renderRestaurantDetail(id: number, tab: Tab, m: HTMLElement): void {
  const r = restaurants.find((x) => x.id === id);
  const tabs: Tab[] = ["profile", "menu"];
  m.innerHTML = `
    <button type="button" class="ct-back" id="acct-back">← ${esc(t("account.nav.restaurants"))}</button>
    <h1 class="admin-title acct-detail-name">${esc(r?.name || "—")}</h1>
    <div class="acct-tabs">
      ${tabs.map((tb) => `<button type="button" class="acct-tab ${tb === tab ? "on" : ""}" data-tab="${tb}">${esc(t(`account.tab.${tb}`))}</button>`).join("")}
    </div>
    <div class="acct-tab-body" id="acct-tab-body"><p class="acct-loading">…</p></div>
    <div class="danger-zone">
      <h2>${esc(t("restaurants.delete"))}</h2>
      <p class="acct-note">${esc(t("restaurants.deleteHint"))}</p>
      <button type="button" class="btn btn-danger" id="rest-del">${esc(t("restaurants.delete"))}</button>
    </div>`;
  byId("acct-back")?.addEventListener("click", () => backToList());
  m.querySelectorAll<HTMLElement>(".acct-tab").forEach((b) =>
    b.addEventListener("click", () => setDetailTab(b.dataset.tab as Tab)),
  );
  byId("rest-del")?.addEventListener("click", () => {
    confirmBox(
      t("restaurants.delete"),
      t("restaurants.deleteConfirm", { name: r?.name ?? "" }),
      r?.name ?? "",
      async () => {
        await deleteRestaurant(id);
        restaurants = (await listRestaurants().catch(() => ({ restaurants }))).restaurants;
        backToList();
      },
    );
  });
  const tb = byId("acct-tab-body")!;
  if (tab === "profile") void renderProfile(id, tb);
  else void renderMenu(id, tb);
}

/** A labelled input row. */
function field(id: string, label: string, value: string, opts: { area?: boolean } = {}): string {
  const control = opts.area
    ? `<textarea class="input" id="${id}" rows="3">${esc(value)}</textarea>`
    : `<input class="input" id="${id}" value="${esc(value)}" />`;
  return `<div class="field"><label for="${id}">${esc(label)}</label>${control}</div>`;
}

function saveButton(id: string): string {
  return `<div class="acct-save-row"><button type="button" class="btn btn-ink" id="${id}">${esc(t("account.save"))}</button><span class="acct-saved" id="${id}-ok" hidden>${esc(t("account.saved"))}</span></div>`;
}

function flashSaved(okId: string): void {
  const ok = byId(okId);
  if (!ok) return;
  ok.hidden = false;
  window.setTimeout(() => (ok.hidden = true), 2000);
}

async function renderProfile(id: number, body: HTMLElement): Promise<void> {
  const { profile: p } = await getRestaurant(id);
  const v = p ?? {};
  body.innerHTML = `
    ${field("pf-name", t("account.profile.name"), v.name ?? "")}
    ${field("pf-address", t("account.profile.address"), v.address ?? "")}
    ${field("pf-city", t("account.profile.city"), v.city ?? "")}
    ${field("pf-category", t("account.profile.category"), v.category ?? "")}
    ${field("pf-tags", t("account.profile.tags"), (v.tags ?? []).join(", "))}
    ${field("pf-description", t("account.profile.description"), v.description ?? "", { area: true })}
    ${field("pf-website", t("account.profile.website"), v.website ?? "")}
    ${field("pf-logo", t("account.profile.logo"), v.logo_url ?? "")}
    ${field("pf-price", t("account.profile.price"), v.price_level ?? "")}
    ${saveButton("pf-save")}`;
  byId("pf-save")?.addEventListener("click", async () => {
    const val = (i: string) => byId<HTMLInputElement>(i)?.value.trim() ?? "";
    await putProfile(id, {
      name: val("pf-name"),
      address: val("pf-address"),
      city: val("pf-city"),
      category: val("pf-category"),
      tags: val("pf-tags").split(",").map((s) => s.trim()).filter(Boolean),
      description: val("pf-description"),
      website: val("pf-website"),
      logo_url: val("pf-logo"),
      price_level: val("pf-price"),
    });
    const r = restaurants.find((x) => x.id === id);
    if (r) r.name = val("pf-name") || r.name;
    flashSaved("pf-save-ok");
  });
}

async function renderMenu(id: number, body: HTMLElement): Promise<void> {
  const { items } = await getMenu(id);
  let rows: MenuItem[] = items.length ? items : [];

  const draw = () => {
    body.innerHTML = `
      <div class="menu-editor">
        ${rows
          .map(
            (it, i) => `
        <div class="menu-row" data-i="${i}">
          <input class="input" data-f="section" placeholder="${esc(t("account.menu.section"))}" value="${esc(it.section ?? "")}" />
          <input class="input" data-f="name" placeholder="${esc(t("account.menu.name"))}" value="${esc(it.name ?? "")}" />
          <input class="input" data-f="price" placeholder="${esc(t("account.menu.price"))}" value="${esc(it.price ?? "")}" />
          <button type="button" class="linklike menu-del" data-del="${i}">${esc(t("account.menu.remove"))}</button>
        </div>`,
          )
          .join("") || `<p class="acct-empty">${esc(t("account.menu.empty"))}</p>`}
      </div>
      <button type="button" class="linklike menu-add" id="menu-add">+ ${esc(t("account.menu.add"))}</button>
      <div class="field menu-scan">
        <label for="menu-url">${esc(t("account.menu.redigitizeUrl"))}</label>
        <div class="menu-scan-row">
          <input class="input" id="menu-url" placeholder="${esc(t("account.menu.urlPlaceholder"))}" />
          <button type="button" class="btn btn-ghost" id="menu-scan-btn">${esc(t("account.menu.scan"))}</button>
        </div>
        <p class="acct-note" id="menu-scan-note" hidden></p>
      </div>
      ${saveButton("menu-save")}`;
    body.querySelectorAll<HTMLElement>(".menu-row").forEach((row) => {
      const i = Number(row.dataset.i);
      row.querySelectorAll<HTMLInputElement>("input[data-f]").forEach((inp) => {
        inp.addEventListener("input", () => {
          const f = inp.dataset.f;
          if (f === "section") rows[i].section = inp.value;
          else if (f === "name") rows[i].name = inp.value;
          else if (f === "price") rows[i].price = inp.value;
        });
      });
    });
    body.querySelectorAll<HTMLElement>("[data-del]").forEach((b) =>
      b.addEventListener("click", () => {
        rows.splice(Number(b.dataset.del), 1);
        draw();
      }),
    );
    byId("menu-add")?.addEventListener("click", () => {
      rows.push({ name: "", section: "", price: "", source: "manual" });
      draw();
    });
    byId("menu-scan-btn")?.addEventListener("click", async () => {
      const url = byId<HTMLInputElement>("menu-url")?.value.trim();
      const note = byId("menu-scan-note");
      if (!url) return;
      if (note) {
        note.hidden = false;
        note.textContent = t("account.menu.scanning");
      }
      try {
        const found = await digitizeMenuUrl(url);
        rows = found.length ? found : rows;
        draw();
      } catch {
        if (note) note.textContent = t("account.menu.scanFail");
      }
    });
    byId("menu-save")?.addEventListener("click", async () => {
      await putMenu(id, rows.filter((r) => r.name.trim()));
      flashSaved("menu-save-ok");
    });
  };
  draw();
}

/* ---- settings › account -------------------------------------------------- */

function renderAccountView(body: HTMLElement): void {
  const verified = me?.email_verified;
  body.innerHTML = `
    <section class="card acct-section">
      <div class="bill-line"><span>${esc(t("account.acct.email"))}</span><b>${esc(me?.email ?? "")}</b></div>
      <div class="bill-line"><span>${esc(t("account.acct.status"))}</span>
        <span class="pill ${verified ? "yes" : "no"}">${esc(verified ? t("account.acct.verified") : t("account.acct.unverified"))}</span></div>
      ${verified ? "" : `<button type="button" class="linklike" id="ac-resend">${esc(t("account.acct.resend"))}</button><span class="acct-saved" id="ac-resend-ok" hidden>${esc(t("account.acct.resent"))}</span>`}
    </section>

    <section class="card acct-section">
      <h2 class="acct-section-title">${esc(t("account.acct.password"))}</h2>
      ${field("ac-cur", t("account.acct.currentPw"), "")}
      ${field("ac-new", t("account.acct.newPw"), "")}
      <p class="field-error" id="ac-pw-err" hidden></p>
      <div class="acct-save-row"><button type="button" class="btn btn-ink" id="ac-pw-save">${esc(t("account.acct.changePw"))}</button><span class="acct-saved" id="ac-pw-ok" hidden>${esc(t("account.acct.pwChanged"))}</span></div>
    </section>

    <div class="danger-zone">
      <h2>${esc(t("account.danger.title"))}</h2>
      <p class="acct-note">${esc(t("account.danger.deleteAccountHint"))}</p>
      <button type="button" class="btn btn-danger" id="del-acct">${esc(t("account.danger.deleteAccount"))}</button>
    </div>`;

  byId<HTMLInputElement>("ac-cur")!.type = "password";
  byId<HTMLInputElement>("ac-new")!.type = "password";

  byId("ac-resend")?.addEventListener("click", async () => {
    await resendVerification();
    flashSaved("ac-resend-ok");
  });
  byId("ac-pw-save")?.addEventListener("click", async () => {
    const cur = byId<HTMLInputElement>("ac-cur")?.value ?? "";
    const nw = byId<HTMLInputElement>("ac-new")?.value ?? "";
    const err = byId("ac-pw-err");
    if (err) err.hidden = true;
    try {
      await changePassword(cur, nw);
      byId<HTMLInputElement>("ac-cur")!.value = "";
      byId<HTMLInputElement>("ac-new")!.value = "";
      flashSaved("ac-pw-ok");
    } catch (e) {
      if (err) {
        err.hidden = false;
        err.textContent = (e as Error).message || t("account.error.save");
      }
    }
  });
  byId("del-acct")?.addEventListener("click", () => {
    confirmBox(
      t("account.danger.deleteAccount"),
      t("account.danger.deleteAccountConfirm", { email: me?.email ?? "" }),
      me?.email ?? "",
      async () => {
        await deleteAccount();
        window.location.assign("/login");
      },
    );
  });
}

/* ---- confirm dialog ------------------------------------------------------ */

function confirmBox(title: string, message: string, matchWord: string | null, onConfirm: () => Promise<void>): void {
  const wrap = document.createElement("div");
  wrap.className = "confirm-wrap";
  wrap.innerHTML = `
    <div class="confirm-box card">
      <h2>${esc(title)}</h2>
      <p>${esc(message)}</p>
      ${matchWord !== null ? `<input class="input" id="confirm-input" autocomplete="off" />` : ""}
      <div class="confirm-actions">
        <button type="button" class="btn btn-ghost" id="confirm-cancel">${esc(t("account.confirm.cancel"))}</button>
        <button type="button" class="btn btn-danger" id="confirm-ok" ${matchWord !== null ? "disabled" : ""}>${esc(t("account.confirm.confirm"))}</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const okBtn = wrap.querySelector<HTMLButtonElement>("#confirm-ok")!;
  const input = wrap.querySelector<HTMLInputElement>("#confirm-input");
  input?.addEventListener("input", () => {
    okBtn.disabled = input.value.trim() !== matchWord;
  });
  input?.focus();
  const close = () => wrap.remove();
  wrap.querySelector("#confirm-cancel")?.addEventListener("click", close);
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) close();
  });
  okBtn.addEventListener("click", async () => {
    okBtn.disabled = true;
    okBtn.textContent = t("account.confirm.working");
    try {
      await onConfirm();
    } catch (e) {
      okBtn.disabled = false;
      okBtn.textContent = t("account.confirm.confirm");
      const p = wrap.querySelector("p");
      if (p) p.textContent = (e as Error).message || t("account.error.save");
      return;
    }
    close();
  });
}

/* ---- navigation ---------------------------------------------------------- */

function navTo(v: MainView): void {
  mainView = v;
  campaignView = null;
  detail = null;
  closeRestMenu();
  render();
}

function openSettings(): void {
  mainView = "settings";
  detail = null;
  closeRestMenu();
  render();
}
function openRestaurant(id: number): void {
  mainView = "restaurants";
  detail = { id, tab: "profile" };
  render();
}
function setDetailTab(tab: Tab): void {
  if (detail) detail.tab = tab;
  render();
}
function backToList(): void {
  detail = null;
  render();
}

function closeRestMenu(): void {
  byId("rest-menu")!.hidden = true;
}

function wireShell(): void {
  document.querySelectorAll<HTMLElement>(".pnav-item").forEach((b) =>
    b.addEventListener("click", () => navTo(b.dataset.view as MainView)),
  );
  const menu = byId("rest-menu")!;
  byId("rest-selector")?.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !(e.target as HTMLElement).closest(".pnav-foot")) menu.hidden = true;
  });
  byId("menu-settings")?.addEventListener("click", () => openSettings());
  byId("menu-logout")?.addEventListener("click", async () => {
    await logout();
    window.location.assign("/login");
  });
  byId("acct-lang")
    ?.querySelectorAll<HTMLButtonElement>("button[data-lang]")
    .forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); setLang(b.dataset.lang as "en" | "de"); }));
  syncLangToggle();
}

function syncLangToggle(): void {
  byId("acct-lang")
    ?.querySelectorAll<HTMLButtonElement>("button[data-lang]")
    .forEach((b) => b.classList.toggle("on", b.dataset.lang === getLang()));
}

/** Boot: guard auth, then render the shell. */
export async function initAccount(): Promise<void> {
  initI18n(); // sets <html lang> + language state
  document.title = t("account.pageTitle");
  document.body.className = "theme-risograph account-page";
  me = await getMe().catch(() => null);
  if (!me || me.role !== "account") {
    window.location.assign("/login");
    return;
  }
  restaurants = (await listRestaurants().catch(() => ({ restaurants: [] }))).restaurants;
  document.body.innerHTML = shell();
  wireShell();
  render();
  onLangChange(() => {
    document.title = t("account.pageTitle");
    document.body.innerHTML = shell();
    wireShell();
    render();
  });
}
