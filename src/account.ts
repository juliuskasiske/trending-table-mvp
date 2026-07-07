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
import "./styles/messages.css";
import {
  changePassword,
  createCampaign,
  deleteAccount,
  digitizeMenuUrl,
  getCampaign,
  getGuidelines,
  getMe,
  getMenu,
  getRestaurant,
  getThread,
  launchCampaign,
  listCampaigns,
  listRestaurants,
  listThreads,
  logout,
  putGuidelines,
  putMenu,
  putProfile,
  resendVerification,
  sendMessage,
  type Campaign,
  type CampaignDetail,
  type CampaignPost,
  type Message,
  type Principal,
  type RestaurantSummary,
} from "./api.ts";
import { MenuItem } from "./types.ts";
import { getLang, initI18n, onLangChange, setLang, t } from "./i18n.ts";

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
  dashboard: svg('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>'),
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

/** Compact chat timestamp: today → HH:MM, otherwise a short date. */
const msgTime = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit" }).format(d)
    : new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short" }).format(d);
};

// campaign status → pill class + i18n label key
const statusMeta = (s: string): { cls: string; key: string } => {
  const map: Record<string, string> = {
    draft: "pending", active: "live", completed: "completed", cancelled: "cancelled",
  };
  return { cls: map[s] || "pending", key: s };
};

// € amount (backend returns numeric as a string like "500.00"), German-style trailing €.
const fmtEur = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(locale(), { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n) + " €";
};

/* ---- state --------------------------------------------------------------- */

type MainView = "campaigns" | "creators" | "messages" | "settings";
type SettingsTab = "restaurants" | "account";
type Tab = "profile" | "menu" | "guidelines";

let me: Principal | null = null;
let restaurants: RestaurantSummary[] = [];
let mainView: MainView = "campaigns";
let settingsTab: SettingsTab = "restaurants";
let detail: { id: number; tab: Tab } | null = null;
let campaignView: number | null = null; // open campaign id (detail view)
let msgActive: number | null = null; // creator_id of the open conversation
let msgPollTimer: number | undefined;
let msgLastId = 0; // latest painted message id (avoids needless re-render on poll)

const main = () => byId("acct-main")!;
const restName = () => restaurants[0]?.name || "Restaurant";
const activeRestaurant = (): RestaurantSummary | null => restaurants[0] || null;
const initial = (s: string | null | undefined) => (s || "?").trim().charAt(0).toUpperCase();
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
        <span class="rest-food">${ic.food}</span>
        <span class="rest-name">${esc(restName())}</span>
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
  if (mainView === "campaigns") { void renderCampaigns(m); return; }
  if (mainView === "creators") return renderComingSoon(m, "creators");
  if (mainView === "messages") { void renderMessages(m); return; }
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

function renderComingSoon(m: HTMLElement, key: MainView): void {
  m.innerHTML = `
    <div class="coming-wrap">
      <div class="coming-blur" aria-hidden="true">
        <h1 class="admin-title">${esc(t(`account.nav.${key}`))}</h1>
        ${fauxContent()}
      </div>
      <div class="coming-overlay">
        <div class="coming-badge">${esc(t("account.comingSoon"))}</div>
        <p>${esc(t("creators.verifying"))}</p>
      </div>
    </div>`;
}

/* ---- campaigns (restaurant) ---------------------------------------------- */

// Internal only — used to preview the expected-views estimate as the user types
// a budget. Never labelled as a rate in the UI (budget ÷ rate = views).
const VIEW_ESTIMATE_RATE = 0.015;
const estimateViews = (budget: number) => (budget > 0 ? Math.floor(budget / VIEW_ESTIMATE_RATE) : 0);

