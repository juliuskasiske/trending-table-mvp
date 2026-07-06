/**
 * Onboarding controller.
 *
 * Flow: account → restaurant (search + prefill) → billing (budget + Stripe)
 *       → guidelines → review → done
 *
 * The guiding principle: the restaurant types the bare minimum. A single Google
 * Places pick fills name, logo, address, rating, category and description; the
 * rest is budget, a saved card, and a mostly-prefilled creative brief.
 */
import {
  activateRestaurant,
  createRestaurant,
  createSubscription,
  validatePromo,
  digitizeMenu,
  digitizeMenuUrl,
  faviconLogo,
  getConfig,
  getMe,
  getPlaceDetails,
  improveMenuWithAi,
  login,
  logout,
  placePhotoUrl,
  putBilling,
  putGuidelines,
  putMenu,
  putProfile,
  searchPlaces,
  signup,
  verifyEmail,
  type AppConfig,
  type MenuSource,
  type RestaurantProfileInput,
} from "./api.ts";
import {
  GUIDELINE_PRESETS,
  PRICING,
  defaultGuidelines,
  type ContentGuidelines,
  type MenuItem,
  type PaymentInfo,
  type PlaceDetails,
} from "./types.ts";
import { loadStripe, type Stripe, type StripeElements } from "@stripe/stripe-js";
import { getLang, onLangChange, t, tChip } from "./i18n.ts";

const STORAGE_KEY = "tt-onboarding";

