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
  createSetupIntent,
  digitizeMenu,
  digitizeMenuUrl,
  faviconLogo,
  getConfig,
  getMe,
  getPlaceDetails,
  improveMenuWithAi,
  login,
  placePhotoUrl,
  putBilling,
  putGuidelines,
  putMenu,
  putProfile,
  searchPlaces,
  signup,
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

const STORAGE_KEY = "tt-onboarding";

const nf = new Intl.NumberFormat("en-US");
const eur = (n: number) =>
  "€" + new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);

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
  let restaurantId: number | null = null; // the provisioned tenant
  let authed = false; // a session exists (signed up or logged in)
  let principalEmail = ""; // the logged-in account's email
  let configLoaded = false; // did /api/config actually load (vs backend down)?

  const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as T | null;

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
      if (progressName) progressName.textContent = steps[index].dataset.name ?? "";
    }

    if (steps[index].dataset.step === "billing") ensureStripe();
    if (index === doneIndex) window.localStorage.removeItem(STORAGE_KEY);

    steps[index].scrollIntoView({ block: "start", behavior: "smooth" });
    steps[index].querySelector<HTMLElement>("input, select, textarea, button")?.focus();
  }

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
      el.innerHTML = `<span class="muted">No Google rating yet</span>`;
      return;
    }
    const full = Math.round(rating);
    const stars = "★★★★★".slice(0, full) + "☆☆☆☆☆".slice(0, 5 - full);
    el.innerHTML =
      `<span class="star">${stars}</span> ${rating.toFixed(1)}` +
      (reviews ? ` <span class="muted">· ${nf.format(reviews)} reviews</span>` : "");
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
    if (banner) banner.textContent = "Pulled from Google. Edit anything that's off.";
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
    if (banner) banner.textContent = "Enter your details — you can refine them anytime.";
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
        configLoaded
          ? "Live Google search isn't configured (add GOOGLE_MAPS_API_KEY). You can enter details manually."
          : "Can't reach the server. Start the backend (uvicorn on :8000) and reload — or enter details manually.",
        configLoaded ? "" : "error",
      );
      if (manualToggle) manualToggle.hidden = false;
      return;
    }
    if (q.length < 2) {
      setSearchNotice("Type your restaurant name and city, then hit Search.");
      results.innerHTML = "";
      return;
    }
    setSearchNotice("Searching…");
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
        stepError("account", new Error("Please sign in again to continue — your session wasn't active."));
        return;
      }
      setSearchNotice(
        "Couldn't reach search — make sure the backend is running (uvicorn on :8000). You can enter details manually.",
        "error",
      );
      if (manualToggle) manualToggle.hidden = false;
      return;
    }
    if (hits === null) hits = [];
    if (!hits.length) {
      setSearchNotice(`No matches for “${q}”. Check the spelling, or enter details manually.`);
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
        btn.textContent = "Loading…";
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
            category: h.primaryType || "Restaurant",
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
      sectionInput.placeholder = "Section";
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
        name.placeholder = "Item name";
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
        remove.setAttribute("aria-label", `Remove ${item.name || "item"}`);
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

  async function handleMenuPdf(file: File): Promise<void> {
    if (file.type !== "application/pdf") {
      setMenuStatus("Please choose a PDF file.", "error");
      return;
    }
    setMenuStatus(`Reading “${file.name}”…`, "loading");
    try {
      const base64 = await fileToBase64(file);
      lastMenuSource = { data: base64 };
      menuItems = await digitizeMenu(base64);
      renderMenuItems();
      setMenuStatus(
        menuItems.length
          ? `Read ${menuItems.length} item${menuItems.length === 1 ? "" : "s"}. Edit below, or improve with AI.`
          : "No items found — try improving with AI, or a clearer PDF.",
      );
      revealImprove();
      save();
    } catch (err) {
      setMenuStatus(`Couldn't read this menu: ${String(err)}`, "error");
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
    setMenuStatus("Improving with AI… this can take a few seconds.", "loading");
    try {
      menuItems = await improveMenuWithAi(lastMenuSource);
      renderMenuItems();
      setMenuStatus(`Improved — ${menuItems.length} items.`);
      save();
    } catch (err) {
      setMenuStatus(`AI cleanup failed: ${String(err)}`, "error");
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
      setMenuStatus("Add your menu page URL first.", "error");
      return;
    }
    setMenuStatus("Reading your menu page…", "loading");
    try {
      lastMenuSource = { url };
      menuItems = await digitizeMenuUrl(url);
      renderMenuItems();
      setMenuStatus(
        menuItems.length
          ? `Read ${menuItems.length} item${menuItems.length === 1 ? "" : "s"}. Edit below, or improve with AI.`
          : "No items found — try improving with AI, or the PDF upload.",
      );
      revealImprove();
      save();
    } catch (err) {
      setMenuStatus(`Couldn't read that menu: ${String(err)}`, "error");
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

  /* ---- Budget maths ---------------------------------------------------- */

  const limit = form.elements.namedItem("limit") as HTMLInputElement;

  function budget(): { limit: number; views: number } {
    const lim = Number(limit.value);
    const views = Math.max(0, Math.round((lim - PRICING.platformFee) / PRICING.ratePerView));
    return { limit: lim, views };
  }

  function renderBudget(): void {
    const { limit: lim, views } = budget();
    const set = (id: string, v: string) => {
      const el = byId(id);
      if (el) el.textContent = v;
    };
    set("fig-limit", eur(lim));
    set("fig-views", nf.format(views));
    set("fig-cpm", `€${PRICING.cpm} CPM`);
    set("bd-fee", eur(PRICING.platformFee));
    set("bd-views", eur(lim - PRICING.platformFee));
    set("bd-count", nf.format(views));
  }

  limit.addEventListener("input", () => {
    renderBudget();
    save();
  });

  /* ---- Stripe ---------------------------------------------------------- */

  async function ensureStripe(): Promise<void> {
    if (stripeReady) return;
    const notice = byId("pay-notice");
    const saveBtn = byId<HTMLButtonElement>("save-card");
    if (!config) return;

    if (!config.stripeEnabled || !config.stripePublishableKey) {
      if (notice) {
        notice.hidden = false;
        notice.textContent =
          "No card needed to sign up — we'll ask for a payment method before your first campaign goes live.";
      }
      stripeReady = true;
      return;
    }

    try {
      if (restaurantId == null) throw new Error("Finish the restaurant step first.");
      stripe = await loadStripe(config.stripePublishableKey);
      if (!stripe) throw new Error("Stripe.js failed to load");
      const { clientSecret } = await createSetupIntent(restaurantId);
      elements = stripe.elements({ clientSecret, appearance: { theme: "flat" } });
      const paymentEl = elements.create("payment");
      paymentEl.mount("#payment-element");
      if (saveBtn) saveBtn.hidden = false;
      stripeReady = true;
    } catch (err) {
      if (notice) {
        notice.hidden = false;
        notice.className = "notice error";
        notice.textContent = `Couldn't start Stripe: ${String(err)}`;
      }
      stripeReady = true;
    }
  }

  byId("save-card")?.addEventListener("click", async () => {
    if (!stripe || !elements) return;
    const saveBtn = byId<HTMLButtonElement>("save-card");
    const notice = byId("pay-notice");
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
    }
    const { error, setupIntent } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: "if_required",
    });
    if (error) {
      if (notice) {
        notice.hidden = false;
        notice.className = "notice error";
        notice.textContent = error.message ?? "Card could not be saved.";
      }
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save card";
      }
      return;
    }
    const pmId = String(setupIntent?.payment_method ?? "");
    payment = { connected: true, paymentMethodId: pmId };
    showPaymentSaved();
  });

  function showPaymentSaved(): void {
    const status = byId("pay-status");
    const statusText = byId("pay-status-text");
    const el = byId("payment-element");
    const saveBtn = byId("save-card");
    if (statusText) {
      statusText.textContent = payment.last4
        ? `${(payment.brand ?? "card").toUpperCase()} •••• ${payment.last4} saved`
        : "Payment method saved";
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
        lbl.innerHTML =
          `<input type="checkbox" value="${escapeHtml(label)}" ${on ? "checked" : ""}>` +
          `<span class="box">✓</span>${escapeHtml(label)}`;
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
        ? `${menuItems.length} menu items`
        : val("menuUrl") || "Added later",
    );
    const { limit: lim, views } = budget();
    put("r-limit", `${eur(lim)} / month`);
    put("r-views", `~${nf.format(views)} / month`);
    put(
      "r-payment",
      payment.connected
        ? payment.last4
          ? `${(payment.brand ?? "card").toUpperCase()} •••• ${payment.last4}`
          : "Card saved"
        : config?.stripeEnabled
          ? "Not added"
          : "Added before launch",
    );
    const g = guidelines();
    put("r-show", g.show.join(", "));
    put("r-must", g.mustInclude.join(", "));
    put("r-avoid", g.avoid.join(", ") || "None");
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
    const msg = (err as Error)?.message || "Something went wrong. Please try again.";
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
      submitBtn.textContent = "Creating account…";
    }
    void (async () => {
      try {
        if (restaurantId == null) {
          show(1); // safety: no restaurant provisioned yet
          return;
        }
        await persistGuidelines(); // ensure the latest brief is saved
        await activateRestaurant(restaurantId);
        const name = val("rname").trim();
        const doneTitle = byId("done-title");
        const doneEmail = byId("done-email");
        if (doneTitle) doneTitle.textContent = name ? `You're in, ${name}.` : "You're in.";
        if (doneEmail) doneEmail.textContent = principalEmail || val("email");
        show(doneIndex);
      } catch (err) {
        stepError("review", err);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Create account";
        }
      }
    })();
  });

  /** Apply config-driven UI (Places manual fallback, menu notices). */
  function applyConfigUi(): void {
    if (!config) return;
    if (searchNotice) {
      searchNotice.hidden = config.placesEnabled;
      searchNotice.className = config.placesEnabled || configLoaded ? "notice" : "notice error";
      if (!config.placesEnabled) {
        searchNotice.textContent = configLoaded
          ? "Live Google search isn't configured (add GOOGLE_MAPS_API_KEY). Enter your details manually below."
          : "Can't reach the server. Start the backend (uvicorn on :8000) and reload — or enter details manually.";
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
        notice.textContent =
          "Menu digitization needs the MarkItDown library on the server (pip install 'markitdown[pdf]').";
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
          notice.textContent =
            "Add LLM_BASE_URL + LLM_API_KEY (gpt-oss-120b) for best results. Without them, items are extracted with a simpler parser.";
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
    applyConfigUi();
    renderBudget();
    show(authed ? 1 : 0); // signed-in users skip straight to a new restaurant
  }

  byId("restart")?.addEventListener("click", resetAll);

  /* ---- Boot ------------------------------------------------------------ */

  buildChips();
  restore(); // clears any stale draft — every visit starts fresh
  renderBudget();

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
        pricing: { ratePerView: PRICING.ratePerView, platformFee: PRICING.platformFee },
      };
    }
    applyConfigUi();
    // Returning, signed-in accounts skip the signup step and go add a restaurant.
    const me = await getMe();
    if (me && me.role === "account") {
      authed = true;
      principalEmail = me.email;
    }
    show(authed ? 1 : 0);
  })();
}

/* ---- helpers ----------------------------------------------------------- */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
