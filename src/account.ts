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
  cancelBilling,
  changePassword,
  deleteAccount,
  deleteRestaurant,
  digitizeMenuUrl,
  getBilling,
  getGuidelines,
  getCreator,
  getMe,
  getMenu,
  getRestaurant,
  getThread,
  inviteCreator,
  listBookings,
  listCreators,
  listPosts,
  listRestaurants,
  listThreads,
  logout,
  putBilling,
  putGuidelines,
  putMenu,
  putProfile,
  resendVerification,
  reviewCreator,
  sendMessage,
  type BillingDetail,
  type Booking,
  type CreatorDetail,
  type CreatorSummary,
  type Message,
  type Principal,
  type RestaurantPost,
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
const fmtDate = (unix: number | null | undefined): string =>
  unix ? new Intl.DateTimeFormat(locale(), { day: "numeric", month: "long", year: "numeric" }).format(new Date(unix * 1000)) : "—";

const svg = (paths: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ic = {
  dashboard: svg('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>'),
  creators: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 12 0v1"/>'),
  bookings: svg('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 9h18"/><path d="m9 15 2 2 4-4"/>'),
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
  star: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2Z"/></svg>',
  starEmpty: svg('<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2Z"/>'),
};

/** A row of 5 stars, `n` filled (rounded). */
const starRow = (n: number | null | undefined): string => {
  const filled = Math.round(n || 0);
  return `<span class="cr-stars">${Array.from({ length: 5 }, (_, i) =>
    i < filled ? ic.star : ic.starEmpty).join("")}</span>`;
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

// campaign status → mockup pill class + i18n label key
const statusMeta = (s: string): { cls: string; key: string } => {
  const map: Record<string, string> = {
    proposed: "pending", accepted: "confirmed", live: "live",
    completed: "completed", cancelled: "cancelled",
  };
  return { cls: map[s] || "pending", key: s };
};

/* ---- state --------------------------------------------------------------- */

type MainView = "dashboard" | "creators" | "bookings" | "messages" | "settings";
type SettingsTab = "restaurants" | "account";
type Tab = "profile" | "menu" | "guidelines" | "billing";

let me: Principal | null = null;
let restaurants: RestaurantSummary[] = [];
let mainView: MainView = "settings";
let settingsTab: SettingsTab = "restaurants";
let detail: { id: number; tab: Tab } | null = null;
let bookingView: number | null = null; // campaign id whose posts are being viewed
let creatorQuery = ""; // directory search text
let creatorPlatform = ""; // directory platform filter ("" = all)
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
      ${item("dashboard")}
      ${item("creators")}
      ${item("bookings")}
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
  if (mainView === "bookings") { void renderBookings(m); return; }
  if (mainView === "creators") { void renderCreators(m); return; }
  if (mainView === "messages") { void renderMessages(m); return; }
  if (mainView !== "settings") return renderComingSoon(m, mainView);
  renderSettings(m);
}

/** Plausible (blurred) faux content per tab, so the coming-soon screen looks
 * like a real, densely populated page behind frosted glass. */
function fauxContent(key: MainView): string {
  const line = (w: string) => `<span class="fx-line" style="width:${w}"></span>`;
  const rep = (n: number, fn: (i: number) => string) => Array.from({ length: n }, (_, i) => fn(i)).join("");
  const av = (c = "") => `<span class="fx-avatar ${c}"></span>`;
  const pill = () => `<span class="fx-pill"></span>`;
  const tag = () => `<span class="fx-tag"></span>`;
  const btn = (c = "") => `<span class="fx-btn ${c}"></span>`;
  const toolbar = (right: string) => `<div class="fx-toolbar">${line("200px")}${right}</div>`;

  if (key === "dashboard") {
    const stat = (n: string) => `<div class="card fx-stat"><div class="fx-num">${n}</div>${line("64%")}<span class="fx-spark"></span></div>`;
    const bars = [52, 74, 60, 88, 66, 96, 54, 80, 70, 92, 50, 84, 62, 90]
      .map((h) => `<span class="fx-bar" style="height:${h}%"></span>`).join("");
    return `
      ${toolbar(btn())}
      <div class="fx-stats fx-stats-4">${stat("2.481")}${stat("18")}${stat("€1.240")}${stat("7")}</div>
      <div class="fx-two">
        <div class="card fx-chart">
          <div class="fx-legend">${pill()}${pill()}</div>
          <div class="fx-bars">${bars}</div>
          <div class="fx-xaxis">${rep(7, () => `<span class="fx-line" style="width:20px"></span>`)}</div>
        </div>
        <div class="card fx-side">
          ${line("52%")}
          ${rep(6, () => `<div class="fx-row"><span class="fx-avatar sm"></span><span class="fx-body">${line("64%")}</span>${line("20%")}</div>`)}
        </div>
      </div>
      <div class="card fx-table">
        <div class="fx-tr fx-th">${line("70%")}${line("70%")}${line("60%")}${line("50%")}</div>
        ${rep(6, () => `<div class="fx-tr"><span class="fx-td">${av("sm")}${line("70%")}</span>${line("60%")}${tag()}${line("55%")}</div>`)}
      </div>`;
  }

  if (key === "creators") {
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

  if (key === "bookings") {
    return `
      ${toolbar(btn())}
      <div class="fx-filters row">${pill()}${pill()}${pill()}${pill()}</div>
      <div class="card fx-table">
        <div class="fx-tr book fx-th">${line("70%")}${line("60%")}${line("50%")}${line("50%")}${line("40%")}</div>
        ${rep(9, () => `<div class="fx-tr book"><span class="fx-td">${av("sm")}${line("72%")}</span>${line("62%")}${pill()}${tag()}${line("55%")}</div>`)}
      </div>`;
  }

  // messages — a two-pane chat app
  const convo = () => `<div class="fx-convo">${av("sm")}<span class="fx-body">${line("62%")}${line("86%")}</span><span class="fx-time">${line("100%")}</span></div>`;
  const bubble = (dir: "in" | "out", w: string) => `<span class="fx-bubble ${dir}" style="width:${w}"></span>`;
  return `
    <div class="fx-msgapp">
      <div class="card fx-convos">
        <span class="fx-search"></span>
        ${rep(8, convo)}
      </div>
      <div class="card fx-thread">
        <div class="fx-thread-head">${av("sm")}<span class="fx-body">${line("40%")}${line("24%")}</span></div>
        <div class="fx-bubbles">
          ${bubble("in", "58%")}${bubble("out", "46%")}${bubble("in", "72%")}${bubble("out", "52%")}
          ${bubble("in", "38%")}${bubble("out", "64%")}${bubble("in", "50%")}${bubble("out", "44%")}
        </div>
        <div class="fx-composer">${line("100%")}${btn("sm")}</div>
      </div>
    </div>`;
}

function renderComingSoon(m: HTMLElement, key: MainView): void {
  m.innerHTML = `
    <div class="coming-wrap">
      <div class="coming-blur" aria-hidden="true">
        <h1 class="admin-title">${esc(t(`account.nav.${key}`))}</h1>
        ${fauxContent(key)}
      </div>
      <div class="coming-overlay">
        <div class="coming-badge">${esc(t("account.comingSoon"))}</div>
        <p>${esc(t("account.comingSoonSub"))}</p>
      </div>
    </div>`;
}

/* ---- bookings (Buchungen) ------------------------------------------------ */

async function renderBookings(m: HTMLElement): Promise<void> {
  const r = activeRestaurant();
  if (!r) {
    m.innerHTML = `<h1 class="admin-title">${esc(t("account.nav.bookings"))}</h1>
      <div class="pl-empty">${esc(t("bookings.noRestaurant"))}</div>`;
    return;
  }
  if (bookingView !== null) return renderPostView(m, r.id, bookingView);

  m.innerHTML = `
    <div class="pl-toolbar"><h1 class="admin-title">${esc(t("account.nav.bookings"))}</h1></div>
    <p class="pl-sub">${esc(t("bookings.sub"))}</p>
    <div id="pl-body"><p class="acct-loading">…</p></div>`;
  const body = byId("pl-body")!;

  let bookings: Booking[];
  try {
    bookings = (await listBookings(r.id)).campaigns;
  } catch {
    body.innerHTML = `<div class="pl-empty">${esc(t("account.error.load"))}</div>`;
    return;
  }
  if (bookingView !== null || mainView !== "bookings") return; // navigated away while loading
  if (!bookings.length) {
    body.innerHTML = `<div class="pl-empty">${esc(t("bookings.empty"))}</div>`;
    return;
  }

  const row = (b: Booking): string => {
    const sm = statusMeta(b.status);
    const name = b.creator_name || b.creator_email || t("bookings.creatorFallback");
    const av = b.creator_avatar
      ? `<span class="bk-avatar"${avatarStyle(b.creator_avatar)}></span>`
      : `<span class="bk-avatar">${esc(initial(name))}</span>`;
    const content = b.post_count > 0
      ? `<button type="button" class="bk-view-link" data-cid="${b.id}">${esc(t("bookings.viewContent", { n: String(b.post_count) }))}</button>`
      : `<span class="bk-muted">${esc(b.status === "cancelled" ? "—" : t("bookings.awaiting"))}</span>`;
    return `<tr>
      <td><span class="bk-creator">${av}<span>${esc(name)}</span></span></td>
      <td>${b.deliverable ? esc(b.deliverable) : '<span class="bk-muted">—</span>'}</td>
      <td>${b.scheduled_date ? esc(fmtISODate(b.scheduled_date)) : '<span class="bk-muted">—</span>'}</td>
      <td><span class="bk-status ${sm.cls}">${esc(t(`bookings.status.${sm.key}`))}</span></td>
      <td>${content}</td>
    </tr>`;
  };

  body.innerHTML = `
    <div class="bk-wrap"><table class="bk-table">
      <thead><tr>
        <th>${esc(t("bookings.col.creator"))}</th>
        <th>${esc(t("bookings.col.deliverable"))}</th>
        <th>${esc(t("bookings.col.date"))}</th>
        <th>${esc(t("bookings.col.status"))}</th>
        <th>${esc(t("bookings.col.content"))}</th>
      </tr></thead>
      <tbody>${bookings.map(row).join("")}</tbody>
    </table></div>`;

  body.querySelectorAll<HTMLElement>(".bk-view-link").forEach((btn) =>
    btn.addEventListener("click", () => { bookingView = Number(btn.dataset.cid); render(); }));
}

/* ---- post view (the restaurant sees the creator's published posts) ------- */

async function renderPostView(m: HTMLElement, rid: number, cid: number): Promise<void> {
  m.innerHTML = `
    <button type="button" class="ct-back" id="ct-back">← ${esc(t("content.back"))}</button>
    <div id="pl-body"><p class="acct-loading">…</p></div>`;
  byId("ct-back")!.addEventListener("click", () => { bookingView = null; render(); });
  const body = byId("pl-body")!;

  let bookings: Booking[];
  let posts: RestaurantPost[];
  try {
    [bookings, posts] = await Promise.all([
      listBookings(rid).then((r) => r.campaigns),
      listPosts(rid, cid).then((r) => r.posts),
    ]);
  } catch {
    body.innerHTML = `<div class="pl-empty">${esc(t("account.error.load"))}</div>`;
    return;
  }
  if (bookingView !== cid || mainView !== "bookings") return; // navigated away while loading

  const bk = bookings.find((c) => c.id === cid);
  const name = bk?.creator_name || bk?.creator_email || t("bookings.creatorFallback");
  const handle = posts[0]?.creator_handle || null;
  const avatar = bk?.creator_avatar || posts[0]?.creator_avatar || null;
  const av = avatar
    ? `<div class="ct-avatar"${avatarStyle(avatar)}></div>`
    : `<div class="ct-avatar">${esc(initial(name))}</div>`;

  const creatorPanel = `
    <div class="ct-panel ct-creator">
      ${av}
      <div class="ct-creator-info">
        <div class="ct-name">${esc(name)}</div>
        ${handle ? `<div class="ct-handle">${ic.at}${esc(handle.replace(/^@/, ""))}</div>` : ""}
      </div>
    </div>`;

  const stat = (icon: string, val: string, lbl: string) => `
    <div class="ct-stat"><span class="ct-stat-ic">${icon}</span><span class="ct-stat-txt">
      <span class="ct-stat-val">${esc(val)}</span><span class="ct-stat-lbl">${esc(lbl)}</span>
    </span></div>`;

  const card = (p: RestaurantPost): string => {
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
        <div class="ct-stats">
          ${stat(ic.eye, metricNum(p.latest_views), t("content.views"))}
          ${stat(ic.heart, metricNum(p.latest_likes), t("content.likes"))}
        </div>
        <div class="ct-foot">
          <span class="ct-date">${esc(fmtDateTime(p.posted_at))}</span>
          ${watch}
        </div>
      </div>`;
  };

  const grid = posts.length
    ? `<h2 class="ct-section-title">${esc(t("content.published"))}</h2><div class="ct-grid">${posts.map(card).join("")}</div>`
    : `<div class="pl-empty">${esc(t("content.noPosts"))}</div>`;

  body.innerHTML = creatorPanel + grid;
}

/* ---- creators directory (Creator finden) --------------------------------- */

let searchTimer: number | undefined;

async function renderCreators(m: HTMLElement): Promise<void> {
  const r = activeRestaurant();
  const chip = (plat: string, label: string) =>
    `<button type="button" class="pl-chip ${creatorPlatform === plat ? "on" : ""}" data-plat="${plat}">${esc(label)}</button>`;
  m.innerHTML = `
    <div class="pl-toolbar">
      <h1 class="admin-title">${esc(t("account.nav.creators"))}</h1>
      <input id="cr-search" class="cr-search" type="search" placeholder="${esc(t("creators.search"))}" value="${esc(creatorQuery)}" />
    </div>
    <div class="pl-filters">
      ${chip("", t("creators.all"))}
      ${chip("instagram", "Instagram")}
      ${chip("tiktok", "TikTok")}
      ${chip("youtube", "YouTube")}
    </div>
    <div id="cr-grid"><p class="acct-loading">…</p></div>`;

  const search = byId<HTMLInputElement>("cr-search");
  search?.addEventListener("input", () => {
    creatorQuery = search.value.trim();
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void loadCreatorGrid(r), 300);
  });
  m.querySelectorAll<HTMLElement>(".pl-chip").forEach((b) =>
    b.addEventListener("click", () => {
      creatorPlatform = b.dataset.plat || "";
      m.querySelectorAll(".pl-chip").forEach((x) => x.classList.toggle("on", x === b));
      void loadCreatorGrid(r);
    }));
  await loadCreatorGrid(r);
}

async function loadCreatorGrid(r: RestaurantSummary | null): Promise<void> {
  const grid = byId("cr-grid");
  if (!grid) return;
  let creators: CreatorSummary[];
  try {
    creators = (await listCreators({ q: creatorQuery, platform: creatorPlatform })).creators;
  } catch {
    grid.innerHTML = `<div class="pl-empty">${esc(t("account.error.load"))}</div>`;
    return;
  }
  if (mainView !== "creators") return;
  grid.innerHTML = creators.length
    ? `<div class="cr-grid">${creators.map(creatorCard).join("")}</div>`
    : `<div class="pl-empty">${esc(t("creators.empty"))}</div>`;
  grid.querySelectorAll<HTMLElement>(".cr-card").forEach((el) =>
    el.addEventListener("click", () => void openCreatorModal(Number(el.dataset.cid), r)));
}

function creatorCard(c: CreatorSummary): string {
  const name = c.display_name || t("bookings.creatorFallback");
  const logos = (c.socials || [])
    .map((s) => `<span class="cr-plat" title="${esc(platformLabel(s.platform))}">${LOGOS[s.platform] || ""}</span>`)
    .join("");
  const cats = c.categories.slice(0, 3).map((x) => `<span class="cr-cat">${esc(x)}</span>`).join("");
  const rating = c.rating_count > 0
    ? `${starRow(c.rating_avg)}<span class="cr-rating-val">${esc(metricNum(c.rating_avg))}</span><span class="cr-rating-n">(${c.rating_count})</span>`
    : `<span class="cr-norating">${esc(t("creators.noRating"))}</span>`;
  const photo = c.avatar_url
    ? `<div class="cr-photo"${avatarStyle(c.avatar_url)}>`
    : `<div class="cr-photo cr-photo-blank"><span class="cr-photo-init">${esc(initial(name))}</span>`;
  return `
    <article class="cr-card" data-cid="${c.id}">
      ${photo}<span class="cr-foll">${ic.people}${esc(metricNum(c.follower_total))}</span></div>
      <div class="cr-body">
        <div class="cr-name">${esc(name)}</div>
        ${c.city ? `<div class="cr-loc">${ic.pin}${esc(c.city)}</div>` : ""}
        ${logos ? `<div class="cr-plats">${logos}</div>` : ""}
        ${cats ? `<div class="cr-cats">${cats}</div>` : ""}
        <div class="cr-rating">${rating}</div>
      </div>
    </article>`;
}

/* ---- creator detail modal (profile + socials + rating + invite/review) --- */

async function openCreatorModal(cid: number, r: RestaurantSummary | null): Promise<void> {
  let ov = byId("cr-modal");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "cr-modal";
    ov.className = "crm-overlay";
    document.body.appendChild(ov);
    ov.addEventListener("click", (e) => { if (e.target === ov) closeCreatorModal(); });
  }
  ov.hidden = false;
  document.body.classList.add("no-scroll");
  ov.innerHTML = `<div class="crm-panel"><p class="acct-loading" style="padding:48px">…</p></div>`;
  await paintCreatorModal(cid, r);
}

function closeCreatorModal(): void {
  const ov = byId("cr-modal");
  if (ov) { ov.hidden = true; ov.innerHTML = ""; }
  document.body.classList.remove("no-scroll");
}

async function paintCreatorModal(cid: number, r: RestaurantSummary | null): Promise<void> {
  const ov = byId("cr-modal");
  if (!ov) return;
  let d: CreatorDetail;
  try {
    d = await getCreator(cid, r?.id);
  } catch {
    ov.innerHTML = `<div class="crm-panel"><button type="button" class="crm-close" id="crm-close">${ic.close}</button><p class="pl-empty">${esc(t("account.error.load"))}</p></div>`;
    byId("crm-close")?.addEventListener("click", closeCreatorModal);
    return;
  }
  const c = d.creator;
  const name = c.display_name || t("bookings.creatorFallback");
  const av = c.avatar_url
    ? `<div class="crm-avatar"${avatarStyle(c.avatar_url)}></div>`
    : `<div class="crm-avatar crm-avatar-blank">${esc(initial(name))}</div>`;

  const socialRows = d.socials.map((s) => `
    <div class="crm-social">
      <span class="crm-social-logo">${LOGOS[s.platform] || ""}</span>
      <span class="crm-social-handle">${esc(s.handle || platformLabel(s.platform))}</span>
      <span class="crm-social-foll">${esc(metricNum(s.follower_count))}</span>
    </div>`).join("");

  const chips = (arr: string[]) => arr.map((x) => `<span class="cd-tag">${esc(x)}</span>`).join("");

  const ratingBlock = d.rating_count > 0
    ? `<div class="crm-rating">
         <div class="crm-rating-top">${starRow(d.rating_avg)}<span class="crm-rating-val">${esc(metricNum(d.rating_avg))}</span></div>
         <span class="crm-rating-n">${esc(t("creators.reviewCount", { n: String(d.rating_count) }))}</span>
       </div>`
    : `<div class="crm-rating crm-rating-none">${esc(t("creators.noRating"))}</div>`;

  const reviews = d.reviews.length
    ? `<div class="crm-reviews">
        <div class="cd-section-title">${esc(t("creators.reviews"))}</div>
        ${d.reviews.map((rv) => `
          <div class="crm-review">
            <div class="crm-review-head">${starRow(rv.rating)}<span class="crm-review-rest">${esc(rv.restaurant_name)}</span></div>
            ${rv.comment ? `<p class="crm-review-body">${esc(rv.comment)}</p>` : ""}
          </div>`).join("")}
      </div>`
    : "";

  // Invite button state
  const inviteBtn = d.already_invited
    ? `<button type="button" class="btn-invite" disabled>${ic.send}<span>${esc(t("creators.invited"))}</span></button>`
    : `<button type="button" class="btn-invite" id="crm-invite">${ic.send}<span>${esc(t("creators.invite"))}</span></button>`;

  // Review form — only after a completed collaboration
  let reviewForm = "";
  if (d.can_review) {
    const cur = d.my_review?.rating || 0;
    const starBtns = Array.from({ length: 5 }, (_, i) =>
      `<button type="button" class="crm-star ${i < cur ? "on" : ""}" data-star="${i + 1}">${i < cur ? ic.star : ic.starEmpty}</button>`).join("");
    reviewForm = `
      <div class="crm-reviewform" data-rating="${cur}">
        <div class="cd-section-title">${esc(d.my_review ? t("creators.yourRating") : t("creators.rate"))}</div>
        <div class="crm-stars-pick" id="crm-stars">${starBtns}</div>
        <textarea class="crm-comment" id="crm-comment" rows="2" placeholder="${esc(t("creators.commentPlaceholder"))}">${esc(d.my_review?.comment || "")}</textarea>
        <div class="crm-review-actions">
          <button type="button" class="btn-review" id="crm-submit">${esc(d.my_review ? t("creators.updateReview") : t("creators.submitReview"))}</button>
          <span class="crm-review-msg" id="crm-review-msg"></span>
        </div>
      </div>`;
  }

  ov.innerHTML = `
    <div class="crm-panel">
      <button type="button" class="crm-close" id="crm-close">${ic.close}</button>
      <div class="crm-head">
        ${av}
        <div class="crm-head-info">
          <div class="crm-name">${esc(name)}</div>
          ${c.city ? `<div class="crm-loc">${ic.pin}${esc(c.city)}</div>` : ""}
          ${ratingBlock}
        </div>
      </div>
      ${c.bio ? `<p class="crm-bio">${esc(c.bio)}</p>` : ""}
      ${c.categories.length ? `<div class="cd-section-title">${esc(t("creators.specialties"))}</div><div class="cd-tags">${chips(c.categories)}</div>` : ""}
      ${socialRows ? `<div class="cd-section-title">${esc(t("creators.channels"))}</div><div class="crm-socials">${socialRows}</div>` : ""}
      ${reviewForm}
      ${reviews}
      <div class="crm-foot">
        <button type="button" class="btn-msg" id="crm-msg">${ic.messages}<span>${esc(t("creators.message"))}</span></button>
        ${inviteBtn}
      </div>
    </div>`;

  byId("crm-close")?.addEventListener("click", closeCreatorModal);
  byId("crm-msg")?.addEventListener("click", () => openMessageWith(cid));
  byId("crm-invite")?.addEventListener("click", async () => {
    if (!r) return;
    const btn = byId<HTMLButtonElement>("crm-invite")!;
    btn.disabled = true;
    try {
      await inviteCreator(r.id, cid);
      await paintCreatorModal(cid, r); // reflects already_invited
    } catch {
      btn.disabled = false;
    }
  });

  // Review star picker + submit
  const form = ov.querySelector<HTMLElement>(".crm-reviewform");
  if (form) {
    ov.querySelectorAll<HTMLElement>(".crm-star").forEach((s) =>
      s.addEventListener("click", () => {
        const val = Number(s.dataset.star);
        form.dataset.rating = String(val);
        ov.querySelectorAll<HTMLElement>(".crm-star").forEach((x, i) => {
          const on = i < val;
          x.classList.toggle("on", on);
          x.innerHTML = on ? ic.star : ic.starEmpty;
        });
      }));
    byId("crm-submit")?.addEventListener("click", async () => {
      const rating = Number(form.dataset.rating);
      const msg = byId("crm-review-msg")!;
      if (!rating) { msg.textContent = t("creators.pickStars"); return; }
      if (!r) return;
      const comment = byId<HTMLTextAreaElement>("crm-comment")?.value || "";
      const btn = byId<HTMLButtonElement>("crm-submit")!;
      btn.disabled = true;
      try {
        await reviewCreator(r.id, cid, rating, comment);
        await paintCreatorModal(cid, r);
      } catch (e) {
        btn.disabled = false;
        msg.textContent = (e as Error).message || t("account.error.save");
      }
    });
  }
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

/** Jump to the inbox with a specific creator's thread open (from the modal). */
function openMessageWith(cid: number): void {
  msgActive = cid;
  navTo("messages");
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
  const tabs: Tab[] = ["profile", "menu", "guidelines", "billing"];
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
  else if (tab === "guidelines") void renderGuidelines(id, tb);
  else void renderBilling(id, tb);
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

async function renderBilling(id: number, body: HTMLElement): Promise<void> {
  let b: BillingDetail;
  try {
    b = await getBilling(id);
  } catch {
    body.innerHTML = `<p class="acct-empty">${esc(t("account.error.load"))}</p>`;
    return;
  }
  const p = b.platform;
  const statusLabel = p ? planLabel(p.status) : t("account.plan.none");
  const trialing = p?.status === "trialing";
  const nextDate = fmtDate(trialing ? p?.trial_end : p?.current_period_end);
  const cadence = p?.cadence ? t(`account.billing.cadence.${p.cadence}`) : "—";
  const cancelRow = p?.cancel_at_period_end
    ? `<p class="acct-note cancel">${esc(t("account.billing.cancelNote", { date: nextDate }))}</p>`
    : `<button type="button" class="linklike danger-link" id="bill-cancel">${esc(t("account.billing.cancelPlan"))}</button>`;

  body.innerHTML = `
    <div class="acct-billing">
      <div class="bill-line"><span>${esc(t("account.billing.status"))}</span><b>${esc(statusLabel)}</b></div>
      <div class="bill-line"><span>${esc(t("account.billing.cadence"))}</span><b>${esc(cadence)}</b></div>
      <div class="bill-line"><span>${esc(trialing ? t("account.billing.trialUntil") : t("account.billing.nextPayment"))}</span><b>${esc(nextDate)}</b></div>
    </div>
    ${p ? cancelRow : ""}
    <div class="field acct-limit">
      <label for="bill-limit">${esc(t("account.billing.limit"))}</label>
      <input class="input" id="bill-limit" type="number" min="0" step="1" value="${b.spending_limit_eur ?? ""}" />
      <p class="acct-note">${esc(t("account.billing.limitHint"))}</p>
    </div>
    ${saveButton("bill-save")}`;

  byId("bill-save")?.addEventListener("click", async () => {
    const val = Number(byId<HTMLInputElement>("bill-limit")?.value);
    if (Number.isFinite(val) && val >= 0) await putBilling(id, val);
    flashSaved("bill-save-ok");
  });
  byId("bill-cancel")?.addEventListener("click", () => {
    confirmBox(t("account.billing.cancelConfirmTitle"), t("account.billing.cancelConfirm"), null, async () => {
      await cancelBilling(id);
      render();
    });
  });

  const r = restaurants.find((x) => x.id === id);
  const danger = document.createElement("div");
  danger.className = "danger-zone";
  danger.innerHTML = `
    <h2>${esc(t("account.danger.title"))}</h2>
    <p class="acct-note">${esc(t("account.danger.deleteRestaurantHint"))}</p>
    <button type="button" class="btn btn-danger" id="del-rest">${esc(t("account.danger.deleteRestaurant"))}</button>`;
  body.appendChild(danger);
  byId("del-rest")?.addEventListener("click", () => {
    confirmBox(
      t("account.danger.deleteRestaurant"),
      t("account.danger.deleteRestaurantConfirm", { name: r?.name ?? "" }),
      r?.name ?? "",
      async () => {
        await deleteRestaurant(id);
        restaurants = restaurants.filter((x) => x.id !== id);
        backToList();
      },
    );
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
  bookingView = null;
  closeRestMenu();
  closeCreatorModal();
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
