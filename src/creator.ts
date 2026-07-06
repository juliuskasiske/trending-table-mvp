/**
 * Creator registration — the other side of the marketplace. In-app route
 * `/creator`, lazy-loaded by the SPA. A short flow: sign up → enter social
 * handles (at least one of Instagram / TikTok / YouTube) → connect Instagram
 * for real stats (Meta "Instagram API with Instagram Login") → done.
 */
import "./styles/theme.css";
import "./styles/onboarding.css";
import "./styles/creator.css";
import {
  getCreatorHandles,
  getMe,
  instagramConnectUrl,
  setCreatorHandles,
  signup,
  type Principal,
  type SocialAccount,
} from "./api.ts";
import { getLang, initI18n, onLangChange, setLang, t } from "./i18n.ts";

const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T | null;
const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
const nf = () => new Intl.NumberFormat(getLang() === "de" ? "de-DE" : "en-US");

type Step = "signup" | "handles" | "connect" | "done";

let me: Principal | null = null;
let step: Step = "signup";
let accounts: SocialAccount[] = [];
let igEnabled = false;
let igBanner: "connected" | "error" | null = null;

const PLATFORMS: Array<{ key: "instagram" | "tiktok" | "youtube"; label: string }> = [
  { key: "instagram", label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
  { key: "youtube", label: "YouTube" },
];

/* ---- shell --------------------------------------------------------------- */

function shell(): string {
  return `
<div class="creator-page">
  <header class="creator-top">
    <a href="/" class="brand-logo">trending table<span class="dot">.</span></a>
    <div class="lang-toggle" id="lang-toggle" role="group" aria-label="Language">
      <button type="button" data-lang="de">DE</button>
      <button type="button" data-lang="en">EN</button>
    </div>
  </header>
  <main class="creator-stage"><section class="card creator-card" id="creator-card"></section></main>
</div>`;
}

/* ---- steps --------------------------------------------------------------- */

function renderSignup(card: HTMLElement): void {
  card.innerHTML = `
    <p class="step-eyebrow">${esc(t("creator.eyebrow"))}</p>
    <h1 class="step-title">${esc(t("creator.signup.title"))}</h1>
    <p class="step-sub">${esc(t("creator.signup.sub"))}</p>
    <div class="field"><label for="c-email">${esc(t("gate.email"))}</label>
      <input class="input" id="c-email" type="email" autocomplete="email" /></div>
    <div class="field"><label for="c-password">${esc(t("gate.password"))}</label>
      <input class="input" id="c-password" type="password" autocomplete="new-password" /></div>
    <p class="field-error" id="c-err" hidden></p>
    <button type="button" class="btn btn-primary creator-cta" id="c-signup">${esc(t("creator.signup.cta"))}</button>`;
  byId("c-signup")?.addEventListener("click", async () => {
    const email = byId<HTMLInputElement>("c-email")?.value.trim() ?? "";
    const password = byId<HTMLInputElement>("c-password")?.value ?? "";
    const err = byId("c-err");
    if (!email || !password) return;
    if (err) err.hidden = true;
    const btn = byId<HTMLButtonElement>("c-signup");
    if (btn) { btn.disabled = true; btn.textContent = t("creator.signup.working"); }
    try {
      me = await signup(email, password, "creator");
      go("handles");
    } catch (e) {
      if (err) { err.hidden = false; err.textContent = (e as Error).message || t("creator.error"); }
      if (btn) { btn.disabled = false; btn.textContent = t("creator.signup.cta"); }
    }
  });
}

function handleValue(p: string): string {
  return accounts.find((a) => a.platform === p)?.handle ?? "";
}

function renderHandles(card: HTMLElement): void {
  card.innerHTML = `
    <p class="step-eyebrow">${esc(t("creator.eyebrow"))}</p>
    <h1 class="step-title">${esc(t("creator.handles.title"))}</h1>
    <p class="step-sub">${esc(t("creator.handles.sub"))}</p>
    ${PLATFORMS.map((p) => `
      <div class="field"><label for="h-${p.key}">${esc(p.label)}</label>
        <input class="input" id="h-${p.key}" placeholder="@handle" autocomplete="off" value="${esc(handleValue(p.key))}" /></div>`).join("")}
    <p class="field-error" id="h-err" hidden></p>
    <button type="button" class="btn btn-primary creator-cta" id="h-save">${esc(t("creator.handles.cta"))}</button>`;
  byId("h-save")?.addEventListener("click", async () => {
    const val = (k: string) => byId<HTMLInputElement>(`h-${k}`)?.value.trim() ?? "";
    const handles = { instagram: val("instagram"), tiktok: val("tiktok"), youtube: val("youtube") };
    const err = byId("h-err");
    if (!handles.instagram && !handles.tiktok && !handles.youtube) {
      if (err) { err.hidden = false; err.textContent = t("creator.handles.needOne"); }
      return;
    }
    if (err) err.hidden = true;
    const btn = byId<HTMLButtonElement>("h-save");
    if (btn) { btn.disabled = true; btn.textContent = t("creator.handles.working"); }
    try {
      await setCreatorHandles(handles);
      go("connect");
    } catch (e) {
      if (err) { err.hidden = false; err.textContent = (e as Error).message || t("creator.error"); }
      if (btn) { btn.disabled = false; btn.textContent = t("creator.handles.cta"); }
    }
  });
}

function socialRow(a: SocialAccount): string {
  const name = PLATFORMS.find((p) => p.key === a.platform)?.label ?? a.platform;
  const connected = a.status === "connected";
  const detail = connected
    ? t("creator.connect.connected", {
        handle: a.handle ? "@" + a.handle : "",
        followers: a.follower_count != null ? nf().format(a.follower_count) : "—",
      })
    : a.platform === "instagram"
      ? t("creator.connect.notConnected")
      : t("creator.connect.saved", { handle: a.handle ? "@" + a.handle : "" });
  return `
    <div class="social-row ${connected ? "on" : ""}">
      <span class="social-name">${esc(name)}</span>
      <span class="social-detail">${esc(detail)}</span>
      <span class="social-pill ${connected ? "yes" : ""}">${esc(connected ? t("creator.connect.pillOn") : t("creator.connect.pillOff"))}</span>
    </div>`;
}

async function renderConnect(card: HTMLElement): Promise<void> {
  card.innerHTML = `<p class="acct-loading">…</p>`;
  try {
    const res = await getCreatorHandles();
    accounts = res.accounts;
    igEnabled = res.instagramEnabled;
  } catch {
    /* keep whatever we had */
  }
  const ig = accounts.find((a) => a.platform === "instagram");
  const igConnected = ig?.status === "connected";
  const banner =
    igBanner === "connected"
      ? `<div class="notice ok creator-banner">${esc(t("creator.connect.justConnected"))}</div>`
      : igBanner === "error"
        ? `<div class="notice error creator-banner">${esc(t("creator.connect.failed"))}</div>`
        : "";
  const igButton =
    ig && !igConnected && igEnabled
      ? `<button type="button" class="btn btn-ink creator-cta" id="c-ig">${esc(t("creator.connect.ig"))}</button>`
      : "";

  card.innerHTML = `
    <p class="step-eyebrow">${esc(t("creator.eyebrow"))}</p>
    <h1 class="step-title">${esc(t("creator.connect.title"))}</h1>
    <p class="step-sub">${esc(t("creator.connect.sub"))}</p>
    ${banner}
    <div class="social-list">${accounts.map(socialRow).join("") || `<p class="acct-empty">${esc(t("creator.connect.none"))}</p>`}</div>
    ${igButton}
    <button type="button" class="btn btn-ghost creator-finish" id="c-finish">${esc(t("creator.connect.finish"))}</button>`;

  byId("c-ig")?.addEventListener("click", async () => {
    const btn = byId<HTMLButtonElement>("c-ig");
    if (btn) { btn.disabled = true; btn.textContent = t("creator.connect.opening"); }
    try {
      const { url } = await instagramConnectUrl();
      window.location.assign(url); // top-level nav to Instagram's authorization page
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = t("creator.connect.ig"); }
      const list = card.querySelector(".social-list");
      if (list) list.insertAdjacentHTML("beforebegin", `<div class="notice error creator-banner">${esc((e as Error).message || t("creator.error"))}</div>`);
    }
  });
  byId("c-finish")?.addEventListener("click", () => go("done"));
}