const locale = () => (getLang() === "de" ? "de-DE" : "en-US");
const nf = { format: (n: number) => new Intl.NumberFormat(locale()).format(n) };
// Locale-aware currency: € leads in English (€50), trails in German (50 €).
const eur = (n: number) =>
  new Intl.NumberFormat(locale(), {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

/** Euro with cents — for fee amounts like €49.99 that must not round to €50. */
const eur2 = (n: number) =>
  new Intl.NumberFormat(locale(), {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

export function initOnboarding(): void {
  const form = document.querySelector<HTMLFormElement>("#onboarding");
  if (!form) return;

  const steps = Array.from(form.querySelectorAll<HTMLElement>(".step"));
  const doneIndex = steps.findIndex((s) => s.dataset.step === "done");
  const flowCount = doneIndex;

  const progress = document.querySelector<HTMLElement>("#progress");
  const progressSteps = document.querySelector<HTMLOListElement>("#progress-steps");
  const progressCurrent = document.querySelector<HTMLElement>("#progress-current");
  const progressTotal = document.querySelector<HTMLElement>("#progress-total");
  const progressName = document.querySelector<HTMLElement>("#progress-name");

  let index = 0;

  /* ---- App state ------------------------------------------------------- */
  let config: AppConfig | null = null;
  let selected: PlaceDetails | null = null; // chosen Google place (if any)
  let menuItems: MenuItem[] = []; // digitized from an uploaded PDF menu
  let lastMenuSource: MenuSource | null = null; // for "improve with AI" re-runs
  let payment: PaymentInfo = { connected: false };
  let stripe: Stripe | null = null;
  let elements: StripeElements | null = null;
  let stripeReady = false;
  let stripeMode: "setup" | "subscription" = "subscription"; // "setup" when trialing
  let restaurantId: number | null = null; // the provisioned tenant
  let authed = false; // a session exists (signed up or logged in)
  let principalEmail = ""; // the logged-in account's email
  let doneName = ""; // restaurant name shown on the success screen
  let cadence: "monthly" | "annual" = "monthly"; // platform-fee billing cycle
  let configLoaded = false; // did /api/config actually load (vs backend down)?

  const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as T | null;

  /** Top-of-page banner for email-verification feedback. */
  function showBanner(text: string, kind: "ok" | "error" = "ok"): void {
    const el = byId("verify-banner");
    if (!el) return;
    el.hidden = false;
    el.className = "verify-banner " + kind;
    el.textContent = text;
  }

  // Progress segments
  if (progressSteps) {
    for (let i = 0; i < flowCount; i++) progressSteps.appendChild(document.createElement("li"));
  }
  if (progressTotal) progressTotal.textContent = String(flowCount);

  /* ---- Navigation ------------------------------------------------------ */

  function show(next: number): void {
    index = next;
    steps.forEach((s, i) => s.classList.toggle("active", i === index));
    const onFlow = index < flowCount;
    if (progress) progress.hidden = !onFlow;

    if (onFlow) {
      const segs = progressSteps?.children;
      if (segs) {
        Array.from(segs).forEach((seg, i) => {
          seg.classList.toggle("done", i < index);
          seg.classList.toggle("current", i === index);
        });
      }
      if (progressCurrent) progressCurrent.textContent = String(index + 1);
      if (progressName) progressName.textContent = t(`stepname.${steps[index].dataset.step}`);
    }

    if (steps[index].dataset.step === "billing") ensureStripe();
    if (index === doneIndex) window.localStorage.removeItem(STORAGE_KEY);

    steps[index].scrollIntoView({ block: "start", behavior: "smooth" });
    steps[index].querySelector<HTMLElement>("input, select, textarea, button")?.focus();
  }

  /* ---- Entry chooser (gate) — /login and /register -------------------- */

  const setPath = (path: string) => {
    if (window.location.pathname.replace(/\/+$/, "") !== path) {
      window.history.replaceState(null, "", path);
    }
  };

  function showGate(): void {
    byId("gate")!.hidden = false;
    if (form) form.hidden = true;
    if (progress) progress.hidden = true;
    setPath("/login");
  }

  function startFlow(index: number): void {
    byId("gate")!.hidden = true;
    byId("gate-soon")!.hidden = true;
    if (form) form.hidden = false;
    setPath("/register");
    show(index);
  }

  function showComingSoon(kind: "creator" | "restaurantLogin"): void {
    const el = byId("gate-soon");
    if (!el) return;
    el.hidden = false;
    el.textContent = t(`gate.soon.${kind}`);
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // One login window that stays in place; the role toggle only changes where
  // its buttons point. For now only Restaurant · Sign up is live.
  let gateRole: "restaurant" | "creator" = "restaurant";

  function selectRole(role: "restaurant" | "creator"): void {
    gateRole = role;
    document.querySelectorAll<HTMLElement>("#role-toggle button[data-role]").forEach((b) => {
      b.classList.toggle("on", b.dataset.role === role);
    });
    byId("gate-soon")!.hidden = true;
    byId("gate-error")!.hidden = true;
  }

  document.querySelectorAll<HTMLButtonElement>("#role-toggle button[data-role]").forEach((b) => {
    b.addEventListener("click", () => selectRole(b.dataset.role as "restaurant" | "creator"));
  });

  byId("gate-signup")?.addEventListener("click", () => {
    if (gateRole === "restaurant") startFlow(0); // → /register
    else showComingSoon("creator");
  });

  byId("gate-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (gateRole !== "restaurant") {
      showComingSoon("creator"); // creator side isn't live yet
      return;
    }
    const emailEl = byId<HTMLInputElement>("gate-email");
    const pwEl = byId<HTMLInputElement>("gate-password");
    const errEl = byId("gate-error");
    const btn = byId<HTMLButtonElement>("gate-login");
    const email = emailEl?.value.trim() ?? "";
    const password = pwEl?.value ?? "";
    if (!email || !password) return;
    if (errEl) errEl.hidden = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = t("gate.loggingIn");
    }
    try {
      await login(email, password, "account");
      window.location.assign("/account"); // land in account management
    } catch (err) {
      if (errEl) {
        errEl.hidden = false;
        errEl.textContent =
          (err as { status?: number }).status === 403
            ? t("gate.accountDeleted")
            : t("gate.loginFailed");
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = t("gate.login");
      }
    }
  });

  /* ---- Validation ------------------------------------------------------ */

  function setError(name: string, on: boolean): void {
    const err = form!.querySelector<HTMLElement>(`[data-error-for="${name}"]`);
    const field = err?.closest(".field");
    const control = form!.querySelector<HTMLElement>(`[name="${name}"]`);
    if (field) field.classList.toggle("has-error", on);
    else if (err) err.style.display = on ? "block" : "none";
    control?.classList.toggle("invalid", on);
  }

  function val(name: string): string {
    const el = form!.elements.namedItem(name) as
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement
      | null;
    return el ? el.value.trim() : "";
  }

  function validateStep(stepIndex: number): boolean {
    const kind = steps[stepIndex].dataset.step;
    let ok = true;

    if (kind === "account") {
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val("email"));
      const pwOk = (form!.elements.namedItem("password") as HTMLInputElement).value.length >= 8;
      setError("email", !emailOk);
      setError("password", !pwOk);
      ok = emailOk && pwOk;
    } else if (kind === "restaurant") {
      const profileShown = !byId("profile-block")?.hidden;
      if (!profileShown) {
        setError("place", true);
        return false;
      }
      for (const n of ["rname", "address", "category"] as const) {
        const bad = val(n) === "";
        setError(n, bad);
        if (bad) ok = false;
      }
    } else if (kind === "billing") {
      // Require a saved card only when Stripe is actually configured.
      const needCard = Boolean(config?.stripeEnabled);
      const bad = needCard && !payment.connected;
      setError("payment", bad);
      ok = !bad;
    } else if (kind === "review") {
      const consent = (form!.elements.namedItem("consent") as HTMLInputElement).checked;
      setError("consent", !consent);
      ok = consent;
    }
    return ok;
  }

  /* ---- Restaurant search + prefill ------------------------------------- */

  const searchInput = byId<HTMLInputElement>("place-search");
  const results = byId<HTMLUListElement>("search-results");
  const searchNotice = byId("search-notice");
  const manualToggle = byId<HTMLButtonElement>("manual-toggle");
  const searchBlock = byId("search-block");
  const profileBlock = byId("profile-block");

  function initials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "TT";
    return (words[0][0] + (words[1]?.[0] ?? "")).toUpperCase();
  }

  const LOGO_COLORS = ["#ff3d86", "#2b55ff", "#171717", "#e6a400"];
  function logoColor(seed: string): string {
    let h = 0;
    for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return LOGO_COLORS[h % LOGO_COLORS.length];
  }

  function renderLogo(name: string, website?: string, photoName?: string): void {
    const box = byId("p-logo");
    if (!box) return;
    box.innerHTML = "";
    // Prefer the website favicon (usually the real brand mark), then a Google
    // place photo, then a generated monogram — walking the chain on any error.
    const sources = [faviconLogo(website), photoName ? placePhotoUrl(photoName, 128) : undefined]
      .filter((s): s is string => Boolean(s));
    if (!sources.length) {
      paintMonogram(box, name);
      return;
    }
    let i = 0;
    const img = document.createElement("img");
    img.alt = "";
    img.onerror = () => {
      i += 1;
      if (i < sources.length) img.src = sources[i];
      else paintMonogram(box, name);
    };
    img.src = sources[0];
    box.appendChild(img);
  }

  function paintMonogram(box: HTMLElement, name: string): void {
    box.innerHTML = "";
    box.style.background = logoColor(name || "TT");
    box.style.color = "#fff";
    box.textContent = initials(name);
  }

  function renderStars(rating?: number, reviews?: number): void {
    const el = byId("p-rating");
    if (!el) return;
    if (!rating) {
      el.innerHTML = `<span class="muted">${escapeHtml(t("stars.none"))}</span>`;
      return;
    }
    const full = Math.round(rating);
    const stars = "★★★★★".slice(0, full) + "☆☆☆☆☆".slice(0, 5 - full);
    el.innerHTML =
      `<span class="star">${stars}</span> ${rating.toFixed(1)}` +
      (reviews ? ` <span class="muted">· ${escapeHtml(t("stars.reviews", { n: nf.format(reviews) }))}</span>` : "");
  }

  function fill(id: string, value: string): void {
    const el = byId<HTMLInputElement | HTMLTextAreaElement>(id);
    if (el) el.value = value;
  }

  function revealProfile(): void {
    if (profileBlock) profileBlock.hidden = false;
    if (searchBlock) searchBlock.hidden = true;
    const addBtn = byId("menu-add"); // allow adding menu items by hand too
    if (addBtn) addBtn.hidden = false;
    setError("place", false);
  }

  function applyPlace(d: PlaceDetails): void {
    selected = d;
    const banner = byId("prefill-text");
    if (banner) banner.textContent = t("restaurant.prefill.pulled");
    fill("p-name", d.name);
    fill("p-category", d.category);
    fill("p-address", d.address);
    fill("p-description", d.description);
    fill("p-website", d.website ?? "");
    fill("p-menu", d.website ? `${d.website.replace(/\/$/, "")}/menu` : "");
    renderLogo(d.name, d.website, d.photoName);
    renderStars(d.rating, d.reviews);
    revealProfile();
    save();
  }

  function manualProfile(prefName = ""): void {
    selected = null;
    const banner = byId("prefill-text");
    if (banner) banner.textContent = t("restaurant.prefill.manual");
    fill("p-name", prefName);
    fill("p-category", "");
    fill("p-address", "");
    fill("p-description", "");
    fill("p-website", "");
    fill("p-menu", "");
    renderStars(undefined);
    renderLogo(prefName);
    revealProfile();
  }

  function setSearchNotice(text: string, kind: "" | "error" = ""): void {
    if (!searchNotice) return;
    searchNotice.hidden = text === "";
    searchNotice.className = "notice" + (kind ? ` ${kind}` : "");
    searchNotice.textContent = text;
  }

  async function runSearch(q: string): Promise<void> {
    if (!results || !config) return;
    if (!config.placesEnabled) {
      setSearchNotice(
        configLoaded ? t("search.placesOff") : t("search.serverDown"),
        configLoaded ? "" : "error",
      );
      if (manualToggle) manualToggle.hidden = false;
      return;
    }
    if (q.length < 2) {
      setSearchNotice(t("search.typePrompt"));
      results.innerHTML = "";
      return;
    }
    setSearchNotice(t("search.searching"));
    let hits: Awaited<ReturnType<typeof searchPlaces>> | null = null;
    let searchErr: { status?: number } | null = null;
    try {
      hits = await searchPlaces(q);
    } catch (err) {
      searchErr = err as { status?: number };
    }
    results.innerHTML = "";
    if (searchErr) {
      // 401 => the session was lost (e.g. the browser dropped the cookie and we
      // have no token). Send them back to sign in, which re-issues a token.
      if (searchErr.status === 401) {
        authed = false;
        show(0);
        stepError("account", new Error(t("search.sessionLost")));
        return;
      }
      setSearchNotice(t("search.unreachable"), "error");
      if (manualToggle) manualToggle.hidden = false;
      return;
    }
    if (hits === null) hits = [];
    if (!hits.length) {
      setSearchNotice(t("search.noMatches", { q }));
      if (manualToggle) manualToggle.hidden = false;
      return;
    }
    setSearchNotice("");
    for (const h of hits) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "result";
      btn.innerHTML =
        `<span><span class="r-name">${escapeHtml(h.name)}</span><br>` +
        `<span class="r-addr">${escapeHtml(h.address)}</span></span>` +
        (h.rating
          ? `<span class="r-rating"><span class="star">★</span> ${h.rating.toFixed(1)}</span>`
          : "");
      btn.addEventListener("click", async () => {
        btn.textContent = t("result.loading");
        try {
          const d = await getPlaceDetails(h.placeId);
          applyPlace(d);
        } catch {
          // Fall back to what the search already gave us.
          applyPlace({
            placeId: h.placeId,
            name: h.name,
            address: h.address,
            rating: h.rating,
            reviews: h.reviews,
            category: h.primaryType || t("place.defaultCategory"),
            tags: [],
            description: "",
          });
        }
      });
      li.appendChild(btn);
      results.appendChild(li);
    }
  }

  // Search Google only on an explicit trigger (button click or Enter) — never
  // per keystroke, so we don't hit the Places API on every character.
  function triggerSearch(): void {
    void runSearch(searchInput?.value.trim() ?? "");
  }
  byId("place-search-btn")?.addEventListener("click", triggerSearch);
  searchInput?.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      e.preventDefault();
      triggerSearch();
    }
  });

  manualToggle?.addEventListener("click", () => manualProfile(searchInput?.value.trim() ?? ""));
  byId("search-again")?.addEventListener("click", () => {
    if (profileBlock) profileBlock.hidden = true;
    if (searchBlock) searchBlock.hidden = false;
    if (results) results.innerHTML = "";
    if (searchInput) {
      searchInput.value = "";
      searchInput.focus();
    }
    selected = null;
  });

  // Keep the monogram in sync when the user edits the name in manual mode.
  byId("p-name")?.addEventListener("input", (e) => {
    if (!selected) renderLogo((e.target as HTMLInputElement).value);
  });

  /* ---- Menu: link vs digitized PDF ------------------------------------- */

  form.querySelectorAll<HTMLButtonElement>(".menu-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const which = tab.dataset.menuTab;
      form!.querySelectorAll<HTMLElement>(".menu-tab").forEach((t) =>
        t.classList.toggle("on", t === tab),
      );
      form!.querySelectorAll<HTMLElement>("[data-menu-panel]").forEach((p) => {
        p.hidden = p.dataset.menuPanel !== which;
      });
    });
  });

  /**
   * Render the digitized menu as an editable list: each item's name and price
   * are inputs bound directly to the item (typing mutates the model, no
   * re-render, so focus is never lost); each section heading is editable and
   * renames its whole contiguous group; every row has a remove button.
   */
  function renderMenuItems(): void {
    const list = byId<HTMLUListElement>("menu-items");
    if (!list) return;
    list.innerHTML = "";

    // Group into contiguous runs by section so a heading edit renames the run.
    const groups: Array<{ section: string; items: MenuItem[] }> = [];
    for (const item of menuItems) {
      const sec = item.section ?? "";
      const last = groups[groups.length - 1];
      if (last && last.section === sec) last.items.push(item);
      else groups.push({ section: sec, items: [item] });
    }

    for (const group of groups) {
      const head = document.createElement("li");
      head.className = "mi-section-row";
      const sectionInput = document.createElement("input");
      sectionInput.className = "input mi-section-input";
      sectionInput.value = group.section;
      sectionInput.placeholder = t("menu.section.ph");
      sectionInput.addEventListener("input", () => {
        group.items.forEach((it) => (it.section = sectionInput.value));
        save();
      });
      head.appendChild(sectionInput);
      list.appendChild(head);

      for (const item of group.items) {
        const row = document.createElement("li");
        row.className = "mi-row";

        const name = document.createElement("input");
        name.className = "input mi-name-input";
        name.value = item.name;
        name.placeholder = t("menu.item.ph");
        name.addEventListener("input", () => {
          item.name = name.value;
          save();
        });

        const price = document.createElement("input");
        price.className = "input mi-price-input";
        price.value = item.price ?? "";
        price.placeholder = "€0,00";
        price.addEventListener("input", () => {
          item.price = price.value;
          save();
        });

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "mi-remove";
        remove.setAttribute("aria-label", t("menu.remove", { name: item.name || t("menu.item.fallback") }));
        remove.textContent = "✕";
        remove.addEventListener("click", () => {
          const idx = menuItems.indexOf(item);
          if (idx >= 0) menuItems.splice(idx, 1);
          renderMenuItems();
          save();
        });

        row.append(name, price, remove);
        list.appendChild(row);
      }
    }

    const addBtn = byId("menu-add");
    if (addBtn) addBtn.hidden = false;
  }

  // Add a blank item (inherits the last item's section) and focus its name.
  byId("menu-add")?.addEventListener("click", () => {
    const lastSection = menuItems.length
      ? menuItems[menuItems.length - 1].section ?? ""
      : "";
    menuItems.push({ section: lastSection, name: "", price: "" });
    renderMenuItems();
    save();
    const names = document.querySelectorAll<HTMLInputElement>(
      "#menu-items .mi-name-input",
    );
    names[names.length - 1]?.focus();
  });

  function setMenuStatus(text: string, kind: "" | "loading" | "error" = ""): void {
    const el = byId("menu-status");
    if (!el) return;
    el.hidden = text === "";
    el.className = "menu-status" + (kind ? ` ${kind}` : "");
    el.textContent = text;
  }

  /** Read a File as base64 (without the data: URL prefix). */
  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("read failed"));
      reader.onload = () => {
        const result = String(reader.result);
        resolve(result.slice(result.indexOf(",") + 1));
      };
      reader.readAsDataURL(file);
    });
  }

  /** "Read N items…" or the empty-result hint, given a fallback message. */
  function menuReadStatus(emptyKey: string): string {
    if (!menuItems.length) return t(emptyKey);
    return t(menuItems.length === 1 ? "menu.readOne" : "menu.readMany", { n: menuItems.length });
  }

  async function handleMenuPdf(file: File): Promise<void> {
    if (file.type !== "application/pdf") {
      setMenuStatus(t("menu.choosePdf"), "error");
      return;
    }
    setMenuStatus(t("menu.readingFile", { name: file.name }), "loading");
    try {
      const base64 = await fileToBase64(file);
      lastMenuSource = { data: base64 };
      menuItems = await digitizeMenu(base64);
      renderMenuItems();
      setMenuStatus(menuReadStatus("menu.noItemsPdf"));
      revealImprove();
      save();
    } catch (err) {
      setMenuStatus(t("menu.readErr", { err: String(err) }), "error");
    }
  }

  // Show the "Improve with AI" button only when gpt-oss is configured.
  function revealImprove(): void {
    const btn = byId("menu-improve");
    if (btn) btn.hidden = !config?.menuLlmEnabled;
  }

  byId("menu-improve")?.addEventListener("click", async () => {
    if (!lastMenuSource) return;
    const btn = byId<HTMLButtonElement>("menu-improve");
    if (btn) btn.disabled = true;
    setMenuStatus(t("menu.improving"), "loading");
    try {
      menuItems = await improveMenuWithAi(lastMenuSource);
      renderMenuItems();
      setMenuStatus(t("menu.improved", { n: menuItems.length }));
      save();
    } catch (err) {
      setMenuStatus(t("menu.aiFailed", { err: String(err) }), "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  const menuInput = byId<HTMLInputElement>("menu-pdf");
  menuInput?.addEventListener("change", () => {
    const file = menuInput.files?.[0];
    if (file) void handleMenuPdf(file);
  });

  // Digitize a menu web page (the Link tab) through the same pipeline.
  byId("digitize-link")?.addEventListener("click", async () => {
    const url = val("menuUrl");
    if (!url) {
      setMenuStatus(t("menu.addUrlFirst"), "error");
      return;
    }
    setMenuStatus(t("menu.reading"), "loading");
    try {
      lastMenuSource = { url };
      menuItems = await digitizeMenuUrl(url);
      renderMenuItems();
      setMenuStatus(menuReadStatus("menu.noItemsLink"));
      revealImprove();
      save();
    } catch (err) {
      setMenuStatus(t("menu.readErr2", { err: String(err) }), "error");
    }
  });

  const drop = byId("menu-drop");
  drop?.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("dragover");
  });
  drop?.addEventListener("dragleave", () => drop.classList.remove("dragover"));
  drop?.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("dragover");
    const file = (e as DragEvent).dataTransfer?.files?.[0];
    if (file) void handleMenuPdf(file);
  });

  /* ---- Platform-fee amounts (single source of truth: Stripe) ----------- */

  const ANNUAL_DISCOUNT = 0.2; // fallback discount if Stripe prices aren't loaded

  /** The real monthly platform fee in cents — from Stripe, or the €50 default. */
  function feeMonthlyCents(): number {
    return config?.stripePrices?.monthly?.amount ?? Math.round(PRICING.platformFee * 100);
  }
  /** The real annual platform fee in cents — from Stripe, or the discounted default. */
  function feeAnnualCents(): number {
    return (
      config?.stripePrices?.annual?.amount ??
      Math.round(PRICING.platformFee * 12 * (1 - ANNUAL_DISCOUNT) * 100)
    );
  }
  const feeMonthlyEur = () => feeMonthlyCents() / 100;

  /* ---- Budget maths ---------------------------------------------------- */

  const limit = form.elements.namedItem("limit") as HTMLInputElement;

  function budget(): { limit: number; views: number } {
    const lim = Number(limit.value);
    const views = Math.max(0, Math.round((lim - feeMonthlyEur()) / PRICING.ratePerView));
    return { limit: lim, views };
  }

  /** Drive the WebKit slider fill (Firefox fills natively via ::-moz-range-progress). */
  function setSliderFill(): void {
    const min = Number(limit.min) || 0;
    const max = Number(limit.max) || 100;
    const pct = max > min ? ((Number(limit.value) - min) / (max - min)) * 100 : 0;
    limit.style.setProperty("--pct", `${pct}%`);
  }

  function renderBudget(): void {
    const { limit: lim, views } = budget();
    setSliderFill();
    const set = (id: string, v: string) => {
      const el = byId(id);
      if (el) el.textContent = v;
    };
    set("fig-limit", eur(lim));
    set("fig-views", nf.format(views));
    set("bd-fee", eur2(feeMonthlyEur()));
    set("bd-views", eur2(lim - feeMonthlyEur()));
    set("bd-count", nf.format(views));
  }

  limit.addEventListener("input", () => {
    renderBudget();
    save();
  });

  /* ---- Billing cycle (monthly vs annual platform fee) ------------------ */

  /** The annualised platform fee: full (12×monthly) vs the real annual price. */
  function annualFee(): { full: number; discounted: number; savings: number } {
    const full = feeMonthlyEur() * 12;
    const discounted = feeAnnualCents() / 100;
    return { full, discounted, savings: full - discounted };
  }

  function renderCadence(): void {
    const toggle = byId("cadence-toggle");
    toggle?.querySelectorAll<HTMLButtonElement>("button[data-cadence]").forEach((b) => {
      const on = b.dataset.cadence === cadence;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    });
    renderPriceHighlight();
    // The promo code is monthly-only — hide the field (and its note) on annual.
    const promoBox = byId("pay-promo");
    if (promoBox) promoBox.hidden = cadence === "annual";
    applyWelcomeNote();
    const note = byId("cadence-note");
    if (!note) return;
    if (cadence === "annual") {
      const { full, discounted, savings } = annualFee();
      note.textContent = t("billing.cadence.annualNote", {
        full: eur2(full),
        discounted: eur2(discounted),
        savings: eur2(savings),
      });
      note.classList.add("annual");
    } else {
      note.textContent = t("billing.cadence.monthlyNote", { fee: eur2(feeMonthlyEur()) });
      note.classList.remove("annual");
    }
  }

  byId("cadence-toggle")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-cadence]");
    if (!btn) return;
    cadence = btn.dataset.cadence === "annual" ? "annual" : "monthly";
    renderCadence();
    applyWelcomeNote();
    syncStripeAmount();
    flashPrice();
    save();
  });

  // Promo code: validate against Stripe and reflect the discount before paying.
  byId("promo-apply")?.addEventListener("click", async () => {
    const input = byId<HTMLInputElement>("promo-code");
    const note = byId("pay-welcome-note");
    const btn = byId<HTMLButtonElement>("promo-apply");
    const code = input?.value.trim() ?? "";
    if (restaurantId == null || !code) return;
    if (btn) {
      btn.disabled = true;
      btn.textContent = t("pay.promoChecking");
    }
    try {
      const res = await validatePromo(restaurantId, code);
      if (res.valid) {
        appliedPromo = { code: res.code ?? code, percentOff: res.percentOff ?? 0, amountOff: res.amountOff ?? 0 };
        applyWelcomeNote();
      } else {
        appliedPromo = null;
        if (note) {
          note.hidden = false;
          note.textContent = t("pay.promoInvalid");
        }
      }
    } catch {
      if (note) {
        note.hidden = false;
        note.textContent = t("pay.promoInvalid");
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = t("pay.promoApply");
      }
      renderPriceHighlight();
      syncStripeAmount();
      flashPrice();
    }
  });

  /* ---- Stripe ---------------------------------------------------------- */

  /** The platform fee for the selected cadence, in cents (Stripe's unit). */
  function feeCents(): number {
    return cadence === "annual" ? feeAnnualCents() : feeMonthlyCents();
  }

  /** A validated promo code the user entered (null = none applied). */
  let appliedPromo: { code: string; percentOff: number; amountOff: number } | null = null;

  /** The promo code is a monthly first-month perk — it never applies to the
   * annual plan (which already carries its own 20% off). */
  function promoActive(): boolean {
    return appliedPromo !== null && cadence === "monthly";
  }

  /** What Stripe actually charges on the first invoice, in cents — the fee less
   * any applied promo. The Payment Element's amount must match this. */
  function firstChargeCents(): number {
    let cents = feeCents();
    if (promoActive() && appliedPromo) {
      cents = Math.round(cents * (1 - appliedPromo.percentOff / 100)) - appliedPromo.amountOff;
    }
    return Math.max(0, cents);
  }

  /** The effective monthly price the current cadence + promo imply, in cents.
   * Annual shows its monthly-equivalent; a monthly promo shows the reduced fee. */
  function effectiveMonthlyCents(): number {
    if (cadence === "annual") return Math.round(feeAnnualCents() / 12);
    if (appliedPromo) {
      return Math.max(0, Math.round(feeMonthlyCents() * (1 - appliedPromo.percentOff / 100)) - appliedPromo.amountOff);
    }
    return feeMonthlyCents();
  }

  /** Update the highlighted monthly-price readout: the effective price, the
   * struck-through regular price and a −X% badge whenever a discount applies. */
  function renderPriceHighlight(): void {
    const amountEl = byId("price-amount");
    if (!amountEl) return;
    const reg = feeMonthlyCents();
    const eff = effectiveMonthlyCents();
    const discounted = eff < reg;
    amountEl.textContent = eur2(eff / 100);
    const oldEl = byId("price-old");
    if (oldEl) {
      oldEl.hidden = !discounted;
      oldEl.textContent = eur2(reg / 100);
    }
    const badgeEl = byId("price-badge");
    if (badgeEl) {
      badgeEl.hidden = !discounted;
      if (discounted) badgeEl.textContent = "−" + Math.round((1 - eff / reg) * 100) + "%";
    }
    const capEl = byId("price-caption");
    if (capEl) {
      const cap =
        cadence === "annual"
          ? t("price.annualCaption", { yearly: eur2(feeAnnualCents() / 100) })
          : appliedPromo
            ? t("price.firstMonthCaption", { regular: eur2(reg / 100) })
            : "";
      capEl.textContent = cap;
      capEl.hidden = !cap;
    }
  }

  /** Brief pulse on the price when the user toggles cadence or applies a code. */
  function flashPrice(): void {
    const el = byId("price-highlight");
    if (!el) return;
    el.classList.remove("flash");
    void el.offsetWidth; // reflow so the animation restarts
    el.classList.add("flash");
  }

  /** Keep the Payment Element's amount in sync when the cadence toggles.
   * (In setup mode there's no amount — the card is saved, charged later.) */
  function syncStripeAmount(): void {
    if (elements && stripeMode === "subscription") elements.update({ amount: firstChargeCents() });
  }

  async function ensureStripe(): Promise<void> {
    if (stripeReady) return;
    const notice = byId("pay-notice");
    const saveBtn = byId<HTMLButtonElement>("save-card");
    if (!config) return;

    if (!config.stripeEnabled || !config.stripePublishableKey) {
      if (notice) {
        notice.hidden = false;
        notice.textContent = t("pay.noCard");
      }
      stripeReady = true;
      return;
    }

    try {
      if (restaurantId == null) throw new Error(t("pay.finishRestaurant"));
      stripe = await loadStripe(config.stripePublishableKey);
      if (!stripe) throw new Error(t("pay.stripeLoadFail"));
      // When the subscription trials until a launch date, no money is due now,
      // so we collect the card via a SetupIntent ("setup" mode, no amount).
      // Otherwise we charge the first invoice now ("subscription" mode).
      stripeMode = config.subscriptionDeferredStart ? "setup" : "subscription";
      elements = stripe.elements({
        ...(stripeMode === "subscription"
          ? { mode: "subscription" as const, amount: firstChargeCents() }
          : { mode: "setup" as const }),
        currency: "eur",
        // Card only — it can be charged the variable monthly usage later.
        paymentMethodTypes: ["card"],
        appearance: { theme: "flat" },
      });
      const paymentEl = elements.create("payment");
      paymentEl.mount("#payment-element");
      if (saveBtn) saveBtn.hidden = false;
      stripeReady = true;
    } catch (err) {
      if (notice) {
        notice.hidden = false;
        notice.className = "notice error";
        notice.textContent = t("pay.stripeStartErr", { err: String(err) });
      }
      stripeReady = true;
    }
  }

  byId("save-card")?.addEventListener("click", async () => {
    if (!stripe || !elements || restaurantId == null) return;
    const saveBtn = byId<HTMLButtonElement>("save-card");
    const notice = byId("pay-notice");
    const fail = (msg: string) => {
      if (notice) {
        notice.hidden = false;
        notice.className = "notice error";
        notice.textContent = msg;
      }
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = t("btn.subscribe");
      }
    };
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = t("pay.subscribing");
    }
    // Clear any error from a previous attempt — this is a fresh try.
    if (notice) {
      notice.hidden = true;
      notice.textContent = "";
    }

    // 1. Validate the card details the user entered.
    const submit = await elements.submit();
    if (submit.error) return fail(submit.error.message ?? t("pay.subFail"));

    // 2. Create the real subscription for the chosen cadence (nothing charged yet).
    let clientSecret: string;
    try {
      const res = await createSubscription(restaurantId, cadence, promoActive() ? appliedPromo?.code : undefined);
      clientSecret = res.clientSecret;
    } catch (err) {
      return fail(String(err));
    }

    // 3. Confirm: a trialing subscription saves the card (SetupIntent, charged
    //    on the launch date); otherwise it charges the first invoice now.
    const confirmParams = { return_url: window.location.href };
    if (stripeMode === "setup") {
      const { error, setupIntent } = await stripe.confirmSetup({
        elements,
        clientSecret,
        confirmParams,
        redirect: "if_required",
      });
      if (error) return fail(error.message ?? t("pay.subFail"));
      const pmId = String(setupIntent?.payment_method ?? "");
      payment = { connected: true, paymentMethodId: pmId };
    } else {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        clientSecret,
        confirmParams,
        redirect: "if_required",
      });
      if (error) return fail(error.message ?? t("pay.subFail"));
      const pmId = String(
        (paymentIntent && (paymentIntent as { payment_method?: string }).payment_method) ?? "",
      );
      payment = { connected: true, paymentMethodId: pmId };
    }
    showPaymentSaved();
  });

  function showPaymentSaved(): void {
    const status = byId("pay-status");
    const statusText = byId("pay-status-text");
    const el = byId("payment-element");
    const saveBtn = byId("save-card");
    if (statusText) {
      statusText.textContent = payment.last4
        ? t("pay.savedCard", { brand: payment.brand ?? "card", last4: payment.last4 })
        : t("pay.subscribed");
    }
    const notice = byId("pay-notice");
    if (notice) {
      notice.hidden = true;
      notice.textContent = "";
    }
    if (status) status.hidden = false;
    if (el) el.hidden = true;
    if (saveBtn) saveBtn.hidden = true;
    setError("payment", false);
  }

  /* ---- Guidelines ------------------------------------------------------ */

  function buildChips(): void {
    const defaults = defaultGuidelines();
    (Object.keys(GUIDELINE_PRESETS) as Array<keyof typeof GUIDELINE_PRESETS>).forEach((group) => {
      const holder = form!.querySelector<HTMLElement>(`.chips[data-group="${group}"]`);
      if (!holder) return;
      holder.innerHTML = ""; // idempotent — safe to rebuild on reset
      const preset = defaults[group] as string[];
      for (const label of GUIDELINE_PRESETS[group]) {
        const lbl = document.createElement("label");
        const on = preset.includes(label);
        lbl.className = "chip" + (on ? " on" : "");
        // The English label is the stable stored value; the visible text is translated.
        lbl.innerHTML =
          `<input type="checkbox" value="${escapeHtml(label)}" ${on ? "checked" : ""}>` +
          `<span class="box">✓</span><span class="chip-label">${escapeHtml(tChip(label))}</span>`;
        const input = lbl.querySelector("input")!;
        input.addEventListener("change", () => {
          lbl.classList.toggle("on", input.checked);
          save();
        });
        holder.appendChild(lbl);
      }
    });
  }

  function guidelines(): ContentGuidelines {
    const pick = (group: string) =>
      Array.from(
        form!.querySelectorAll<HTMLInputElement>(`.chips[data-group="${group}"] input:checked`),
      ).map((i) => i.value);
    return {
      show: pick("show"),
      mustInclude: pick("mustInclude"),
      avoid: pick("avoid"),
      handle: val("handle"),
      notes: val("notes"),
    };
  }

  /* ---- Review ---------------------------------------------------------- */

  function renderReview(): void {
    const put = (id: string, v: string) => {
      const el = byId(id);
      if (el) el.textContent = v || "—";
    };
    put("r-email", val("email"));
    put("r-name", val("rname"));
    put("r-category", val("category"));
    put("r-address", val("address"));
    put("r-rating", selected?.rating ? `★ ${selected.rating.toFixed(1)}` : "—");
    put(
      "r-menu",
      menuItems.length
        ? t("review.menuItems", { n: menuItems.length })
        : val("menuUrl") || t("review.addedLater"),
    );
    const { limit: lim, views } = budget();
    put("r-limit", t("review.limitMonth", { v: eur(lim) }));
    put("r-views", t("review.viewsMonth", { v: nf.format(views) }));
    put(
      "r-billing",
      cadence === "annual"
        ? t("review.cycle.annual", { discounted: eur2(annualFee().discounted) })
        : t("review.cycle.monthly", { fee: eur2(feeMonthlyEur()) }),
    );
    put(
      "r-payment",
      payment.connected
        ? payment.last4
          ? `${(payment.brand ?? "card").toUpperCase()} •••• ${payment.last4}`
          : t("review.cardSaved")
        : config?.stripeEnabled
          ? t("review.notAdded")
          : t("review.addedBeforeLaunch"),
    );
    const g = guidelines();
    const joinChips = (vals: string[]) => vals.map(tChip).join(", ");
    put("r-show", joinChips(g.show));
    put("r-must", joinChips(g.mustInclude));
    put("r-avoid", joinChips(g.avoid) || t("review.none"));
  }

  /* ---- Persistence ----------------------------------------------------- */

  // Persistence now happens server-side at each step boundary (persist*), so the
  // former localStorage draft is a no-op — kept as the hook the edit handlers
  // already call.
  function save(): void {
    /* no-op */
  }

  /* ---- Server persistence (per step) ----------------------------------- */

  function profileInput(): RestaurantProfileInput {
    return {
      name: val("rname"),
      place_id: selected?.placeId,
      address: val("address") || undefined,
      category: val("category") || undefined,
      tags: selected?.tags,
      google_rating: selected?.rating,
      google_reviews: selected?.reviews,
      description: val("description") || undefined,
      website: val("website") || undefined,
      logo_url: selected?.website ? faviconLogo(selected.website) : undefined,
      photo_ref: selected?.photoName,
    };
  }

  async function persistAccount(): Promise<void> {
    const email = val("email");
    const password = (form!.elements.namedItem("password") as HTMLInputElement).value;
    try {
      const p = await signup(email, password, "account");
      authed = true;
      principalEmail = p.email;
      showBanner(t("verify.sent", { email: p.email }), "ok");
    } catch (err) {
      if ((err as { status?: number }).status === 409) {
        const p = await login(email, password, "account"); // email exists → log in
        authed = true;
        principalEmail = p.email;
      } else {
        throw err;
      }
    }
  }

  async function persistRestaurant(): Promise<void> {
    const profile = profileInput();
    if (restaurantId == null) {
      const r = await createRestaurant({ ...profile, name: profile.name || "My restaurant" });
      restaurantId = r.id;
    } else {
      await putProfile(restaurantId, profile);
    }
    await putMenu(restaurantId, menuItems);
  }

  async function persistBilling(): Promise<void> {
    if (restaurantId != null) await putBilling(restaurantId, budget().limit);
  }

  async function persistGuidelines(): Promise<void> {
    if (restaurantId == null) return;
    const g = guidelines();
    await putGuidelines(restaurantId, {
      show: g.show,
      must_include: g.mustInclude,
      avoid: g.avoid,
      handle: g.handle || undefined,
      notes: g.notes || undefined,
    });
  }

  function stepError(kind: string | undefined, err: unknown): void {
    const msg = (err as Error)?.message || t("error.generic");
    if (kind === "account") {
      const el = form!.querySelector<HTMLElement>('[data-error-for="password"]');
      if (el) el.textContent = msg;
      setError("password", true);
    } else {
      const notice = byId("menu-ai-notice");
      // fall back to a visible message; for restaurant step reuse the menu notice
      if (kind === "restaurant" && notice) {
        notice.hidden = false;
        notice.className = "notice error";
        notice.textContent = msg;
      } else {
        window.alert(msg);
      }
    }
  }

  async function handleNext(): Promise<void> {
    if (!validateStep(index)) return;
    const kind = steps[index].dataset.step;
    const nextBtn = steps[index].querySelector<HTMLButtonElement>("[data-next]");
    if (nextBtn) nextBtn.disabled = true;
    try {
      if (kind === "account") await persistAccount();
      else if (kind === "restaurant") await persistRestaurant();
      else if (kind === "billing") await persistBilling();
      else if (kind === "guidelines") await persistGuidelines();
      const target = index + 1;
      if (steps[target]?.dataset.step === "review") renderReview();
      show(target);
    } catch (err) {
      stepError(kind, err);
    } finally {
      if (nextBtn) nextBtn.disabled = false;
    }
  }

  // Each visit starts a fresh restaurant. We deliberately do NOT resume a
  // previous draft across page loads — otherwise reopening the app (or starting
  // a new restaurant with a new email) would resurrect the last restaurant's
  // name, menu and profile. Clear any stale draft on load.
  function restore(): void {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable — nothing to clear */
    }
  }

  /* ---- Wiring ---------------------------------------------------------- */

  form.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-next]")) {
      void handleNext();
    } else if (t.closest("[data-back]")) {
      show(Math.max(0, index - 1));
    } else if (t.closest<HTMLElement>("[data-goto]")) {
      show(Number(t.closest<HTMLElement>("[data-goto]")!.dataset.goto));
    }
  });

  form.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name && form!.querySelector(`[data-error-for="${t.name}"]`)) setError(t.name, false);
    if (["rname", "category", "address", "description", "website", "menuUrl"].includes(t.name)) save();
  });

  form.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === "consent" && t.checked) setError("consent", false);
    if (t.name === "handle" || t.name === "notes") save();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    // Re-validate the whole flow (skip the account step for an already-signed-in
    // user). Never reach "You're in." without the required fields.
    for (let i = authed ? 1 : 0; i < flowCount; i++) {
      if (!validateStep(i)) {
        show(i);
        return;
      }
    }
    const submitBtn = form!.querySelector<HTMLButtonElement>("[data-submit]");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = t("submit.creating");
    }
    void (async () => {
      try {
        if (restaurantId == null) {
          show(1); // safety: no restaurant provisioned yet
          return;
        }
        await persistGuidelines(); // ensure the latest brief is saved
        await activateRestaurant(restaurantId);

        // Registration done — hand off to the login screen so the user signs in
        // with the account they just created and lands in account management.
        const email = principalEmail || val("email");
        await logout(); // clear the signup session; the login below is the real one
        authed = false;
        selectRole("restaurant");
        const gateEmail = byId<HTMLInputElement>("gate-email");
        const gatePw = byId<HTMLInputElement>("gate-password");
        if (gateEmail) gateEmail.value = email;
        if (gatePw) gatePw.value = "";
        showBanner(t("gate.registered"), "ok");
        showGate();
      } catch (err) {
        stepError("review", err);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = t("btn.createAccount");
        }
      }
    })();
  });

  /** Apply config-driven UI (Places manual fallback, menu notices). */
  /** Inject the real platform fee into the prose that mentions it, in the
   * current language. Driven from code (not data-i18n) so the amount is exact. */
  function applyFeeStrings(): void {
    const fee = eur2(feeMonthlyEur());
    const sub = byId("billing-sub");
    if (sub) sub.textContent = t("billing.sub", { fee });
    const consent = byId("consent-text");
    if (consent) consent.innerHTML = t("review.consent", { fee });
  }

  /** Show "first payment on <date>" when the subscription trials until launch. */
  function applyStartNote(): void {
    const el = byId("pay-start-note");
    if (!el) return;
    if (config?.subscriptionDeferredStart && config.subscriptionStart) {
      const [y, m, d] = config.subscriptionStart.split("-").map(Number);
      const date = new Intl.DateTimeFormat(locale(), {
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date(y, m - 1, d));
      el.textContent = t("pay.startsOn", { date });
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }

  /** Show the confirmation for an applied promo code (empty when none). */
  function applyWelcomeNote(): void {
    const el = byId("pay-welcome-note");
    if (!el) return;
    if (promoActive() && appliedPromo) {
      el.textContent = t("pay.promoApplied", {
        code: appliedPromo.code,
        first: eur2(firstChargeCents() / 100),
        regular: eur2(feeCents() / 100),
      });
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }

  function applyConfigUi(): void {
    if (!config) return;
    applyFeeStrings();
    applyStartNote();
    applyWelcomeNote();
    renderPriceHighlight();
    if (searchNotice) {
      searchNotice.hidden = config.placesEnabled;
      searchNotice.className = config.placesEnabled || configLoaded ? "notice" : "notice error";
      if (!config.placesEnabled) {
        searchNotice.textContent = configLoaded ? t("search.placesOffBelow") : t("search.serverDown");
      }
    }
    if (manualToggle) manualToggle.hidden = config.placesEnabled;

    const notice = byId("menu-ai-notice");
    const dropEl = byId("menu-drop");
    const pdfInput = byId<HTMLInputElement>("menu-pdf");
    const linkBtn = byId<HTMLButtonElement>("digitize-link");
    if (!config.menuAiEnabled) {
      if (notice) {
        notice.hidden = false;
        notice.textContent = t("config.menuNeedsMarkItDown");
      }
      if (dropEl) {
        dropEl.style.pointerEvents = "none";
        dropEl.style.opacity = "0.5";
      }
      if (pdfInput) pdfInput.disabled = true;
      if (linkBtn) linkBtn.disabled = true;
    } else {
      if (dropEl) {
        dropEl.style.pointerEvents = "";
        dropEl.style.opacity = "";
      }
      if (pdfInput) pdfInput.disabled = false;
      if (linkBtn) linkBtn.disabled = false;
      if (notice) {
        notice.hidden = config.menuLlmEnabled;
        if (!config.menuLlmEnabled) {
          notice.textContent = t("config.menuAddLlm");
        }
      }
    }
  }

  /** Wipe everything and return to a clean account step — no page reload. */
  function resetAll(): void {
    selected = null;
    menuItems = [];
    lastMenuSource = null;
    payment = { connected: false };
    stripe = null;
    elements = null;
    stripeReady = false;
    restaurantId = null; // a new restaurant (new tenant) under the same account

    form!.reset();

    // Restaurant search / profile back to their initial state.
    if (profileBlock) profileBlock.hidden = true;
    if (searchBlock) searchBlock.hidden = false;
    if (results) results.innerHTML = "";
    if (searchInput) searchInput.value = "";
    const logo = byId("p-logo");
    if (logo) {
      logo.innerHTML = "";
      logo.style.background = "";
      logo.style.color = "";
    }
    const rating = byId("p-rating");
    if (rating) rating.innerHTML = "";

    // Menu UI.
    renderMenuItems();
    setMenuStatus("");
    const addBtn = byId("menu-add");
    if (addBtn) addBtn.hidden = true;
    const impBtn = byId("menu-improve");
    if (impBtn) impBtn.hidden = true;
    form!.querySelectorAll<HTMLElement>(".menu-tab").forEach((t) =>
      t.classList.toggle("on", t.dataset.menuTab === "link"),
    );
    form!.querySelectorAll<HTMLElement>("[data-menu-panel]").forEach((pane) => {
      pane.hidden = pane.dataset.menuPanel !== "link";
    });

    // Payment UI.
    const payStatus = byId("pay-status");
    if (payStatus) payStatus.hidden = true;
    const saveCard = byId("save-card");
    if (saveCard) saveCard.hidden = true;
    const payEl = byId("payment-element");
    if (payEl) {
      payEl.hidden = false;
      payEl.innerHTML = "";
    }

    buildChips(); // guideline chips back to defaults
    form!.querySelectorAll(".has-error").forEach((f) => f.classList.remove("has-error"));

    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    cadence = "monthly";
    applyConfigUi();
    renderBudget();
    renderCadence();
    startFlow(authed ? 1 : 0); // "start another restaurant" — back into the flow
  }

  byId("restart")?.addEventListener("click", resetAll);

  /* ---- Language switch ------------------------------------------------- */

  // applyStatic() (in i18n.setLang) handles all [data-i18n] markup; here we
  // re-render the controller-driven bits that hold dynamic or interpolated copy.
  onLangChange(() => {
    if (progressName && index < flowCount) {
      progressName.textContent = t(`stepname.${steps[index].dataset.step}`);
    }
    // Chip labels: keep the checked state (value is the stable English key).
    form.querySelectorAll<HTMLElement>(".chip").forEach((chip) => {
      const value = chip.querySelector<HTMLInputElement>("input")?.value ?? "";
      const label = chip.querySelector<HTMLElement>(".chip-label");
      if (label) label.textContent = tChip(value);
    });
    renderBudget();
    renderCadence();
    applyConfigUi();
    if (!profileBlock?.hidden) {
      const banner = byId("prefill-text");
      if (banner) banner.textContent = t(selected ? "restaurant.prefill.pulled" : "restaurant.prefill.manual");
      renderStars(selected?.rating, selected?.reviews);
      renderMenuItems();
    }
    if (steps[index].dataset.step === "review") renderReview();
    if (index === doneIndex) {
      const doneTitle = byId("done-title");
      if (doneTitle) doneTitle.textContent = doneName ? t("done.titleName", { name: doneName }) : t("done.title");
      const doneEmail = byId("done-email"); // applyStatic reset it to the placeholder
      if (doneEmail && principalEmail) doneEmail.textContent = principalEmail;
    }
  });

  /* ---- Boot ------------------------------------------------------------ */

  buildChips();
  restore(); // clears any stale draft — every visit starts fresh
  renderBudget();
  renderCadence();

  void (async () => {
    try {
      config = await getConfig();
      configLoaded = true;
    } catch {
      config = {
        placesEnabled: false,
        menuAiEnabled: false,
        menuLlmEnabled: false,
        stripeEnabled: false,
        stripePublishableKey: null,
        stripePrices: {},
        pricing: { ratePerView: PRICING.ratePerView, platformFee: PRICING.platformFee },
      };
    }
    applyConfigUi();

    // Email verification: the link in the email is APP_BASE_URL/verify?token=…,
    // which loads this SPA. Consume the token, show the result, and clean the URL.
    const token = new URLSearchParams(window.location.search).get("token");
    if (token) {
      try {
        await verifyEmail(token);
        showBanner(t("verify.ok"), "ok");
      } catch {
        showBanner(t("verify.fail"), "error");
      }
      window.history.replaceState(null, "", window.location.pathname);
    }

    // Routing: signed-in accounts go straight to the flow; /register starts a
    // fresh registration; everything else shows the /login screen.
    const me = await getMe();
    const path = window.location.pathname.replace(/\/+$/, "");
    if (me && me.role === "account") {
      authed = true;
      principalEmail = me.email;
      if (path === "/register") {
        startFlow(1); // adding another restaurant — skip the account step
      } else {
        window.location.assign("/account"); // manage the existing account
      }
    } else if (path === "/register") {
      startFlow(0);
    } else {
      showGate();
    }
  })();
}

/* ---- helpers ----------------------------------------------------------- */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
