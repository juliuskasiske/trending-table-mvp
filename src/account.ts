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
import {
  cancelBilling,
  changePassword,
  deleteAccount,
  deleteRestaurant,
  digitizeMenuUrl,
  getBilling,
  getGuidelines,
  getMe,
  getMenu,
  getRestaurant,
  listRestaurants,
  logout,
  putBilling,
  putGuidelines,
  putMenu,
  putProfile,
  resendVerification,
  updateMe,
  type BillingDetail,
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

const main = () => byId("acct-main")!;
const restName = () => restaurants[0]?.name || "Restaurant";

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
  if (mainView !== "settings") return renderComingSoon(m, mainView);
  renderSettings(m);
}

/** Plausible (blurred) faux content per tab, so the coming-soon screen looks
 * like a real page behind frosted glass rather than empty boxes. */
function fauxContent(key: MainView): string {
  const line = (w: string) => `<span class="fx-line" style="width:${w}"></span>`;
  const rep = (n: number, fn: (i: number) => string) => Array.from({ length: n }, (_, i) => fn(i)).join("");

  if (key === "dashboard") {
    const stat = (n: string) => `<div class="card fx-stat"><div class="fx-num">${n}</div>${line("70%")}</div>`;
    const heights = [45, 72, 58, 88, 64, 96, 52, 78, 68, 92, 48, 82];
    return `
      <div class="fx-stats">${stat("2.481")}${stat("18")}${stat("€1.240")}</div>
      <div class="card fx-chart"><div class="fx-bars">${heights.map((h) => `<span class="fx-bar" style="height:${h}%"></span>`).join("")}</div></div>
      <div class="card fx-rows-card">${rep(4, () => `<div class="fx-row"><span class="fx-avatar sm"></span><span class="fx-body">${line("46%")}${line("28%")}</span><span class="fx-tag"></span></div>`)}</div>`;
  }
  if (key === "creators") {
    return `<div class="fx-cards">${rep(6, () => `
      <div class="card fx-creator"><span class="fx-avatar"></span>${line("62%")}${line("40%")}
        <span class="fx-pills"><span class="fx-pill"></span><span class="fx-pill"></span></span></div>`)}</div>`;
  }
  if (key === "bookings") {
    return `<div class="fx-rows">${rep(7, () => `
      <div class="card fx-row"><span class="fx-avatar sm"></span><span class="fx-body">${line("52%")}${line("34%")}</span><span class="fx-tag"></span></div>`)}</div>`;
  }
  // messages
  return `<div class="fx-rows">${rep(7, () => `
    <div class="card fx-row"><span class="fx-avatar"></span><span class="fx-body">${line("40%")}${line("74%")}</span><span class="fx-time">${line("100%")}</span></div>`)}</div>`;
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
      ${field("ac-name", t("account.acct.displayName"), me?.display_name ?? "")}
      ${saveButton("ac-name-save")}
    </section>

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

  byId("ac-name-save")?.addEventListener("click", async () => {
    const name = byId<HTMLInputElement>("ac-name")?.value.trim() ?? "";
    await updateMe(name);
    if (me) me.display_name = name || null;
    flashSaved("ac-name-save-ok");
  });
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
  closeRestMenu();
  render();
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
