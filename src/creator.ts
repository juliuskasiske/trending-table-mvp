/**
 * Creator registration — the other side of the marketplace. In-app route
 * `/creator`, lazy-loaded by the SPA. A short flow: sign up → enter social
 * handles (at least one of Instagram / TikTok / YouTube) → connect Instagram
 * for real stats (Meta "Instagram API with Instagram Login") → done.
 */
import "./styles/theme.css";
import "./styles/onboarding.css";
import "./styles/creator.css";
import "./styles/messages.css";
import {
  getCreatorHandles,
  getCreatorThread,
  getMe,
  instagramConnectUrl,
  listCreatorCampaigns,
  listCreatorThreads,
  logout,
  sendCreatorMessage,
  setCreatorHandles,
  signup,
  submitCreatorPost,
  type CreatorAssignment,
  type Message,
  type Principal,
  type SocialAccount,
} from "./api.ts";
import { getLang, initI18n, localizeError, onLangChange, setLang, t, tChip } from "./i18n.ts";
import { fmtEur } from "./format.ts";

const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T | null;
const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
const nf = () => new Intl.NumberFormat(getLang() === "de" ? "de-DE" : "en-US");
const locale = () => (getLang() === "de" ? "de-DE" : "en-US");
const initial = (s: string | null | undefined) => (s || "?").trim().charAt(0).toUpperCase();
const msgTime = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit" }).format(d)
    : new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short" }).format(d);
};
const sendIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>';
const backIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';

type Step = "signup" | "handles" | "connect" | "done" | "home";
type HomeTab = "campaigns" | "messages";

let me: Principal | null = null;
let step: Step = "signup";
let homeTab: HomeTab = "campaigns";
let accounts: SocialAccount[] = [];
let igEnabled = false;
let igBanner: "connected" | "error" | null = null;
let ciActive: number | null = null; // restaurant_id of open conversation
let ciPollTimer: number | undefined;
let ciLastId = 0;

/** ISO "YYYY-MM-DD" → localized long date. */
const fmtISODate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "—";
  return new Intl.DateTimeFormat(locale(), { day: "numeric", month: "long", year: "numeric" })
    .format(new Date(y, m - 1, d));
};

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
    const showErr = (m: string) => { if (err) { err.hidden = false; err.textContent = m; } };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showErr(t("account.email.err")); return; }
    if (password.length < 8) { showErr(t("pw.password_too_short")); return; }
    if (err) err.hidden = true;
    const btn = byId<HTMLButtonElement>("c-signup");
    if (btn) { btn.disabled = true; btn.textContent = t("creator.signup.working"); }
    try {
      me = await signup(email, password, "creator");
      go("handles");
    } catch (e) {
      showErr(localizeError((e as Error).message) || t("creator.error"));
      if (btn) { btn.disabled = false; btn.textContent = t("creator.signup.cta"); }
    }
  });
}

function statVal(platform: string, field: "handle" | "follower_count" | "avg_monthly_views" | "avg_views_per_post"): string {
  const a = accounts.find((x) => x.platform === platform);
  const v = a ? a[field] : null;
  return v == null ? "" : String(v);
}