function renderDone(card: HTMLElement): void {
  card.innerHTML = `
    <div class="badge" aria-hidden="true">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
    </div>
    <h1 class="step-title">${esc(t("creator.done.title"))}</h1>
    <p class="step-sub">${esc(t("creator.done.sub"))}</p>`;
}

/* ---- routing ------------------------------------------------------------- */

function render(): void {
  const card = byId("creator-card");
  if (!card) return;
  if (step === "signup") renderSignup(card);
  else if (step === "handles") renderHandles(card);
  else if (step === "connect") void renderConnect(card);
  else renderDone(card);
}

function go(next: Step): void {
  step = next;
  render();
}

function wireLang(): void {
  byId("lang-toggle")
    ?.querySelectorAll<HTMLButtonElement>("button[data-lang]")
    .forEach((b) => {
      b.classList.toggle("on", b.dataset.lang === getLang());
      b.addEventListener("click", () => setLang(b.dataset.lang as "en" | "de"));
    });
}

/** Boot the creator flow. */
export async function initCreator(): Promise<void> {
  initI18n();
  document.title = t("creator.pageTitle");
  document.body.className = "theme-risograph creator-body";

  const params = new URLSearchParams(window.location.search);
  const ig = params.get("ig");
  igBanner = ig === "connected" ? "connected" : ig === "error" ? "error" : null;

  me = await getMe().catch(() => null);
  if (me && me.role === "account") {
    window.location.assign("/account"); // a restaurant landed here by mistake
    return;
  }
  if (me && me.role === "creator") {
    accounts = (await getCreatorHandles().catch(() => ({ accounts: [], instagramEnabled: false }))).accounts;
    step = igBanner || accounts.length ? "connect" : "handles";
  } else {
    step = "signup";
  }
  // Drop the ?ig= param so a refresh doesn't re-show the banner.
  if (ig) window.history.replaceState(null, "", "/creator");

  document.body.innerHTML = shell();
  wireLang();
  render();
  onLangChange(() => {
    document.body.innerHTML = shell();
    wireLang();
    render();
  });
}
