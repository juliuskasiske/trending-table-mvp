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
  createSetupIntent,
  digitizeMenu,
  digitizeMenuUrl,
  faviconLogo,
  getConfig,
  getPaymentMethod,
  getPlaceDetails,
  improveMenuWithAi,
  placePhotoUrl,
  searchPlaces,
  type AppConfig,
  type MenuSource,
} from "./api.ts";
import {
  GUIDELINE_PRESETS,
  PRICING,
  defaultGuidelines,
  type ContentGuidelines,
  type MenuItem,
  type PaymentInfo,
  type PlaceDetails,
  type RestaurantProfile,
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

  async function runSearch(q: string): Promise<void> {
    if (!results || !config) return;
    if (!config.placesEnabled) {
      if (searchNotice) {
        searchNotice.hidden = false;
        searchNotice.textContent =
          "Live Google search isn't configured (add GOOGLE_MAPS_API_KEY). You can enter details manually.";
      }
      if (manualToggle) manualToggle.hidden = false;
      return;
    }
    if (q.length < 2) {
      results.innerHTML = "";
      return;
    }
    const hits = await searchPlaces(q);
    results.innerHTML = "";
    if (!hits.length) {
      if (manualToggle) manualToggle.hidden = false;
      return;
    }
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
      stripe = await loadStripe(config.stripePublishableKey);
      if (!stripe) throw new Error("Stripe.js failed to load");
      const { clientSecret } = await createSetupIntent(val("email"), val("rname"));
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
    try {
      const pm = await getPaymentMethod(pmId);
      payment.brand = pm.brand;
      payment.last4 = pm.last4;
    } catch {
      /* display without brand/last4 */
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

  function save(): void {
    const data: Record<string, unknown> = {
      selected,
      menuItems,
      guidelines: guidelines(),
    };
    for (const n of [
      "email",
      "rname",
      "category",
      "address",
      "description",
      "website",
      "menuUrl",
      "limit",
    ] as const) {
      data[n] = val(n);
    }
    data.profileShown = !byId("profile-block")?.hidden;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* non-fatal */
    }
  }

  function restore(): void {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      for (const n of [
        "email",
        "rname",
        "category",
        "address",
        "description",
        "website",
        "menuUrl",
        "limit",
      ] as const) {
        if (typeof data[n] === "string") fill(idFor(n), data[n] as string);
      }
      if (data.selected) selected = data.selected as PlaceDetails;
      if (Array.isArray(data.menuItems)) {
        menuItems = data.menuItems as MenuItem[];
        renderMenuItems();
      }
      if (data.profileShown) {
        if (selected) {
          renderLogo(selected.name, selected.website, selected.photoName);
          renderStars(selected.rating, selected.reviews);
        } else {
          renderLogo(val("rname"));
          renderStars(undefined);
        }
        revealProfile();
      }
      const g = data.guidelines as ContentGuidelines | undefined;
      if (g) {
        fill("handle", g.handle ?? "");
        fill("notes", g.notes ?? "");
        pendingGuidelines = g;
      }
    } catch {
      /* corrupt payload — ignore */
    }
  }

  let pendingGuidelines: ContentGuidelines | null = null;
  function idFor(name: string): string {
    const map: Record<string, string> = {
      rname: "p-name",
      category: "p-category",
      address: "p-address",
      description: "p-description",
      website: "p-website",
      menuUrl: "p-menu",
      email: "email",
      limit: "limit",
      handle: "handle",
      notes: "notes",
    };
    return map[name] ?? name;
  }

  /* ---- Wiring ---------------------------------------------------------- */

  form.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-next]")) {
      if (!validateStep(index)) return;
      save();
      const target = index + 1;
      if (steps[target]?.dataset.step === "review") renderReview();
      show(target);
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
    if (!validateStep(index)) return;
    const submitBtn = form!.querySelector<HTMLButtonElement>("[data-submit]");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Creating account…";
    }
    const profile = assembleProfile();
    // No persistence backend yet — this is where the account POST would go.
    console.info("[trending-table] restaurant profile:", profile);

    window.setTimeout(() => {
      const doneName = byId("done-name");
      const doneEmail = byId("done-email");
      if (doneName) doneName.textContent = profile.name || "friend";
      if (doneEmail) doneEmail.textContent = profile.email;
      show(doneIndex);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Create account";
      }
    }, 600);
  });

  function assembleProfile(): RestaurantProfile {
    return {
      email: val("email"),
      placeId: selected?.placeId,
      name: val("rname"),
      address: val("address"),
      category: val("category"),
      tags: selected?.tags ?? [],
      rating: selected?.rating,
      reviews: selected?.reviews,
      description: val("description"),
      website: val("website") || undefined,
      logoUrl: selected?.website ? faviconLogo(selected.website) : undefined,
      photoName: selected?.photoName,
      menu: menuItems,
      menuUrl: val("menuUrl") || undefined,
      spendingLimit: budget().limit,
      payment,
      guidelines: guidelines(),
    };
  }

  byId("restart")?.addEventListener("click", () => {
    window.localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  });

  /* ---- Boot ------------------------------------------------------------ */

  buildChips();
  restore();
  // Re-apply restored guideline selections after chips exist.
  if (pendingGuidelines) {
    (["show", "mustInclude", "avoid"] as const).forEach((group) => {
      form!.querySelectorAll<HTMLInputElement>(`.chips[data-group="${group}"] input`).forEach((input) => {
        const on = (pendingGuidelines![group] as string[]).includes(input.value);
        input.checked = on;
        input.closest(".chip")?.classList.toggle("on", on);
      });
    });
  }
  renderBudget();

  getConfig()
    .then((c) => {
      config = c;
      // If live search isn't available, offer manual entry up front so the
      // restaurant step never dead-ends waiting on a keystroke.
      if (!c.placesEnabled) {
        if (searchNotice) {
          searchNotice.hidden = false;
          searchNotice.textContent =
            "Live Google search isn't configured (add GOOGLE_MAPS_API_KEY). Enter your details manually below.";
        }
        if (manualToggle) manualToggle.hidden = false;
      }
      // Menu digitization (PDF + link) needs MarkItDown on the server.
      if (!c.menuAiEnabled) {
        const notice = byId("menu-ai-notice");
        if (notice) {
          notice.hidden = false;
          notice.textContent =
            "Menu digitization needs the MarkItDown library on the server (pip install 'markitdown[pdf]').";
        }
        const dropEl = byId("menu-drop");
        const input = byId<HTMLInputElement>("menu-pdf");
        if (dropEl) dropEl.style.pointerEvents = "none";
        if (dropEl) dropEl.style.opacity = "0.5";
        if (input) input.disabled = true;
        const linkBtn = byId<HTMLButtonElement>("digitize-link");
        if (linkBtn) linkBtn.disabled = true;
      } else if (!c.menuLlmEnabled) {
        // MarkItDown works, but no LLM configured — items come from a simpler
        // heuristic parse. Let the user know it's best-effort.
        const notice = byId("menu-ai-notice");
        if (notice) {
          notice.hidden = false;
          notice.textContent =
            "Add LLM_BASE_URL + LLM_API_KEY (gpt-oss-120b) for best results. Without them, items are extracted with a simpler parser.";
        }
      }
    })
    .catch(() => {
      config = {
        placesEnabled: false,
        menuAiEnabled: false,
        menuLlmEnabled: false,
        stripeEnabled: false,
        stripePublishableKey: null,
        pricing: { ratePerView: PRICING.ratePerView, platformFee: PRICING.platformFee },
      };
    });

  show(0);
}

/* ---- helpers ----------------------------------------------------------- */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