async function renderCampaigns(m: HTMLElement): Promise<void> {
  const r = activeRestaurant();
  if (!r) {
    m.innerHTML = `<h1 class="admin-title">${esc(t("account.nav.campaigns"))}</h1>
      <div class="pl-empty">${esc(t("campaigns.noRestaurant"))}</div>`;
    return;
  }
  if (campaignView !== null) return renderCampaignDetail(m, r.id, campaignView);

  m.innerHTML = `
    <div class="pl-toolbar">
      <h1 class="admin-title">${esc(t("account.nav.campaigns"))}</h1>
      <button type="button" class="btn-invite" id="camp-new">${ic.plus}<span>${esc(t("campaigns.new"))}</span></button>
    </div>
    <p class="pl-sub">${esc(t("campaigns.sub"))}</p>
    <div id="camp-form" hidden></div>
    <div id="pl-body"><p class="acct-loading">…</p></div>`;
  byId("camp-new")?.addEventListener("click", () => toggleCampaignForm(r));
  await loadCampaignList(r);
}

function toggleCampaignForm(r: RestaurantSummary): void {
  const box = byId("camp-form");
  if (!box) return;
  if (!box.hidden) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  box.innerHTML = `
    <div class="camp-create">
      <div class="camp-field"><label>${esc(t("campaigns.f.title"))}</label>
        <input class="input" id="cf-title" type="text" maxlength="120" /></div>
      <div class="camp-row">
        <div class="camp-field"><label>${esc(t("campaigns.f.budget"))}</label>
          <input class="input" id="cf-budget" type="number" min="1" step="1" /></div>
        <div class="camp-field"><label>${esc(t("campaigns.f.deadline"))}</label>
          <input class="input" id="cf-deadline" type="date" /></div>
      </div>
      <p class="camp-estimate" id="cf-estimate">${esc(t("campaigns.estimateHint"))}</p>
      <div class="camp-field"><label>${esc(t("campaigns.f.guidelines"))}</label>
        <textarea class="input" id="cf-guidelines" rows="3" placeholder="${esc(t("campaigns.f.guidelinesPh"))}"></textarea></div>
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
  byId("cf-create")?.addEventListener("click", async () => {
    const title = byId<HTMLInputElement>("cf-title")!.value.trim();
    const budgetV = Number(budget.value);
    const err = byId("cf-err")!;
    err.hidden = true;
    if (!title || !(budgetV > 0)) {
      err.hidden = false; err.textContent = t("campaigns.err.required"); return;
    }
    const notes = byId<HTMLTextAreaElement>("cf-guidelines")!.value.trim();
    const btn = byId<HTMLButtonElement>("cf-create")!;
    btn.disabled = true;
    try {
      await createCampaign(r.id, {
        title,
        budget_eur: budgetV,
        content_deadline: byId<HTMLInputElement>("cf-deadline")!.value || null,
        guidelines: notes ? { notes } : {},
      });
      box.hidden = true; box.innerHTML = "";
      await loadCampaignList(r);
    } catch (e) {
      btn.disabled = false;
      err.hidden = false; err.textContent = (e as Error).message || t("account.error.save");
    }
  });
  byId<HTMLInputElement>("cf-title")?.focus();
}

async function loadCampaignList(r: RestaurantSummary): Promise<void> {
  const body = byId("pl-body");
  if (!body) return;
  let campaigns: Campaign[];
  try {
    campaigns = (await listCampaigns(r.id)).campaigns;
  } catch {
    body.innerHTML = `<div class="pl-empty">${esc(t("account.error.load"))}</div>`;
    return;
  }
  if (mainView !== "campaigns" || campaignView !== null) return;
  if (!campaigns.length) {
    body.innerHTML = `<div class="pl-empty">${esc(t("campaigns.empty"))}</div>`;
    return;
  }
  const card = (c: Campaign): string => {
    const st = statusMeta(c.status);
    return `<button type="button" class="camp-card" data-cid="${c.id}">
      <div class="camp-card-head">
        <span class="camp-card-title">${esc(c.title || t("campaigns.untitled"))}</span>
        <span class="bk-status ${st.cls}">${esc(t(`campaigns.status.${st.key}`))}</span>
      </div>
      <div class="camp-card-stats">
        <span><b>${esc(fmtEur(c.budget_eur))}</b> ${esc(t("campaigns.budget"))}</span>
        <span><b>${esc(metricNum(c.estimated_views))}</b> ${esc(t("campaigns.estViews"))}</span>
        <span><b>${esc(metricNum(c.total_views))}</b> ${esc(t("campaigns.views"))}</span>
        <span><b>${c.posted_count}/${c.creators_count}</b> ${esc(t("campaigns.posted"))}</span>
      </div>
      ${c.content_deadline ? `<div class="camp-card-deadline">${ic.calendar}${esc(t("campaigns.by", { date: fmtISODate(c.content_deadline) }))}</div>` : ""}
    </button>`;
  };
  body.innerHTML = `<div class="camp-grid">${campaigns.map(card).join("")}</div>`;
  body.querySelectorAll<HTMLElement>(".camp-card").forEach((el) =>
    el.addEventListener("click", () => { campaignView = Number(el.dataset.cid); render(); }));
}

async function renderCampaignDetail(m: HTMLElement, rid: number, cid: number): Promise<void> {
  m.innerHTML = `
    <button type="button" class="ct-back" id="ct-back">← ${esc(t("campaigns.back"))}</button>
    <div id="pl-body"><p class="acct-loading">…</p></div>`;
  byId("ct-back")!.addEventListener("click", () => { campaignView = null; render(); });
  const body = byId("pl-body")!;

  let data: CampaignDetail;
  try {
    data = await getCampaign(rid, cid);
  } catch {
    body.innerHTML = `<div class="pl-empty">${esc(t("account.error.load"))}</div>`;
    return;
  }
  if (campaignView !== cid || mainView !== "campaigns") return;
  const c = data.campaign;
  const st = statusMeta(c.status);
  const g = (c.guidelines || {}) as { notes?: string };

  const stat = (icon: string, val: string, lbl: string) => `
    <div class="ct-stat"><span class="ct-stat-ic">${icon}</span><span class="ct-stat-txt">
      <span class="ct-stat-val">${esc(val)}</span><span class="ct-stat-lbl">${esc(lbl)}</span>
    </span></div>`;

  const totalViews = data.posts.reduce((s, p) => s + (p.latest_views || 0), 0);
  const launchBtn = c.status === "draft"
    ? `<button type="button" class="btn-review" id="camp-launch">${esc(t("campaigns.launch", { fee: "€9,99" }))}</button>`
    : "";

  const header = `
    <div class="ct-panel">
      <div class="camp-detail-head">
        <div>
          <div class="ct-name">${esc(c.title || t("campaigns.untitled"))}</div>
          <span class="bk-status ${st.cls}">${esc(t(`campaigns.status.${st.key}`))}</span>
        </div>
        ${launchBtn}
      </div>
      <div class="ct-stats camp-detail-stats">
        ${stat(ic.wallet, fmtEur(c.budget_eur), t("campaigns.budget"))}
        ${stat(ic.target, metricNum(c.estimated_views), t("campaigns.estViews"))}
        ${stat(ic.eye, metricNum(totalViews), t("campaigns.views"))}
        ${stat(ic.calendar, c.content_deadline ? fmtISODate(c.content_deadline) : "—", t("campaigns.deadline"))}
      </div>
      ${g.notes ? `<p class="camp-guidelines"><b>${esc(t("campaigns.guidelines"))}:</b> ${esc(g.notes)}</p>` : ""}
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

  body.innerHTML = header + grid;
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


/* ---- messages (two-pane inbox) ------------------------------------------- */

async function renderMessages(m: HTMLElement): Promise<void> {
  stopMsgPoll();
  const r = activeRestaurant();
  if (!r) {
    m.innerHTML = `<h1 class="admin-title">${esc(t("account.nav.messages"))}</h1>
      <div class="pl-empty">${esc(t("bookings.noRestaurant"))}</div>`;
    return;
  }
  m.innerHTML = `
    <h1 class="admin-title">${esc(t("account.nav.messages"))}</h1>
    <div class="msg-app${msgActive != null ? " thread-open" : ""}" id="msg-app">
      <div class="msg-list" id="msg-list"><p class="acct-loading" style="padding:20px">…</p></div>
      <div class="msg-convo" id="msg-convo"></div>
    </div>`;
  await loadThreadList(r);
  if (msgActive != null) await openConversation(r, msgActive);
  else renderConvoEmpty();
  msgPollTimer = window.setInterval(() => {
    if (mainView !== "messages") return;
    void loadThreadList(r);
    if (msgActive != null) void paintBubbles(r, msgActive, true);
  }, 5000);
}

function renderConvoEmpty(): void {
  const convo = byId("msg-convo");
  if (convo) convo.innerHTML = `<div class="msg-convo-empty">${esc(t("messages.selectThread"))}</div>`;
}

async function loadThreadList(r: RestaurantSummary): Promise<void> {
  const list = byId("msg-list");
  if (!list) return;
  let threads;
  try {
    threads = (await listThreads(r.id)).threads;
  } catch {
    list.innerHTML = `<div class="msg-list-empty">${esc(t("account.error.load"))}</div>`;
    return;
  }
  if (mainView !== "messages") return;
  list.innerHTML = threads.length
    ? threads.map((th) => {
        const name = th.creator_name || t("bookings.creatorFallback");
        const av = th.creator_avatar
          ? `<span class="msg-thread-av"${avatarStyle(th.creator_avatar)}></span>`
          : `<span class="msg-thread-av">${esc(initial(name))}</span>`;
        const preview = (th.last_sender === "restaurant" ? t("messages.youPrefix") + " " : "") + (th.last_body || "");
        const unread = th.unread > 0 ? `<span class="msg-unread">${th.unread}</span>` : "";
        return `<button type="button" class="msg-thread ${msgActive === th.creator_id ? "on" : ""}" data-cid="${th.creator_id}">
          ${av}
          <span class="msg-thread-main">
            <span class="msg-thread-top"><span class="msg-thread-name">${esc(name)}</span><span class="msg-thread-time">${esc(msgTime(th.last_at))}</span></span>
            <span class="msg-thread-preview">${esc(preview)}</span>
          </span>${unread}
        </button>`;
      }).join("")
    : `<div class="msg-list-empty">${esc(t("messages.noThreads"))}</div>`;
  list.querySelectorAll<HTMLElement>(".msg-thread").forEach((el) =>
    el.addEventListener("click", () => void openConversation(r, Number(el.dataset.cid))));
}

async function openConversation(r: RestaurantSummary, cid: number): Promise<void> {
  msgActive = cid;
  msgLastId = 0;
  byId("msg-app")?.classList.add("thread-open");
  byId("msg-list")?.querySelectorAll<HTMLElement>(".msg-thread")
    .forEach((el) => el.classList.toggle("on", Number(el.dataset.cid) === cid));
  const convo = byId("msg-convo");
  if (!convo) return;
  convo.innerHTML = `
    <div class="msg-convo-head" id="msg-head"></div>
    <div class="msg-bubbles" id="msg-bubbles"><p class="acct-loading" style="padding:20px">…</p></div>
    <div class="msg-composer">
      <textarea class="msg-input" id="msg-input" rows="1" placeholder="${esc(t("messages.placeholder"))}"></textarea>
      <button type="button" class="msg-send" id="msg-send" aria-label="${esc(t("messages.send"))}">${ic.send}</button>
    </div>`;
  const input = byId<HTMLTextAreaElement>("msg-input")!;
  const send = byId<HTMLButtonElement>("msg-send")!;
  const doSend = async (): Promise<void> => {
    const body = input.value.trim();
    if (!body) return;
    input.value = "";
    send.disabled = true;
    try {
      await sendMessage(r.id, cid, body);
      await paintBubbles(r, cid, false);
      await loadThreadList(r);
    } finally {
      send.disabled = false;
      input.focus();
    }
  };
  send.addEventListener("click", () => void doSend());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void doSend(); }
  });
  await paintBubbles(r, cid, false);
  input.focus();
}

