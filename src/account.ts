/**
 * Account management — the only thing a logged-in restaurant sees until the
 * platform is ready. In-app route `/account`, lazy-loaded by the SPA. Left nav
 * toggles "Your restaurants" and "Account & security"; picking a restaurant
 * opens Profile / Menu / Guidelines / Billing. Mirrors the `/admin` scaffolding.
 */
import "./styles/theme.css";
import "./styles/onboarding.css"; // shared card / field / input / button / chip
import "./styles/admin.css"; // shared app shell (nav + main)
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

/* ---- state --------------------------------------------------------------- */

let me: Principal | null = null;
let restaurants: RestaurantSummary[] = [];
type View = { name: "restaurants" } | { name: "detail"; id: number; tab: Tab } | { name: "account" };
type Tab = "profile" | "menu" | "guidelines" | "billing";
let view: View = { name: "restaurants" };

/* ---- shell --------------------------------------------------------------- */

function shell(): string {
  return `
<div class="admin-app account-app">
  <aside class="admin-nav">
    <a href="/" class="brand-logo">trending table<span class="dot">.</span></a>
    <p class="admin-nav-tag">${esc(t("account.nav.tag"))}</p>
    <nav class="admin-nav-list">
      <button type="button" class="nav-item" data-nav="restaurants">${esc(t("account.nav.restaurants"))}</button>
      <button type="button" class="nav-item" data-nav="account">${esc(t("account.nav.account"))}</button>
    </nav>
    <div class="account-nav-foot">
      <div class="lang-toggle account-lang" id="acct-lang" role="group" aria-label="Language">
        <button type="button" data-lang="de">DE</button>
        <button type="button" data-lang="en">EN</button>
      </div>
      <button type="button" class="linklike admin-signout" id="acct-logout">${esc(t("account.signout"))}</button>
    </div>
  </aside>
  <main class="admin-main account-main" id="acct-main"></main>
</div>`;
}

/* ---- restaurants list ---------------------------------------------------- */

function planLabel(status: string | null): string {
  const key = `account.plan.${status ?? "none"}`;
  const label = t(key);
  return label === key ? (status ?? t("account.plan.none")) : label;
}

function renderRestaurants(): void {
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
  main().innerHTML = `
    <h1 class="admin-title">${esc(t("account.rest.title"))}</h1>
    <div class="acct-cards">${cards}</div>
    <a class="btn btn-primary acct-add" href="/register">${esc(t("account.rest.add"))}</a>`;
  main()
    .querySelectorAll<HTMLElement>("[data-open]")
    .forEach((b) => b.addEventListener("click", () => go({ name: "detail", id: Number(b.dataset.open), tab: "profile" })));
}

/* ---- restaurant detail --------------------------------------------------- */

function detailChrome(id: number, tab: Tab): void {
  const r = restaurants.find((x) => x.id === id);
  const tabs: Tab[] = ["profile", "menu", "guidelines", "billing"];
  main().innerHTML = `
    <button type="button" class="linklike acct-back" id="acct-back">← ${esc(t("account.rest.title"))}</button>
    <h1 class="admin-title">${esc(r?.name || "—")}</h1>
    <div class="acct-tabs">
      ${tabs.map((tb) => `<button type="button" class="acct-tab ${tb === tab ? "on" : ""}" data-tab="${tb}">${esc(t(`account.tab.${tb}`))}</button>`).join("")}
    </div>
    <div class="acct-tab-body" id="acct-tab-body"><p class="acct-loading">…</p></div>`;
  byId("acct-back")?.addEventListener("click", () => go({ name: "restaurants" }));
  main()
    .querySelectorAll<HTMLElement>(".acct-tab")
    .forEach((b) => b.addEventListener("click", () => go({ name: "detail", id, tab: b.dataset.tab as Tab })));
  const body = byId("acct-tab-body")!;
  if (tab === "profile") void renderProfile(id, body);
  else if (tab === "menu") void renderMenu(id, body);
  else if (tab === "guidelines") void renderGuidelines(id, body);
  else void renderBilling(id, body);
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

async function flashSaved(okId: string): Promise<void> {
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
    void flashSaved("pf-save-ok");
  });
}

async function renderMenu(id: number, body: HTMLElement): Promise<void> {
  const { items } = await getMenu(id);
  let rows: MenuItem[] = items.length ? items : [];

  const draw = () => {
    body.innerHTML = `
      <div class="menu-editor" id="menu-rows">
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
    // sync edits back into rows
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
      void flashSaved("menu-save-ok");
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
    void flashSaved("g-save-ok");
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
    void flashSaved("bill-save-ok");
  });
  byId("bill-cancel")?.addEventListener("click", () => {
    confirmBox(t("account.billing.cancelConfirmTitle"), t("account.billing.cancelConfirm"), null, async () => {
      await cancelBilling(id);
      go({ name: "detail", id, tab: "billing" });
    });
  });

  // Danger zone: delete this restaurant (type the name to confirm).
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
        go({ name: "restaurants" });
      },
    );
  });
}

/* ---- account & security -------------------------------------------------- */

function renderAccount(): void {
  const verified = me?.email_verified;
  main().innerHTML = `
    <h1 class="admin-title">${esc(t("account.nav.account"))}</h1>

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
    void flashSaved("ac-name-save-ok");
  });
  byId("ac-resend")?.addEventListener("click", async () => {
    await resendVerification();
    void flashSaved("ac-resend-ok");
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
      void flashSaved("ac-pw-ok");
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

/** Modal confirm. If `matchWord` is set, the action stays disabled until the
 * user types it exactly (used for deletes — no all-caps token, the name/email). */
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

/* ---- routing / render ---------------------------------------------------- */

const main = () => byId("acct-main")!;

function setNavActive(): void {
  const active = view.name === "account" ? "account" : "restaurants";
  document.querySelectorAll<HTMLElement>(".nav-item").forEach((b) => b.classList.toggle("on", b.dataset.nav === active));
}

function render(): void {
  setNavActive();
  if (view.name === "restaurants") renderRestaurants();
  else if (view.name === "detail") detailChrome(view.id, view.tab);
  else renderAccount();
}

function go(next: View): void {
  view = next;
  render();
}

function wireShell(): void {
  document.querySelectorAll<HTMLElement>(".nav-item").forEach((b) =>
    b.addEventListener("click", () => go(b.dataset.nav === "account" ? { name: "account" } : { name: "restaurants" })),
  );
  byId("acct-logout")?.addEventListener("click", async () => {
    await logout();
    window.location.assign("/login");
  });
  byId("acct-lang")
    ?.querySelectorAll<HTMLButtonElement>("button[data-lang]")
    .forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang as "en" | "de")));
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
  // Re-render on language switch (rebuild shell chrome + current view).
  onLangChange(() => {
    document.title = t("account.pageTitle");
    document.body.innerHTML = shell();
    wireShell();
    render();
  });
}
