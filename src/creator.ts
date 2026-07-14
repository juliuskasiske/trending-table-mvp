/**
 * Creator registration — the other side of the marketplace. In-app route
 * `/creator`, lazy-loaded by the SPA. A short flow: sign up → enter social
 * handles (at least one of Instagram / TikTok / YouTube) → connect Instagram
 * for real stats (Meta "Instagram API with Instagram Login") → done.
 */
import "./styles/theme.css";
import "./styles/onboarding.css";
import "./styles/admin.css";   // shared .admin-title
import "./styles/account.css"; // dark platform nav + coming-soon shell
import "./styles/creator.css";
import "./styles/services.css"; // shared bookable-services cards
import {
  changePassword,
  confirmServiceBooking,
  deleteAccount,
  getCreatorHandles,
  getCreatorProfile,
  getCreatorServices,
  getMe,
  logout,
  putCreatorProfile,
  resendVerification,
  setCreatorHandles,
  signup,
  startServiceCheckout,
  type CreatorBooking,
  type CreatorProfile,
  type CreatorService,
  type PlatformStats,
  type Principal,
  type SocialAccount,
} from "./api.ts";
import { getLang, initI18n, localizeError, onLangChange, setLang, t } from "./i18n.ts";
import { serviceCard, wireServiceCheckout } from "./services-ui.ts";
import { confirmBox } from "./confirm.ts";
import { renderVerifyInto, stopVerifyPoll } from "./verify-screen.ts";

const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T | null;
const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