function renderHandles(card: HTMLElement): void {
  card.innerHTML = `
    <p class="step-eyebrow">${esc(t("creator.eyebrow"))}</p>
    <h1 class="step-title">${esc(t("creator.handles.title"))}</h1>
    <p class="step-sub">${esc(t("creator.handles.sub"))}</p>
    ${PLATFORMS.map((p) => {
      const h = statVal(p.key, "handle");
      return `
      <div class="ch-platform">
        <div class="ch-plat-head">${esc(p.label)}</div>
        <div class="field"><label for="h-${p.key}">${esc(t("creator.handles.handle"))}</label>
          <input class="input" id="h-${p.key}" placeholder="${esc(t("creator.handles.handlePh"))}" autocomplete="off" value="${esc(h ? "@" + h : "")}" /></div>
        <div class="ch-stats">
          <div class="field"><label for="f-${p.key}">${esc(t("creator.handles.followers"))}</label>
            <input class="input" id="f-${p.key}" type="number" min="0" inputmode="numeric" placeholder="0" value="${esc(statVal(p.key, "follower_count"))}" /></div>
          <div class="field"><label for="m-${p.key}">${esc(t("creator.handles.monthlyViews"))}</label>
            <input class="input" id="m-${p.key}" type="number" min="0" inputmode="numeric" placeholder="0" value="${esc(statVal(p.key, "avg_monthly_views"))}" /></div>
          <div class="field"><label for="v-${p.key}">${esc(t("creator.handles.perPost"))}</label>
            <input class="input" id="v-${p.key}" type="number" min="0" inputmode="numeric" placeholder="0" value="${esc(statVal(p.key, "avg_views_per_post"))}" /></div>
        </div>
      </div>`;
    }).join("")}
    <p class="ch-hint">${esc(t("creator.handles.statsHint"))}</p>
    <p class="field-error" id="h-err" hidden></p>
    <button type="button" class="btn btn-primary creator-cta" id="h-save">${esc(t("creator.handles.cta"))}</button>`;
  byId("h-save")?.addEventListener("click", async () => {
    const num = (id: string): number | null => {
      const v = byId<HTMLInputElement>(id)?.value.trim();
      const n = v ? Number(v) : NaN;
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const payload = PLATFORMS.map((p) => ({
      platform: p.key,
      handle: (byId<HTMLInputElement>(`h-${p.key}`)?.value.trim() ?? "").replace(/^@+/, ""),
      follower_count: num(`f-${p.key}`),
      avg_monthly_views: num(`m-${p.key}`),
      avg_views_per_post: num(`v-${p.key}`),
    })).filter((a) => a.handle);
    const err = byId("h-err");
    if (!payload.length) {
      if (err) { err.hidden = false; err.textContent = t("creator.handles.needOne"); }
      return;
    }
    if (err) err.hidden = true;
    const btn = byId<HTMLButtonElement>("h-save");
    if (btn) { btn.disabled = true; btn.textContent = t("creator.handles.working"); }
    try {
      await setCreatorHandles(payload);
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
    <p class="step-sub">${esc(t("creator.done.sub"))}</p>
    <button type="button" class="btn btn-primary creator-cta" id="c-inbox">${esc(t("creator.done.inbox"))}</button>`;
  byId("c-inbox")?.addEventListener("click", () => go("home"));
}

/* ---- home: the creator's inbox ------------------------------------------- */

function stopCiPoll(): void {
  window.clearInterval(ciPollTimer);
  ciPollTimer = undefined;
}

function renderHome(): void {
  stopCiPoll();
  const stage = document.querySelector<HTMLElement>(".creator-stage");
  if (!stage) return;
  stage.classList.add("creator-stage-wide");
  const tab = (id: HomeTab, label: string) =>
    `<button type="button" class="cc-tab ${homeTab === id ? "on" : ""}" data-tab="${id}">${esc(label)}</button>`;
  stage.innerHTML = `
    <div class="creator-inbox">
      <div class="ci-head">
        <h1 class="ci-title">${esc(t("creator.home.title"))}</h1>
        <div class="ci-actions">
          <button type="button" class="ci-link" id="ci-accounts">${esc(t("creator.home.accounts"))}</button>
          <button type="button" class="ci-link" id="ci-logout">${esc(t("account.signout"))}</button>
        </div>
      </div>
      <div class="cc-tabs">${tab("campaigns", t("creator.tab.campaigns"))}${tab("messages", t("creator.tab.messages"))}</div>
      <div id="ci-body"></div>
    </div>`;
  byId("ci-accounts")?.addEventListener("click", () => go("connect"));
  byId("ci-logout")?.addEventListener("click", async () => {
    await logout();
    window.location.assign("/login");
  });
  stage.querySelectorAll<HTMLElement>(".cc-tab").forEach((b) =>
    b.addEventListener("click", () => { homeTab = b.dataset.tab as HomeTab; renderHome(); }));
  if (homeTab === "campaigns") void renderCampaignsTab();
  else renderMessagesTab();
}

/* ---- home › campaigns (assignments) -------------------------------------- */

const assignmentPill = (s: string): string => `cc-status cc-status--${s}`;

function assignmentCard(a: CreatorAssignment): string {
  const g = (a.guidelines || {}) as { show?: string[]; must_include?: string[]; avoid?: string[]; notes?: string };
  const chips = (vals?: string[]) => (vals || []).map((v) => `<span class="cc-chip">${esc(tChip(v))}</span>`).join("");
  const glRow = (label: string, vals?: string[]) =>
    vals && vals.length
      ? `<div class="cc-gl"><span class="cc-gl-k">${esc(label)}</span><span class="cc-gl-v">${chips(vals)}</span></div>`
      : "";
  const canSubmit = a.status === "contacted" || a.status === "posted";
  const submit = canSubmit
    ? `<div class="cc-submit">
        <input class="input cc-url" type="url" placeholder="${esc(t("creator.campaigns.linkPh"))}" />
        <button type="button" class="btn btn-primary cc-submit-btn">${esc(t(a.post_count > 0 ? "creator.campaigns.update" : "creator.campaigns.submit"))}</button>
      </div>
      <p class="cc-err field-error" hidden></p>`
    : "";
  return `<div class="cc-card" data-cid="${a.campaign_id}">
    <div class="cc-head">
      <div class="cc-headinfo">
        <div class="cc-rest">${esc(a.restaurant_name)}</div>
        <div class="cc-title">${esc(a.title || t("creator.campaigns.untitled"))}</div>
      </div>
      <span class="${assignmentPill(a.status)}">${esc(t(`assignment.status.${a.status}`))}</span>
    </div>
    <div class="cc-meta">
      <span><b>${esc(fmtEur(a.creator_payout_eur))}</b> ${esc(t("creator.campaigns.payout"))}</span>
      ${a.content_deadline ? `<span><b>${esc(fmtISODate(a.content_deadline))}</b> ${esc(t("creator.campaigns.by"))}</span>` : ""}
    </div>
    ${glRow(t("account.g.show"), g.show)}${glRow(t("account.g.must"), g.must_include)}${glRow(t("account.g.avoid"), g.avoid)}
    ${g.notes ? `<p class="cc-notes">${esc(g.notes)}</p>` : ""}
    ${submit}
  </div>`;
}

async function renderCampaignsTab(): Promise<void> {
  const body = byId("ci-body");
  if (!body) return;
  body.innerHTML = `<p class="ci-loading" style="padding:20px">…</p>`;
  let assignments: CreatorAssignment[];
  try {
    assignments = (await listCreatorCampaigns()).assignments;
  } catch {
    body.innerHTML = `<div class="msg-list-empty">${esc(t("creator.error"))}</div>`;
    return;
  }
  if (step !== "home" || homeTab !== "campaigns") return;
  if (!assignments.length) {
    body.innerHTML = `<div class="cc-empty">${esc(t("creator.campaigns.empty"))}</div>`;
    return;
  }
  body.innerHTML = `<div class="cc-grid">${assignments.map(assignmentCard).join("")}</div>`;
  body.querySelectorAll<HTMLElement>(".cc-card").forEach((card) => {
    const cid = Number(card.dataset.cid);
    const btn = card.querySelector<HTMLButtonElement>(".cc-submit-btn");
    const url = card.querySelector<HTMLInputElement>(".cc-url");
    const err = card.querySelector<HTMLElement>(".cc-err");
    btn?.addEventListener("click", async () => {
      const v = url?.value.trim() || "";
      if (err) err.hidden = true;
      if (!v) return;
      btn.disabled = true;
      try {
        await submitCreatorPost(cid, v);
        await renderCampaignsTab();
      } catch (e) {
        btn.disabled = false;
        if (err) { err.hidden = false; err.textContent = (e as Error).message || t("creator.error"); }
      }
    });
  });
}

/* ---- home › messages ----------------------------------------------------- */

function renderMessagesTab(): void {
  const body = byId("ci-body");
  if (!body) return;
  body.innerHTML = `
    <div class="msg-app${ciActive != null ? " thread-open" : ""}" id="cmsg-app">
      <div class="msg-list" id="cmsg-list"><p class="ci-loading">…</p></div>
      <div class="msg-convo" id="cmsg-convo"></div>
    </div>`;
  void loadCiThreads().then(() => {
    if (ciActive != null) void openCiConversation(ciActive);
    else renderCiEmpty();
  });
  ciPollTimer = window.setInterval(() => {
    if (step !== "home" || homeTab !== "messages") return;
    void loadCiThreads();
    if (ciActive != null) void paintCiBubbles(ciActive, true);
  }, 5000);
}

function renderCiEmpty(): void {
  const convo = byId("cmsg-convo");
  if (convo) convo.innerHTML = `<div class="msg-convo-empty">${esc(t("messages.selectThread"))}</div>`;
}

async function loadCiThreads(): Promise<void> {
  const list = byId("cmsg-list");
  if (!list) return;
  let threads;
  try {
    threads = (await listCreatorThreads()).threads;
  } catch {
    list.innerHTML = `<div class="msg-list-empty">${esc(t("creator.error"))}</div>`;
    return;
  }
  if (step !== "home") return;
  list.innerHTML = threads.length
    ? threads.map((th) => {
        const name = th.restaurant_name || t("creator.venueFallback");
        const preview = (th.last_sender === "creator" ? t("messages.youPrefix") + " " : "") + (th.last_body || "");
        const unread = th.unread > 0 ? `<span class="msg-unread">${th.unread}</span>` : "";
        return `<button type="button" class="msg-thread ${ciActive === th.restaurant_id ? "on" : ""}" data-rid="${th.restaurant_id}">
          <span class="msg-thread-av">${esc(initial(name))}</span>
          <span class="msg-thread-main">
            <span class="msg-thread-top"><span class="msg-thread-name">${esc(name)}</span><span class="msg-thread-time">${esc(msgTime(th.last_at))}</span></span>
            <span class="msg-thread-preview">${esc(preview)}</span>
          </span>${unread}
        </button>`;
      }).join("")
    : `<div class="msg-list-empty">${esc(t("messages.noThreads"))}</div>`;
  list.querySelectorAll<HTMLElement>(".msg-thread").forEach((el) =>
    el.addEventListener("click", () => void openCiConversation(Number(el.dataset.rid))));
}

async function openCiConversation(rid: number): Promise<void> {
  ciActive = rid;
  ciLastId = 0;
  byId("cmsg-app")?.classList.add("thread-open");
  byId("cmsg-list")?.querySelectorAll<HTMLElement>(".msg-thread")
    .forEach((el) => el.classList.toggle("on", Number(el.dataset.rid) === rid));
  const convo = byId("cmsg-convo");
  if (!convo) return;
  convo.innerHTML = `
    <div class="msg-convo-head" id="cmsg-head"></div>
    <div class="msg-bubbles" id="cmsg-bubbles"><p class="ci-loading">…</p></div>
    <div class="msg-composer">
      <textarea class="msg-input" id="cmsg-input" rows="1" placeholder="${esc(t("messages.placeholder"))}"></textarea>
      <button type="button" class="msg-send" id="cmsg-send" aria-label="${esc(t("messages.send"))}">${sendIcon}</button>
    </div>`;
  const input = byId<HTMLTextAreaElement>("cmsg-input")!;
  const send = byId<HTMLButtonElement>("cmsg-send")!;
  const doSend = async (): Promise<void> => {
    const body = input.value.trim();
    if (!body) return;
    input.value = "";
    send.disabled = true;
    try {
      await sendCreatorMessage(rid, body);
      await paintCiBubbles(rid, false);
      await loadCiThreads();
    } finally {
      send.disabled = false;
      input.focus();
    }
  };
  send.addEventListener("click", () => void doSend());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void doSend(); }
  });
  await paintCiBubbles(rid, false);
  input.focus();
}

async function paintCiBubbles(rid: number, pollMode: boolean): Promise<void> {
  if (ciActive !== rid || step !== "home") return;
  let th;
  try {
    th = await getCreatorThread(rid);
  } catch {
    return;
  }
  if (ciActive !== rid || step !== "home") return;
  const msgs = th.messages;
  const latest = msgs.length ? msgs[msgs.length - 1].id : 0;
  if (pollMode && latest === ciLastId) return;
  ciLastId = latest;

  const name = th.peer.name || t("creator.venueFallback");
  const head = byId("cmsg-head");
  if (head) {
    head.innerHTML = `<button type="button" class="msg-convo-back" id="cmsg-back" aria-label="${esc(t("messages.back"))}">${backIcon}</button><span class="msg-convo-av">${esc(initial(name))}</span><span class="msg-convo-name">${esc(name)}</span>`;
    byId("cmsg-back")?.addEventListener("click", () => {
      ciActive = null;
      byId("cmsg-app")?.classList.remove("thread-open");
      byId("cmsg-list")?.querySelectorAll<HTMLElement>(".msg-thread").forEach((el) => el.classList.remove("on"));
      renderCiEmpty();
    });
  }
  const bubbles = byId("cmsg-bubbles");
  if (bubbles) {
    bubbles.innerHTML = msgs.length
      ? msgs.map(ciBubble).join("")
      : `<div class="msg-convo-empty">${esc(t("messages.sayHi", { name }))}</div>`;
    bubbles.scrollTop = bubbles.scrollHeight;
  }
}

function ciBubble(mm: Message): string {
  const dir = mm.sender_role === "creator" ? "out" : "in";
  return `<div class="msg-row ${dir}"><div class="msg-bubble">${esc(mm.body)}</div><span class="msg-time">${esc(msgTime(mm.created_at))}</span></div>`;
}

/* ---- routing ------------------------------------------------------------- */

function render(): void {
  if (step !== "home") stopCiPoll();
  if (step === "home") { renderHome(); return; }
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
  if (me && me.role === "creator") {
    accounts = (await getCreatorHandles().catch(() => ({ accounts: [], instagramEnabled: false }))).accounts;
    step = igBanner ? "connect" : accounts.length ? "home" : "handles";
  } else {
    // Logged out, or signed in as a locale account choosing "register as a
    // creator" — show the creator signup. Signing up creates a creator account.
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