async function paintBubbles(r: RestaurantSummary, cid: number, pollMode: boolean): Promise<void> {
  if (msgActive !== cid || mainView !== "messages") return;
  let th;
  try {
    th = await getThread(r.id, cid);
  } catch {
    return;
  }
  if (msgActive !== cid || mainView !== "messages") return;
  const msgs = th.messages;
  const latest = msgs.length ? msgs[msgs.length - 1].id : 0;
  if (pollMode && latest === msgLastId) return;
  msgLastId = latest;

  const name = th.peer.name || t("bookings.creatorFallback");
  const head = byId("msg-head");
  if (head) {
    const av = th.peer.avatar
      ? `<span class="msg-convo-av"${avatarStyle(th.peer.avatar)}></span>`
      : `<span class="msg-convo-av">${esc(initial(name))}</span>`;
    head.innerHTML = `<button type="button" class="msg-convo-back" id="msg-back" aria-label="${esc(t("messages.back"))}">${ic.chevronLeft}</button>${av}<span class="msg-convo-name">${esc(name)}</span>`;
    byId("msg-back")?.addEventListener("click", () => {
      msgActive = null;
      byId("msg-app")?.classList.remove("thread-open");
      byId("msg-list")?.querySelectorAll<HTMLElement>(".msg-thread").forEach((el) => el.classList.remove("on"));
      renderConvoEmpty();
    });
  }
  const bubbles = byId("msg-bubbles");
  if (bubbles) {
    bubbles.innerHTML = msgs.length
      ? msgs.map(bubble).join("")
      : `<div class="msg-convo-empty">${esc(t("messages.sayHi", { name }))}</div>`;
    bubbles.scrollTop = bubbles.scrollHeight;
  }
}