// Small line-icon set for the dark platform nav (mirrors the locale app).
const svg = (p: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const dic = {
  account: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 12 0v1"/>'),
  campaigns: svg('<path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>'),
  messages: svg('<path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/>'),
  services: svg('<path d="M20.6 8.4 12 3 3.4 8.4 12 13.8z"/><path d="M3.4 12.4 12 17.8l8.6-5.4"/>'),
  logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>'),
  chevron: svg('<path d="m6 9 6 6 6-6"/>'),
  at: svg('<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
};

type Step = "signup" | "verify" | "profile" | "handles" | "done" | "home";
type DashView = "account" | "campaigns" | "messages" | "services" | "settings";
type AcctTab = "profile" | "channels";
type EditorMode = "onboard" | "account";

let me: Principal | null = null;
let step: Step = "signup";
let dashView: DashView = "account";
let acctTab: AcctTab = "profile";
let dashDocWired = false;
let accounts: SocialAccount[] = [];
let profile: CreatorProfile | null = null;
let avatarData = "";      // staged profile picture (small JPEG data URL), "" = none
let avatarDirty = false;  // did the user change the picture this session?
let igEnabled = false;

// Audience/demographic option sets (values are stable codes; labels come from i18n).
const AGE_RANGES = ["18-24", "25-34", "35-44", "45-54", "55+"] as const;
const AUD_GENDERS = ["men", "women"] as const;
const PROFILE_GENDERS = ["female", "male", "diverse", "prefer_not"] as const;
// Largest German cities for the ranked top-5 audience selects.
const GERMAN_CITIES = [
  "Berlin", "Hamburg", "München", "Köln", "Frankfurt am Main", "Stuttgart",
  "Düsseldorf", "Leipzig", "Dortmund", "Essen", "Bremen", "Dresden", "Hannover",
  "Nürnberg", "Duisburg", "Bochum", "Wuppertal", "Bielefeld", "Bonn", "Münster",
  "Mannheim", "Karlsruhe", "Augsburg", "Wiesbaden",
] as const;
// Per-platform terminology for the three reach metrics (matches each app's own labels).
const PLATFORM_METRICS: Record<string, { views: string; reached: string; clicks: string }> = {
  instagram: { views: "cr.m.ig.views", reached: "cr.m.ig.reached", clicks: "cr.m.ig.clicks" },
  tiktok: { views: "cr.m.tt.views", reached: "cr.m.tt.reached", clicks: "cr.m.tt.clicks" },
  youtube: { views: "cr.m.yt.views", reached: "cr.m.yt.reached", clicks: "cr.m.yt.clicks" },
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
    <div class="field"><label for="c-password2">${esc(t("account.password2.label"))}</label>
      <input class="input" id="c-password2" type="password" autocomplete="new-password" /></div>
    <button type="button" class="linklike c-pw-toggle" id="c-pw-toggle">${esc(t("pw.show"))}</button>
    <p class="field-error" id="c-err" hidden></p>
    <button type="button" class="btn btn-primary creator-cta" id="c-signup">${esc(t("creator.signup.cta"))}</button>`;
  byId("c-pw-toggle")?.addEventListener("click", () => {
    const pws = [byId<HTMLInputElement>("c-password"), byId<HTMLInputElement>("c-password2")];
    const show = pws[0]?.type === "password";
    pws.forEach((el) => { if (el) el.type = show ? "text" : "password"; });
    const btn = byId("c-pw-toggle");
    if (btn) btn.textContent = show ? t("pw.hide") : t("pw.show");
  });
  byId("c-signup")?.addEventListener("click", async () => {
    const email = byId<HTMLInputElement>("c-email")?.value.trim() ?? "";
    const password = byId<HTMLInputElement>("c-password")?.value ?? "";
    const password2 = byId<HTMLInputElement>("c-password2")?.value ?? "";
    const err = byId("c-err");
    const showErr = (m: string) => { if (err) { err.hidden = false; err.textContent = m; } };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showErr(t("account.email.err")); return; }
    if (password.length < 8) { showErr(t("pw.password_too_short")); return; }
    if (password2 !== password) { showErr(t("account.password2.err")); return; }
    if (err) err.hidden = true;
    const btn = byId<HTMLButtonElement>("c-signup");
    if (btn) { btn.disabled = true; btn.textContent = t("creator.signup.working"); }
    try {
      me = await signup(email, password, "creator");
      // Hard barrier: verify the email before building the profile/channels.
      go(me.email_verified ? "profile" : "verify");
    } catch (e) {
      // Email already registered → point them at login, don't silently proceed.
      if ((e as { status?: number }).status === 409 && err) {
        err.hidden = false;
        err.innerHTML = `${esc(t("account.email.taken"))} <a href="/login" class="linklike">${esc(t("account.email.takenCta"))}</a>`;
      } else {
        showErr(localizeError((e as Error).message) || t("creator.error"));
      }
      if (btn) { btn.disabled = false; btn.textContent = t("creator.signup.cta"); }
    }
  });
}

/* ---- step: profile (name / age / gender / followers / picture) ----------- */

/** Downscale an image file to a small square-ish JPEG data URL so the saved
 * payload stays tiny (a raw photo would be MBs and can fail the request). */
function resizeImage(file: File, max = 512): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("bad image"));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height) || 1);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("no canvas")); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

function renderProfile(card: HTMLElement, mode: EditorMode = "onboard"): void {
  const pr = profile;
  const shown = avatarDirty ? avatarData : (pr?.avatar_url ?? "");
  const numStr = (v: number | null | undefined) => (v == null ? "" : String(v));
  const head = mode === "account"
    ? `<p class="step-sub">${esc(t("creator.profile.sub"))}</p>`
    : `<p class="step-eyebrow">${esc(t("creator.eyebrow"))}</p>
       <h1 class="step-title">${esc(t("creator.profile.title"))}</h1>
       <p class="step-sub">${esc(t("creator.profile.sub"))}</p>`;
  card.innerHTML = `
    ${head}
    <div class="cp-pic">
      <div class="cp-avatar" id="cp-avatar"${shown ? ` style="background-image:url('${esc(shown)}')"` : ""}>${shown ? "" : `<span>${esc(t("creator.profile.picHint"))}</span>`}</div>
      <div class="cp-pic-actions">
        <label class="btn btn-ghost cp-pic-btn">${esc(t("creator.profile.picCta"))}<input type="file" id="cp-file" accept="image/*" hidden /></label>
        <button type="button" class="linklike cp-pic-remove" id="cp-remove"${shown ? "" : " hidden"}>${esc(t("creator.profile.picRemove"))}</button>
        <p class="cp-pic-note">${esc(t("creator.profile.picNote"))}</p>
      </div>
    </div>
    <div class="field"><label for="cp-name">${esc(t("creator.profile.name"))}</label>
      <input class="input" id="cp-name" autocomplete="name" value="${esc(pr?.name ?? "")}" /></div>
    <div class="ch-stats">
      <div class="field"><label for="cp-age">${esc(t("creator.profile.age"))}</label>
        <input class="input" id="cp-age" type="number" min="13" max="120" inputmode="numeric" value="${esc(numStr(pr?.age))}" /></div>
      <div class="field"><label for="cp-gender">${esc(t("creator.profile.gender"))}</label>
        <select class="input" id="cp-gender">
          <option value="">${esc(t("creator.city.pick"))}</option>
          ${PROFILE_GENDERS.map((g) => `<option value="${g}"${pr?.gender === g ? " selected" : ""}>${esc(t(`creator.pgender.${g}`))}</option>`).join("")}
        </select></div>
      <div class="field"><label for="cp-followers">${esc(t("creator.profile.followers"))}</label>
        <input class="input" id="cp-followers" type="number" min="0" inputmode="numeric" value="${esc(numStr(pr?.follower_count))}" /></div>
    </div>
    <p class="field-error" id="cp-err" hidden></p>
    ${mode === "account"
      ? `<div class="acct-save-row"><button type="button" class="btn btn-ink" id="cp-save">${esc(t("account.save"))}</button><span class="acct-saved" id="cp-ok" hidden>${esc(t("account.saved"))}</span></div>`
      : `<button type="button" class="btn btn-primary creator-cta" id="cp-save">${esc(t("creator.profile.cta"))}</button>`}`;

  const errEl = byId("cp-err");
  const paintAvatar = (data: string) => {
    const av = byId("cp-avatar");
    const rm = byId("cp-remove");
    if (av) {
      av.style.backgroundImage = data ? `url('${data}')` : "";
      av.innerHTML = data ? "" : `<span>${esc(t("creator.profile.picHint"))}</span>`;
    }
    if (rm) rm.hidden = !data;
  };
  byId<HTMLInputElement>("cp-file")?.addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (errEl) errEl.hidden = true;
    try {
      avatarData = await resizeImage(file, 512);
      avatarDirty = true;
      paintAvatar(avatarData);
    } catch {
      if (errEl) { errEl.hidden = false; errEl.textContent = t("creator.profile.picFail"); }
    }
  });
  byId("cp-remove")?.addEventListener("click", () => {
    avatarData = ""; avatarDirty = true; paintAvatar("");
  });

  // Clear a field's invalid highlight as soon as it's edited.
  card.querySelectorAll<HTMLElement>(".input").forEach((el) => {
    el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => el.classList.remove("invalid"));
  });

  byId("cp-save")?.addEventListener("click", async () => {
    const val = (id: string) => byId<HTMLInputElement>(id)?.value.trim() ?? "";
    const name = val("cp-name"), ageV = val("cp-age"), fV = val("cp-followers");
    const gender = byId<HTMLSelectElement>("cp-gender")?.value ?? "";
    const required = [
      { id: "cp-name", ok: !!name },
      { id: "cp-age", ok: ageV !== "" && Number(ageV) >= 13 },
      { id: "cp-gender", ok: !!gender },
      { id: "cp-followers", ok: fV !== "" && Number(fV) >= 0 },
    ];
    card.querySelectorAll<HTMLElement>(".input.invalid").forEach((el) => el.classList.remove("invalid"));
    const missing = required.filter((r) => !r.ok);
    if (missing.length) {
      missing.forEach((mm) => byId(mm.id)?.classList.add("invalid"));
      byId(missing[0].id)?.focus();
      if (errEl) { errEl.hidden = false; errEl.textContent = t("creator.profile.needAll"); }
      return;
    }
    if (errEl) errEl.hidden = true;
    const btn = byId<HTMLButtonElement>("cp-save");
    if (btn) { btn.disabled = true; btn.textContent = t("creator.handles.working"); }
    try {
      await putCreatorProfile({
        name,
        age: Number(ageV),
        gender,
        follower_count: Number(fV),
        // Only touch the avatar if the user changed it this session.
        ...(avatarDirty ? { avatar_url: avatarData || null } : {}),
      });
    } catch (e) {
      if (errEl) { errEl.hidden = false; errEl.textContent = localizeError((e as Error).message) || t("creator.error"); }
      if (btn) { btn.disabled = false; btn.textContent = mode === "account" ? t("account.save") : t("creator.profile.cta"); }
      return;
    }
    if (mode === "account") {
      // Saved in place: refresh state, flash "saved", stay on the tab.
      profile = (await getCreatorProfile().catch(() => ({ profile }))).profile;
      avatarDirty = false;
      if (btn) { btn.disabled = false; btn.textContent = t("account.save"); }
      flashSaved("cp-ok");
      return;
    }
    go("handles"); // outside the try so a downstream render error surfaces, not swallowed
  });
}

/** Briefly reveal a "saved" indicator next to a save button. */
function flashSaved(id: string): void {
  const ok = byId(id);
  if (!ok) return;
  ok.hidden = false;
  window.setTimeout(() => { if (byId(id)) ok.hidden = true; }, 2000);
}

/* ---- step: channels (per-platform handle + audience + reach) ------------- */

const acctFor = (platform: string): SocialAccount | undefined => accounts.find((x) => x.platform === platform);

function citySelect(platform: string, rank: number, selected: string): string {
  const opt = (val: string, label: string) => `<option value="${esc(val)}"${val === selected ? " selected" : ""}>${esc(label)}</option>`;
  return `<select class="input ch-city" data-p="${platform}" data-rank="${rank}">
      <option value=""${selected === "" ? " selected" : ""}>${esc(t("creator.city.pick"))}</option>
      ${GERMAN_CITIES.map((c) => opt(c, c)).join("")}
      ${opt("__other_de", t("creator.city.otherDe"))}
      ${opt("__other_intl", t("creator.city.otherIntl"))}
    </select>`;
}

// Ranked chip group: clicking assigns the next rank (1, 2, …) in selection order,
// shown as a numbered badge; the stored order IS the ranking.
function rankChipRow(kind: "age" | "gender", platform: string, options: readonly string[], selected: string[], labelFn: (v: string) => string): string {
  return `<div class="ch-chips rank-chips" data-p="${platform}" data-kind="${kind}">
      ${options.map((o) => {
        const r = selected.indexOf(o) + 1; // 0 → not selected
        return `<button type="button" class="cf-chip rank-chip${r ? " on" : ""}" data-val="${esc(o)}"${r ? ` data-rank="${r}"` : ""}>
          <span class="chip-rank">${r || ""}</span><span>${esc(labelFn(o))}</span>
        </button>`;
      }).join("")}
    </div>`;
}

function wireRankChips(group: HTMLElement): void {
  const chips = Array.from(group.querySelectorAll<HTMLElement>(".rank-chip"));
  const renumber = () => {
    chips.filter((c) => c.classList.contains("on"))
      .sort((a, b) => Number(a.dataset.rank || 0) - Number(b.dataset.rank || 0))
      .forEach((c, i) => {
        c.dataset.rank = String(i + 1);
        const badge = c.querySelector(".chip-rank");
        if (badge) badge.textContent = String(i + 1);
      });
  };
  chips.forEach((chip) => chip.addEventListener("click", () => {
    if (chip.classList.contains("on")) {
      chip.classList.remove("on");
      delete chip.dataset.rank;
      const badge = chip.querySelector(".chip-rank");
      if (badge) badge.textContent = "";
    } else {
      chip.classList.add("on");
      const maxRank = Math.max(0, ...chips.filter((c) => c.classList.contains("on")).map((c) => Number(c.dataset.rank || 0)));
      chip.dataset.rank = String(maxRank + 1);
    }
    renumber();
  }));
}

function renderHandles(card: HTMLElement, mode: EditorMode = "onboard"): void {
  const ageLabel = (v: string) => v;
  const genLabel = (v: string) => t(`creator.aud.${v}`);
  const numStr = (v: number | null | undefined) => (v == null ? "" : String(v));
  const head = mode === "account"
    ? `<p class="step-sub">${esc(t("creator.handles.sub"))}</p>`
    : `<p class="step-eyebrow">${esc(t("creator.eyebrow"))}</p>
       <h1 class="step-title">${esc(t("creator.handles.title"))}</h1>
       <p class="step-sub">${esc(t("creator.handles.sub"))}</p>`;
  card.innerHTML = `
    ${head}
    <div class="ch-platforms">
    ${PLATFORMS.map((p) => {
      const a = acctFor(p.key);
      const cities = a?.top_cities ?? [];
      const m = PLATFORM_METRICS[p.key];
      return `
      <div class="ch-platform">
        <div class="ch-plat-head">${esc(p.label)}</div>
        <div class="field"><label for="h-${p.key}">${esc(t("creator.handles.handle"))}</label>
          <input class="input" id="h-${p.key}" placeholder="${esc(t("creator.handles.handlePh"))}" autocomplete="off" value="${esc(a?.handle ? "@" + a.handle : "")}" /></div>

        <div class="field"><label>${esc(t("creator.channels.topCities"))}</label>
          <div class="ch-cities">
            ${[0, 1, 2, 3, 4].map((i) => `<div class="ch-city-row"><span class="ch-rank">${i + 1}.</span>${citySelect(p.key, i, cities[i] ?? "")}</div>`).join("")}
          </div>
        </div>

        <div class="field"><label>${esc(t("creator.channels.ageRange"))} <span class="ch-hint-inline">${esc(t("creator.channels.rankHint"))}</span></label>
          ${rankChipRow("age", p.key, AGE_RANGES, a?.top_age_ranges ?? [], ageLabel)}</div>
        <div class="field"><label>${esc(t("creator.channels.gender"))} <span class="ch-hint-inline">${esc(t("creator.channels.rankHint"))}</span></label>
          ${rankChipRow("gender", p.key, AUD_GENDERS, a?.top_genders ?? [], genLabel)}</div>

        <div class="ch-stats">
          <div class="field"><label for="v-${p.key}">${esc(t(m.views))}</label>
            <input class="input" id="v-${p.key}" type="number" min="0" inputmode="numeric" placeholder="0" value="${esc(numStr(a?.views_30d))}" /></div>
          <div class="field"><label for="r-${p.key}">${esc(t(m.reached))}</label>
            <input class="input" id="r-${p.key}" type="number" min="0" inputmode="numeric" placeholder="0" value="${esc(numStr(a?.reached_30d))}" /></div>
          <div class="field"><label for="l-${p.key}">${esc(t(m.clicks))}</label>
            <input class="input" id="l-${p.key}" type="number" min="0" inputmode="numeric" placeholder="0" value="${esc(numStr(a?.link_clicks_30d))}" /></div>
        </div>
      </div>`;
    }).join("")}
    </div>
    <p class="ch-hint">${esc(t("creator.handles.statsHint"))}</p>
    <p class="field-error" id="h-err" hidden></p>
    ${mode === "account"
      ? `<div class="acct-save-row"><button type="button" class="btn btn-ink" id="h-save">${esc(t("account.save"))}</button><span class="acct-saved" id="h-ok" hidden>${esc(t("account.saved"))}</span></div>`
      : `<div class="creator-actions">
          <button type="button" class="btn btn-ghost" id="h-back">${esc(t("btn.back"))}</button>
          <button type="button" class="btn btn-primary creator-cta" id="h-save">${esc(t("creator.handles.cta"))}</button>
        </div>`}`;
  card.querySelectorAll<HTMLElement>(".ch-chips").forEach((g) => wireRankChips(g));
  // First-time onboarding steps back to the profile step.
  byId("h-back")?.addEventListener("click", () => go("profile"));
  byId("h-save")?.addEventListener("click", async () => {
    const num = (id: string): number | null => {
      const v = byId<HTMLInputElement>(id)?.value.trim();
      const n = v ? Number(v) : NaN;
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const pickChips = (platform: string, kind: string) =>
      Array.from(card.querySelectorAll<HTMLElement>(`.ch-chips[data-p="${platform}"][data-kind="${kind}"] .rank-chip.on`))
        .sort((a, b) => Number(a.dataset.rank || 0) - Number(b.dataset.rank || 0))
        .map((c) => c.dataset.val || "");
    const pickCities = (platform: string) =>
      Array.from(card.querySelectorAll<HTMLSelectElement>(`.ch-city[data-p="${platform}"]`))
        .sort((a, b) => Number(a.dataset.rank) - Number(b.dataset.rank))
        .map((s) => s.value).filter(Boolean);
    const payload: PlatformStats[] = PLATFORMS.map((p) => ({
      platform: p.key,
      handle: (byId<HTMLInputElement>(`h-${p.key}`)?.value.trim() ?? "").replace(/^@+/, ""),
      top_cities: pickCities(p.key),
      top_age_ranges: pickChips(p.key, "age"),
      top_genders: pickChips(p.key, "gender"),
      views_30d: num(`v-${p.key}`),
      reached_30d: num(`r-${p.key}`),
      link_clicks_30d: num(`l-${p.key}`),
    })).filter((a) => a.handle);
    const err = byId("h-err");
    if (!payload.length) {
      if (err) { err.hidden = false; err.textContent = t("creator.handles.needOne"); }
      return;
    }
    // Onboarding: at least one channel must be fully set up — all 5 cities, every
    // age group + gender ranked, and all three reach metrics filled in.
    const isComplete = (a: PlatformStats): boolean =>
      !!a.handle &&
      (a.top_cities?.length ?? 0) === 5 &&
      (a.top_age_ranges?.length ?? 0) === AGE_RANGES.length &&
      (a.top_genders?.length ?? 0) === AUD_GENDERS.length &&
      a.views_30d != null && a.reached_30d != null && a.link_clicks_30d != null;
    if (mode === "onboard" && !payload.some(isComplete)) {
      card.querySelectorAll<HTMLElement>(".input.invalid").forEach((el) => el.classList.remove("invalid"));
      const target = (payload.find((a) => a.handle) ?? payload[0]).platform;
      card.querySelectorAll<HTMLSelectElement>(`.ch-city[data-p="${target}"]`)
        .forEach((s) => { if (!s.value) s.classList.add("invalid"); });
      ["v", "r", "l"].forEach((pre) => {
        const el = byId<HTMLInputElement>(`${pre}-${target}`);
        if (el && !el.value.trim()) el.classList.add("invalid");
      });
      if (err) { err.hidden = false; err.textContent = t("creator.handles.needComplete"); }
      byId(`h-${target}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (err) err.hidden = true;
    const btn = byId<HTMLButtonElement>("h-save");
    const restore = mode === "account" ? t("account.save") : t("creator.handles.cta");
    if (btn) { btn.disabled = true; btn.textContent = t("creator.handles.working"); }
    try {
      await setCreatorHandles(payload);
    } catch (e) {
      if (err) { err.hidden = false; err.textContent = localizeError((e as Error).message) || t("creator.error"); }
      if (btn) { btn.disabled = false; btn.textContent = restore; }
      return;
    }
    if (mode === "account") {
      // Saved in place: refresh state, flash "saved", stay on the tab.
      accounts = (await getCreatorHandles().catch(() => ({ accounts, instagramEnabled: igEnabled }))).accounts;
      if (btn) { btn.disabled = false; btn.textContent = restore; }
      flashSaved("h-ok");
      return;
    }
    go("done");
  });
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


/* ---- dashboard: dark-nav shell (mirrors the locale platform) ------------- */

function dashShell(): string {
  const item = (v: DashView, label: string) =>
    `<button type="button" class="pnav-item" data-view="${v}">${dic[v]}<span>${esc(label)}</span></button>`;
  return `
<div class="platform-app">
  <aside class="pnav">
    <div class="pnav-logo">tt<span class="dot">.</span></div>
    <nav class="pnav-list">
      ${item("account", t("creator.nav.account"))}
      ${item("campaigns", t("creator.tab.campaigns"))}
      ${item("messages", t("creator.tab.messages"))}
      ${item("services", t("creator.nav.services"))}
    </nav>
    <div class="pnav-foot">
      <div class="rest-menu" id="cr-menu" hidden>
        <div class="rest-menu-lang">
          <span>${esc(t("account.language"))}</span>
          <div class="account-lang" id="cr-lang"><button type="button" data-lang="de">DE</button><button type="button" data-lang="en">EN</button></div>
        </div>
        <button type="button" class="rest-menu-item" id="cr-settings">${dic.settings}<span>${esc(t("account.nav.settings"))}</span></button>
        <button type="button" class="rest-menu-item" id="cr-logout">${dic.logout}<span>${esc(t("account.signout"))}</span></button>
      </div>
      <button type="button" class="rest-selector" id="cr-selector">
        <span class="rest-food">${dic.at}</span>
        <span class="rest-name">${esc(me?.email || "Creator")}</span>
        <span class="rest-chevron">${dic.chevron}</span>
      </button>
    </div>
  </aside>
  <main class="platform-main" id="cr-main"></main>
</div>`;
}

function setDashNavActive(): void {
  document.querySelectorAll<HTMLElement>(".pnav-item").forEach((b) =>
    b.classList.toggle("on", b.dataset.view === dashView));
  byId("cr-selector")?.classList.toggle("on", dashView === "settings");
}

function renderDashboard(): void {
  document.body.className = "theme-risograph account-page";
  document.body.innerHTML = dashShell();
  document.querySelectorAll<HTMLElement>(".pnav-item").forEach((b) =>
    b.addEventListener("click", () => {
      dashView = b.dataset.view as DashView;
      if (dashView === "account") acctTab = "profile";
      renderDashMain();
    }));
  const menu = byId("cr-menu");
  byId("cr-selector")?.addEventListener("click", (e) => { e.stopPropagation(); if (menu) menu.hidden = !menu.hidden; });
  if (!dashDocWired) {
    document.addEventListener("click", (e) => {
      const m = byId("cr-menu");
      if (m && !m.hidden && !(e.target as HTMLElement).closest(".pnav-foot")) m.hidden = true;
    });
    dashDocWired = true;
  }
  byId("cr-settings")?.addEventListener("click", () => {
    if (menu) menu.hidden = true;
    dashView = "settings";
    renderDashMain();
  });
  byId("cr-logout")?.addEventListener("click", async () => { await logout(); window.location.assign("/login"); });
  byId("cr-lang")?.querySelectorAll<HTMLButtonElement>("button[data-lang]").forEach((b) => {
    b.classList.toggle("on", b.dataset.lang === getLang());
    b.addEventListener("click", (e) => { e.stopPropagation(); setLang(b.dataset.lang as "en" | "de"); });
  });
  renderDashMain();
}

function renderDashMain(): void {
  setDashNavActive();
  const m = byId("cr-main");
  if (!m) return;
  if (dashView === "account") renderAccountCenter(m);
  else if (dashView === "settings") renderCreatorSettings(m);
  else if (dashView === "services") renderServices(m);
  else renderDashComingSoon(m, dashView);
}

/* ---- services: bookable Stripe products + the creator's bookings ---------- */

// Stripe product ids that get an "Empfohlen" banner (Creator Advanced + the
// Visibility Boost add-on). Matched by product id so a price change won't drop it.
const RECOMMENDED_PRODUCTS = new Set<string>([
  "prod_Us58cca2lqCH0i", // Creator Advanced
  "prod_Us58gJN9rR7uSd", // Visibility Boost
]);
// Display-only name overrides (the Stripe product keeps its original name).
const SERVICE_NAME_OVERRIDES: Record<string, string> = {
  "Creator Visibility Boost": "Visibility Boost",
};

function renderServices(m: HTMLElement): void {
  m.innerHTML = `
    <h1 class="admin-title">${esc(t("creator.services.title"))}</h1>
    <p class="pl-sub">${esc(t("creator.services.sub"))}</p>
    <div id="svc-body"><p class="svc-loading">${esc(t("creator.services.loading"))}</p></div>`;
  const body = byId("svc-body");
  if (!body) return;
  getCreatorServices()
    .then((data) => renderServicesBody(body, data.stripeEnabled, data.catalog, data.booked))
    .catch(() => { body.innerHTML = `<p class="svc-empty">${esc(t("creator.error"))}</p>`; });
}

function renderServicesBody(
  body: HTMLElement, stripeEnabled: boolean,
  catalog: CreatorService[], booked: CreatorBooking[],
): void {
  const bookedPrices = new Set(booked.map((b) => b.price_id));

  // Split the catalog: subscription plans (recurring) vs one-time add-ons.
  const plans = catalog.filter((s) => s.recurring)
    .sort((a, b) => (a.amount ?? 0) - (b.amount ?? 0));
  const addons = catalog.filter((s) => s.one_time);

  // Current plan = the booked recurring plan (most recent), else the base plan
  // every creator starts on (the cheapest one).
  const bookedPlan = booked.find((b) => b.interval === "month");
  const currentPlan = plans.find((p) => p.price_id === bookedPlan?.price_id) ?? plans[0] ?? null;
  const currentAmount = currentPlan?.amount ?? 0;
  const upgrades = plans.filter((p) =>
    p.price_id !== currentPlan?.price_id && (p.amount ?? 0) > currentAmount);

  const card = (s: CreatorService, current: boolean): string =>
    serviceCard(s, {
      stripeEnabled,
      current,
      booked: bookedPrices.has(s.price_id),
      recommended: RECOMMENDED_PRODUCTS.has(s.product_id),
      displayName: SERVICE_NAME_OVERRIDES[s.name],
    });

  const grid = (items: CreatorService[], current = false): string =>
    `<div class="svc-grid">${items.map((s) => card(s, current)).join("")}</div>`;
  const section = (title: string, desc: string, html: string): string =>
    `<section class="svc-section">
      <h2 class="svc-section-title">${esc(title)}</h2>
      <p class="svc-section-desc">${esc(desc)}</p>
      ${html}
    </section>`;
  const empty = (msg: string): string => `<p class="svc-empty">${esc(msg)}</p>`;

  const notice = stripeEnabled ? "" :
    `<div class="svc-notice">${esc(t("creator.services.stripeOff"))}</div>`;

  body.innerHTML = `
    ${notice}
    ${section(t("creator.services.yourPlan"), t("creator.services.yourPlanDesc"),
      currentPlan ? grid([currentPlan], true) : empty(t("creator.services.catalogEmpty")))}
    ${section(t("creator.services.upgrade"), t("creator.services.upgradeDesc"),
      upgrades.length ? grid(upgrades) : empty(t("creator.services.topPlan")))}
    ${section(t("creator.services.moreJobs"), t("creator.services.moreJobsDesc"),
      addons.length ? grid(addons) : empty(t("creator.services.catalogEmpty")))}`;

  wireServiceCheckout(body, startServiceCheckout);
}

/** Account settings — change password + delete account (mirrors the locale app). */
function renderCreatorSettings(m: HTMLElement): void {
  const verified = me?.email_verified;
  m.innerHTML = `
    <h1 class="admin-title">${esc(t("account.nav.settings"))}</h1>
    <div class="acct-detail">
      <section class="acct-panel">
        <div class="bill-line"><span>${esc(t("account.acct.email"))}</span><b>${esc(me?.email ?? "")}</b></div>
        <div class="bill-line"><span>${esc(t("account.acct.status"))}</span>
          <span class="pill ${verified ? "yes" : "no"}">${esc(verified ? t("account.acct.verified") : t("account.acct.unverified"))}</span></div>
        ${verified ? "" : `<button type="button" class="linklike" id="cs-resend">${esc(t("account.acct.resend"))}</button><span class="acct-saved" id="cs-resend-ok" hidden>${esc(t("account.acct.resent"))}</span>`}
      </section>
      <section class="acct-panel">
        <h2 class="acct-panel-title">${esc(t("account.acct.password"))}</h2>
        <div class="field"><label for="cs-cur">${esc(t("account.acct.currentPw"))}</label><input class="input" id="cs-cur" type="password" autocomplete="current-password" /></div>
        <div class="field"><label for="cs-new">${esc(t("account.acct.newPw"))}</label><input class="input" id="cs-new" type="password" autocomplete="new-password" /></div>
        <p class="field-error" id="cs-pw-err" hidden></p>
        <div class="acct-save-row"><button type="button" class="btn btn-ink" id="cs-pw-save">${esc(t("account.acct.changePw"))}</button><span class="acct-saved" id="cs-pw-ok" hidden>${esc(t("account.acct.pwChanged"))}</span></div>
      </section>
      <div class="danger-zone">
        <h2>${esc(t("account.danger.title"))}</h2>
        <p class="acct-note">${esc(t("account.danger.deleteAccountHint"))}</p>
        <button type="button" class="btn btn-danger" id="cs-del">${esc(t("account.danger.deleteAccount"))}</button>
      </div>
    </div>`;
  byId("cs-resend")?.addEventListener("click", async () => {
    await resendVerification().catch(() => {});
    flashSaved("cs-resend-ok");
  });
  byId("cs-pw-save")?.addEventListener("click", async () => {
    const cur = byId<HTMLInputElement>("cs-cur")?.value ?? "";
    const nw = byId<HTMLInputElement>("cs-new")?.value ?? "";
    const err = byId("cs-pw-err");
    if (err) err.hidden = true;
    try {
      await changePassword(cur, nw);
      byId<HTMLInputElement>("cs-cur")!.value = "";
      byId<HTMLInputElement>("cs-new")!.value = "";
      flashSaved("cs-pw-ok");
    } catch (e) {
      if (err) { err.hidden = false; err.textContent = localizeError((e as Error).message) || t("creator.error"); }
    }
  });
  byId("cs-del")?.addEventListener("click", () => {
    confirmBox(
      t("account.danger.deleteAccount"),
      t("account.danger.deleteAccountConfirm", { email: me?.email ?? "" }),
      me?.email ?? "",
      async () => { await deleteAccount(); window.location.assign("/login"); },
    );
  });
}

function renderAccountCenter(m: HTMLElement): void {
  const tab = (id: AcctTab, label: string) =>
    `<button type="button" class="acct-tab ${acctTab === id ? "on" : ""}" data-atab="${id}">${esc(label)}</button>`;
  m.innerHTML = `
    <h1 class="admin-title">${esc(t("creator.nav.account"))}</h1>
    <p class="pl-sub">${esc(t("creator.account.sub"))}</p>
    <div class="acct-tabs">${tab("profile", t("creator.account.profileTab"))}${tab("channels", t("creator.account.channelsTab"))}</div>
    <section class="card cr-editor" id="cr-editor"></section>`;
  m.querySelectorAll<HTMLElement>(".acct-tab").forEach((b) =>
    b.addEventListener("click", () => { acctTab = b.dataset.atab as AcctTab; renderAccountCenter(m); }));
  const editor = byId("cr-editor");
  if (!editor) return;
  if (acctTab === "profile") renderProfile(editor, "account");
  else renderHandles(editor, "account");
}

function renderDashComingSoon(m: HTMLElement, view: DashView): void {
  const title = view === "campaigns" ? t("creator.tab.campaigns") : t("creator.tab.messages");
  const sub = view === "campaigns" ? t("creator.campaigns.soon") : t("messages.comingSoon");
  m.innerHTML = `
    <div class="coming-wrap">
      <div class="coming-blur" aria-hidden="true">
        <h1 class="admin-title">${esc(title)}</h1>
        ${crFaux()}
      </div>
      <div class="coming-overlay">
        <div class="coming-badge">${esc(t("account.comingSoon"))}</div>
        <p>${esc(sub)}</p>
      </div>
    </div>`;
}

function crFaux(): string {
  const line = (w: string) => `<span class="fx-line" style="width:${w}"></span>`;
  const pill = () => `<span class="fx-pill"></span>`;
  const card = () => `<div class="card fx-creator">${line("58%")}${line("90%")}${line("74%")}<div class="fx-pills">${pill()}${pill()}${pill()}</div></div>`;
  return `<div class="fx-cards">${Array.from({ length: 6 }, card).join("")}</div>`;
}

/* ---- routing ------------------------------------------------------------- */

function render(): void {
  if (step !== "verify") stopVerifyPoll();
  if (step === "home") { renderDashboard(); return; }
  // The dashboard replaces the body with the dark-nav shell; rebuild the
  // onboarding shell (top bar + centered stage) when coming back to a step.
  if (!document.querySelector(".creator-stage")) {
    document.body.className = "theme-risograph creator-body";
    document.body.innerHTML = shell();
    wireLang();
  }
  const stage = document.querySelector<HTMLElement>(".creator-stage");
  if (!stage) return;
  stage.classList.remove("creator-stage-wide");
  let card = byId("creator-card");
  if (!card) {
    stage.innerHTML = `<section class="card creator-card" id="creator-card"></section>`;
    card = byId("creator-card");
  }
  if (!card) return;
  // Wider card for the content-heavy steps; simple steps stay narrow.
  card.className = "card creator-card"
    + (step === "profile" ? " creator-card--md" : step === "handles" ? " creator-card--lg" : "");
  if (step === "verify") renderVerifyInto(card, { email: me?.email ?? "", onVerified: () => go("profile") });
  else if (step === "signup") renderSignup(card);
  else if (step === "profile") renderProfile(card);
  else if (step === "handles") renderHandles(card);
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

/** After Stripe Checkout redirects back to /creator?service=…, record the
 * booking (success) and open the services page, then clean the URL. */
async function handleServiceReturn(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const outcome = params.get("service");
  if (!outcome) return;
  const sessionId = params.get("session_id");
  if (outcome === "success" && sessionId) {
    await confirmServiceBooking(sessionId).catch(() => {});
  }
  step = "home";
  dashView = "services";
  // Drop the query params so a refresh doesn't re-confirm.
  window.history.replaceState({}, "", "/creator");
}

/** Boot the creator flow. */
export async function initCreator(): Promise<void> {
  initI18n();
  document.title = t("creator.pageTitle");
  document.body.className = "theme-risograph creator-body";

  me = await getMe().catch(() => null);
  if (me && me.role === "creator") {
    const [handles, prof] = await Promise.all([
      getCreatorHandles().catch(() => ({ accounts: [], instagramEnabled: false })),
      getCreatorProfile().catch(() => ({ profile: null })),
    ]);
    accounts = handles.accounts;
    igEnabled = handles.instagramEnabled;
    profile = prof.profile;
    // Hard barrier: an unverified creator can't proceed past the verify gate.
    // Otherwise: no channels yet → onboarding from profile; else home.
    step = !me.email_verified ? "verify"
      : accounts.length ? "home" : "profile";
    // Returning from Stripe Checkout for a service booking → land on the
    // services page and record the booking (belt-and-braces with the webhook).
    if (me.email_verified) await handleServiceReturn();
  } else {
    // Logged out, or signed in as a locale account choosing "register as a
    // creator" — show the creator signup. Signing up creates a creator account.
    step = "signup";
  }
  document.body.innerHTML = shell();
  wireLang();
  render();
  onLangChange(() => {
    document.body.innerHTML = shell();
    wireLang();
    render();
  });
}