function bubble(mm: Message): string {
  const dir = mm.sender_role === "restaurant" ? "out" : "in";
  return `<div class="msg-row ${dir}"><div class="msg-bubble">${esc(mm.body)}</div><span class="msg-time">${esc(msgTime(mm.created_at))}</span></div>`;
}

function renderSettings(m: HTMLElement): void {
  const tab = (id: SettingsTab) =>
    `<button type="button" class="acct-subtab ${settingsTab === id ? "on" : ""}" data-st="${id}">${esc(t(`account.settings.${id}`))}</button>`;
  m.innerHTML = `
    <h1 class="admin-title">${esc(t("account.nav.settings"))}</h1>
    <div class="acct-subtabs">${tab("restaurants")}${tab("account")}</div>
    <div id="settings-body"><p class="acct-loading">…</p></div>`;
  m.querySelectorAll<HTMLElement>(".acct-subtab").forEach((b) =>
    b.addEventListener("click", () => openSettings(b.dataset.st as SettingsTab)),
  );
  const body = byId("settings-body")!;
  if (settingsTab === "account") renderAccountView(body);
  else if (detail) renderDetail(detail.id, detail.tab, body);
  else renderRestaurantsList(body);
}

/* ---- settings › restaurants --------------------------------------------- */

function planLabel(status: string | null): string {
  const key = `account.plan.${status ?? "none"}`;
  const label = t(key);
  return label === key ? (status ?? t("account.plan.none")) : label;
}

function renderRestaurantsList(body: HTMLElement): void {
  const cards = restaurants.length
    ? restaurants
        .map(
          (r) => `
      <button type="button" class="acct-card" data-open="${r.id}">
        <span class="acct-card-name">${esc(r.name || "—")}</span>
        <span class="acct-card-meta">
          <span class="pill ${esc(r.status)}">${esc(t(`account.rstatus.${r.status}`) || r.status)}</span>
          <span class="pill plan">${esc(planLabel(r.stripe_subscription_status))}</span>
        </span>
      </button>`,
        )
        .join("")
    : `<p class="acct-empty">${esc(t("account.rest.empty"))}</p>`;
  body.innerHTML = `
    <div class="acct-cards">${cards}</div>
    <a class="btn btn-primary acct-add" href="/register">${esc(t("account.rest.add"))}</a>`;
  body.querySelectorAll<HTMLElement>("[data-open]").forEach((b) =>
    b.addEventListener("click", () => openRestaurant(Number(b.dataset.open))),
  );
}

function renderDetail(id: number, tab: Tab, body: HTMLElement): void {
  const r = restaurants.find((x) => x.id === id);
  const tabs: Tab[] = ["profile", "menu", "guidelines"];
  body.innerHTML = `
    <button type="button" class="linklike acct-back" id="acct-back">← ${esc(t("account.settings.restaurants"))}</button>
    <h2 class="acct-detail-name">${esc(r?.name || "—")}</h2>
    <div class="acct-tabs">
      ${tabs.map((tb) => `<button type="button" class="acct-tab ${tb === tab ? "on" : ""}" data-tab="${tb}">${esc(t(`account.tab.${tb}`))}</button>`).join("")}
    </div>
    <div class="acct-tab-body" id="acct-tab-body"><p class="acct-loading">…</p></div>`;
  byId("acct-back")?.addEventListener("click", () => backToList());
  body.querySelectorAll<HTMLElement>(".acct-tab").forEach((b) =>
    b.addEventListener("click", () => setDetailTab(b.dataset.tab as Tab)),
  );
  const tb = byId("acct-tab-body")!;
  if (tab === "profile") void renderProfile(id, tb);
  else if (tab === "menu") void renderMenu(id, tb);
  else void renderGuidelines(id, tb);
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

async function renderGuidelines(id: number, body: HTMLElement): Promise<void> {
  const { guidelines: g } = await getGuidelines(id);
  const v = g ?? { show: [], must_include: [], avoid: [], handle: "", notes: "" };
  const join = (a: string[]) => (a ?? []).join(", ");
  body.innerHTML = `
    <p class="acct-note">${esc(t("account.g.hint"))}</p>
    ${field("g-show", t("account.g.show"), join(v.show))}
    ${field("g-must", t("account.g.must"), join(v.must_include))}
    ${field("g-avoid", t("account.g.avoid"), join(v.avoid))}
    ${field("g-handle", t("account.g.handle"), v.handle ?? "")}
    ${field("g-notes", t("account.g.notes"), v.notes ?? "", { area: true })}
    ${saveButton("g-save")}`;
  byId("g-save")?.addEventListener("click", async () => {
    const arr = (i: string) => (byId<HTMLInputElement>(i)?.value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    await putGuidelines(id, {
      show: arr("g-show"),
      must_include: arr("g-must"),
      avoid: arr("g-avoid"),
      handle: byId<HTMLInputElement>("g-handle")?.value.trim() || undefined,
      notes: byId<HTMLTextAreaElement>("g-notes")?.value.trim() || undefined,
    });
    flashSaved("g-save-ok");
  });
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
  if (v !== "messages") { msgActive = null; stopMsgPoll(); }
  mainView = v;
  campaignView = null;
  closeRestMenu();
  render();
}

function stopMsgPoll(): void {
  window.clearInterval(msgPollTimer);
  msgPollTimer = undefined;
}
function openSettings(tab: SettingsTab): void {
  mainView = "settings";
  settingsTab = tab;
  detail = null;
  closeRestMenu();
  render();
}
function openRestaurant(id: number): void {
  mainView = "settings";
  settingsTab = "restaurants";
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
  byId("menu-settings")?.addEventListener("click", () => openSettings(settingsTab));
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
