/**
 * Control tower — owner-only dashboard over the control database.
 *
 * In-app route (`/admin`), lazy-loaded by the SPA. Layout: a left nav toggling
 * Overview / Restaurants / Creators. Access is a single ADMIN_KEY (X-Admin-Key).
 */
import "./styles/theme.css";
import "./styles/onboarding.css"; // shared shell/topbar/card/input/button styles
import "./styles/admin.css";
import { INTRO, SCHEMA_DOC, type Col, type Group, type Table } from "./schema-doc.ts";
import {
  createLead,
  crmSearchPlaces,
  deleteLead,
  getAdminAccounts,
  getAdminCreators,
  getAdminKey,
  getAdminOverview,
  getAdminRestaurants,
  listLeads,
  setAdminKey,
  setLeadStage,
  updateLead,
  type AdminAccount,
  type AdminCreator,
  type AdminOverview,
  type AdminRestaurant,
  type FunnelStage,
  type OutreachLead,
} from "./api.ts";
import type { PlaceSuggestion } from "./types.ts";

type View = "overview" | "restaurants" | "creators" | "outreach" | "schema";

// Stage gates — the single place to rename them.
const STAGES: Array<{ code: string; short: string; full: string }> = [
  { code: "l1", short: "L1", full: "Outreach" },
  { code: "l2", short: "L2", full: "Virtual follow up" },
  { code: "l3", short: "L3", full: "Demo" },
  { code: "l4", short: "L4", full: "Negotiations" },
  { code: "l5", short: "L5", full: "Subscribed" },
];
const stageLabel = (s: { short: string; full: string }) =>
  s.full ? `${s.short} · ${s.full}` : s.short;

// Cancellation reasons (code → label). Editable in one place.
const REASONS: Array<{ code: string; label: string }> = [
  { code: "social_presence", label: "Already gets lots of social media presence" },
  { code: "closing", label: "Closing or selling soon" },
  { code: "no_need", label: "Doesn't want / need social media presence" },
  { code: "sub_cost", label: "Subscription cost too high" },
  { code: "usage_cost", label: "Usage price too high" },
  { code: "low_control", label: "Too little control over content" },
  { code: "other", label: "Other" },
];

const MARKUP = `
<div class="admin-login-wrap" id="admin-login" hidden>
  <section class="card admin-login">
    <h1 class="step-title">Enter access key</h1>
    <p class="step-sub">The control tower is protected by a single owner key.</p>
    <div class="field">
      <label for="a-key">Access key</label>
      <input class="input" type="password" id="a-key" autocomplete="off" autofocus />
    </div>
    <p class="admin-error" id="admin-login-error" hidden></p>
    <div class="actions">
      <button type="button" class="btn btn-primary" id="admin-login-btn">Unlock</button>
    </div>
  </section>
</div>

<div class="admin-app" id="admin-app" hidden>
  <aside class="admin-nav">
    <a href="/" class="brand-logo">trending table<span class="dot">.</span></a>
    <p class="admin-nav-tag">Control tower</p>
    <nav class="admin-nav-list">
      <button type="button" class="nav-item on" data-view="overview">Overview</button>
      <button type="button" class="nav-item" data-view="restaurants">Restaurants</button>
      <button type="button" class="nav-item" data-view="creators">Creators</button>
      <button type="button" class="nav-item" data-view="outreach">Outreach</button>
      <button type="button" class="nav-item" data-view="schema">Data model</button>
    </nav>
    <button type="button" class="linklike admin-signout" id="admin-logout">Sign out</button>
  </aside>

  <main class="admin-main">
    <section class="admin-view" id="view-overview">
      <h1 class="admin-title">Overview</h1>
      <div class="funnel-grid">
        <div class="panel">
          <h2>Restaurant funnel</h2>
          <div id="rest-funnel"></div>
        </div>
        <div class="panel">
          <h2>Creator funnel</h2>
          <div id="crea-funnel"></div>
        </div>
      </div>

      <h2 class="section-head">Payments <span class="section-sub">monthly</span></h2>
      <div class="stat-grid" id="payment-stats"></div>
      <p class="payment-note" id="payment-note"></p>

      <h2 class="section-head">At a glance</h2>
      <div class="stat-grid" id="glance-stats"></div>
      <div class="status-row">
        <span class="status-row-label">Restaurants by status</span>
        <div class="pill-row" id="status-pills"></div>
      </div>
    </section>

    <section class="admin-view" id="view-restaurants" hidden>
      <h1 class="admin-title">Restaurants <span class="count" id="rest-count"></span></h1>
      <div class="table-wrap" id="rest-table"></div>
      <h2 class="section-head">Accounts <span class="count" id="acct-count"></span></h2>
      <div class="table-wrap" id="acct-table"></div>
    </section>

    <section class="admin-view" id="view-creators" hidden>
      <h1 class="admin-title">Creators <span class="count" id="crea-count"></span></h1>
      <div class="table-wrap" id="crea-table"></div>
    </section>

    <section class="admin-view" id="view-outreach" hidden>
      <h1 class="admin-title">Outreach CRM <span class="count" id="crm-count"></span></h1>
      <div class="crm-add">
        <div class="crm-search-box">
          <div class="crm-search-row">
            <input class="input" id="crm-search" type="text" autocomplete="off"
              placeholder="Search a restaurant on Google Maps…" />
            <button type="button" class="btn btn-primary" id="crm-search-btn">Search</button>
          </div>
          <div class="crm-results" id="crm-results" hidden></div>
        </div>
        <p class="crm-hint">Search by name, pick the right location, and it's added as a lead.
          <button type="button" class="linklike" id="crm-manual-toggle">Can't find it? Add manually</button>
        </p>
        <div class="crm-manual" id="crm-manual" hidden>
          <input class="input" id="crm-manual-name" type="text" placeholder="Restaurant name" />
          <input class="input" id="crm-manual-address" type="text" placeholder="Address (optional)" />
          <button type="button" class="btn btn-primary" id="crm-manual-add">Add lead</button>
        </div>
      </div>
      <div class="crm-legend" id="crm-legend"></div>
      <div class="table-wrap" id="crm-table"></div>
    </section>

    <section class="admin-view" id="view-schema" hidden>
      <h1 class="admin-title">Data model</h1>
      <div id="schema-body"></div>
    </section>
  </main>
</div>`;

const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T | null;

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString(undefined, {
        year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
      });
}

function fmtEur(v: number | string | null): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? "€" + new Intl.NumberFormat().format(Math.round(n)) : "—";
}

const statusPill = (s: string) => `<span class="pill ${esc(s)}">${esc(s)}</span>`;
const boolPill = (v: boolean) =>
  v ? `<span class="pill yes">verified</span>` : `<span class="pill no">unverified</span>`;

function renderTable(mount: HTMLElement | null, headers: string[], rows: string[][]): void {
  if (!mount) return;
  if (!rows.length) {
    mount.innerHTML = `<p class="muted" style="padding:14px">Nothing yet.</p>`;
    return;
  }
  const thead = `<tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>`;
  const tbody = rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
  mount.innerHTML = `<table class="admin"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
}

function statCard(v: string | number, label: string, accent = false): string {
  return (
    `<div class="stat${accent ? " accent" : ""}"><div class="v">${esc(v)}</div>` +
    `<div class="l">${esc(label)}</div></div>`
  );
}

/** Centered tapering funnel: each stage is a centered bar, width ∝ the top. */
function renderFunnel(mount: HTMLElement | null, stages: FunnelStage[]): void {
  if (!mount) return;
  const top = stages[0]?.value || 0;
  mount.innerHTML = stages
    .map((s, i) => {
      const pctOfTop = top ? Math.round((s.value / top) * 100) : 0;
      const width = top ? Math.max((s.value / top) * 100, s.value > 0 ? 8 : 3) : 3;
      const conv =
        i === stages.length - 1
          ? ""
          : `<div class="funnel-conv">↓ ${
              s.value ? Math.round((stages[i + 1].value / s.value) * 100) : 0
            }% continue</div>`;
      return (
        `<div class="funnel-stage">` +
        `<div class="funnel-cap"><span class="funnel-label">${esc(s.label)}</span>` +
        `<span class="funnel-meta">${esc(s.value)} · ${pctOfTop}%</span></div>` +
        `<div class="funnel-barwrap"><div class="funnel-bar" style="width:${width}%">${esc(s.value)}</div></div>` +
        conv +
        `</div>`
      );
    })
    .join("");
}

function renderOverview(o: AdminOverview): void {
  renderFunnel(byId("rest-funnel"), o.restaurant_funnel);
  renderFunnel(byId("crea-funnel"), o.creator_funnel);

  // Payments — all figures are MONTHLY; the spending limit already includes the
  // €50/mo platform fee, so we label incl./excl. explicitly. Only "verified"
  // restaurants (owner email confirmed) are payment-capable.
  const p = o.payments;
  const feeLabel = "€" + Number(p.platform_fee).toFixed(2); // exact, e.g. €49.99
  byId("payment-stats")!.innerHTML = [
    statCard(fmtEur(p.all_restaurants_limit_incl_fee), "Monthly limit · all restaurants (incl. platform fee)", true),
    statCard(`${p.verified_restaurants} / ${o.stats.restaurants_total}`, "Payment-capable restaurants (active + verified)"),
    statCard(fmtEur(p.total_limit_incl_fee), "Monthly limit · payment-capable (incl. fee)"),
    statCard(fmtEur(p.est_monthly_fees), `Est. monthly platform fees (${p.verified_restaurants} × ${feeLabel})`),
  ].join("");
  const note = byId("payment-note");
  if (note) {
    note.innerHTML =
      `“Payment-capable” = the restaurant is active (live) and its owner's email is confirmed. ` +
      `Figures are monthly; the spending limit includes the ${esc(feeLabel)}/mo platform fee ` +
      `(ad-view budget excl. fee: <b>${esc(fmtEur(p.total_limit_excl_fee))}</b>).`;
  }

  const s = o.stats;
  byId("glance-stats")!.innerHTML = [
    statCard(s.restaurants_total, "Restaurants"),
    statCard(o.creator_funnel[0]?.value ?? 0, "Creators"),
    statCard(s.multi_restaurant_owners, "Owners with >1 restaurant"),
    statCard(s.creators_connected, "Creators with a connected social account"),
    statCard(s.signups_7d, "New accounts · last 7 days"),
    statCard(s.signups_30d, "New accounts · last 30 days"),
  ].join("");

  const pills = byId("status-pills");
  if (pills) {
    const entries = Object.entries(s.by_status);
    pills.innerHTML = entries.length
      ? entries.map(([k, n]) => `<span class="pill ${esc(k)}">${esc(n)} ${esc(k)}</span>`).join("")
      : `<span class="muted">—</span>`;
  }
}

function renderRestaurants(rs: AdminRestaurant[], as: AdminAccount[]): void {
  byId("rest-count")!.textContent = `· ${rs.length}`;
  renderTable(
    byId("rest-table"),
    ["ID", "Name", "Status", "Owner", "Owner verified", "Members", "Monthly limit", "Created"],
    rs.map((x) => [
      esc(x.id), esc(x.name || "—"), statusPill(x.status), esc(x.owner_emails || "—"),
      boolPill(x.owner_verified), esc(x.member_count), fmtEur(x.spending_limit_eur),
      esc(fmtDate(x.created_at)),
    ]),
  );

  byId("acct-count")!.textContent = `· ${as.length}`;
  renderTable(
    byId("acct-table"),
    ["ID", "Email", "Name", "Verified", "Restaurants created", "Registered"],
    as.map((x) => [
      esc(x.id), esc(x.email), esc(x.display_name || "—"), boolPill(x.email_verified),
      x.restaurants
        ? esc(x.restaurants)
        : x.restaurant_count
          ? `<span class="muted">${x.restaurant_count} (unnamed)</span>`
          : `<span class="muted">—</span>`,
      esc(fmtDate(x.created_at)),
    ]),
  );
}

function renderCreators(cs: AdminCreator[]): void {
  byId("crea-count")!.textContent = `· ${cs.length}`;
  renderTable(
    byId("crea-table"),
    ["ID", "Email", "Name", "Status", "Verified", "Registered"],
    cs.map((x) => [
      esc(x.id), esc(x.email), esc(x.display_name || "—"), statusPill(x.status),
      boolPill(x.email_verified), esc(fmtDate(x.created_at)),
    ]),
  );
}

const KEY_LABEL: Record<string, string> = { pk: "primary key", fk: "link", uk: "unique" };

function renderSchema(): void {
  const el = byId("schema-body");
  if (!el) return;
  const colRow = ([name, type, desc, key]: Col) => `
    <tr>
      <td class="col-name">${esc(name)}${key ? `<span class="col-key ${key}">${KEY_LABEL[key]}</span>` : ""}</td>
      <td class="col-type">${esc(type)}</td>
      <td class="col-desc">${esc(desc)}</td>
    </tr>`;
  const card = (tb: Table) => {
    const badge = tb.kind === "view" ? "view" : tb.db;
    return `
    <div class="schema-card">
      <div class="schema-card-head">
        <h3>${esc(tb.name)}</h3>
        <span class="db-badge ${badge}">${badge}</span>
      </div>
      <p class="schema-summary">${esc(tb.summary)}</p>
      <table class="schema-cols"><tbody>${tb.cols.map(colRow).join("")}</tbody></table>
    </div>`;
  };
  const group = (g: Group) => `
    <section class="schema-group">
      <h2 class="schema-group-title">${esc(g.title)}</h2>
      <p class="schema-group-blurb">${esc(g.blurb)}</p>
      <div class="schema-cards">${g.tables.map(card).join("")}</div>
    </section>`;
  el.innerHTML = `
    <p class="schema-intro">${esc(INTRO)}</p>
    <div class="schema-legend">
      <span class="db-badge tt_control">tt_control</span><span>shared brain</span>
      <span class="db-badge tt_app">tt_app</span><span>per-restaurant private data</span>
      <span class="col-key pk">primary key</span><span class="col-key fk">link</span><span class="col-key uk">unique</span>
    </div>
    ${SCHEMA_DOC.map(group).join("")}`;
}

/* ---- outreach CRM -------------------------------------------------------- */

let crmSearchWired = false;

async function loadOutreach(): Promise<void> {
  const legend = byId("crm-legend");
  if (legend) {
    legend.innerHTML = "<span class=\"crm-legend-tag\">Stage gates</span>" +
      STAGES.map((s) =>
        `<span class="crm-legend-item"><b>${esc(s.short)}</b>${s.full ? " " + esc(s.full) : ""}</span>`,
      ).join("");
  }
  wireCrmSearch();
  wireCrmManual();
  await refreshLeads();
}

let crmManualWired = false;

function wireCrmManual(): void {
  if (crmManualWired) return;
  crmManualWired = true;
  const toggle = byId("crm-manual-toggle");
  const panel = byId("crm-manual");
  const nameEl = byId<HTMLInputElement>("crm-manual-name");
  const addrEl = byId<HTMLInputElement>("crm-manual-address");
  const addBtn = byId<HTMLButtonElement>("crm-manual-add");
  toggle?.addEventListener("click", () => {
    if (panel) panel.hidden = !panel.hidden;
    if (panel && !panel.hidden) nameEl?.focus();
  });
  const submit = async () => {
    const name = nameEl?.value.trim() ?? "";
    if (!name || !addBtn) return;
    addBtn.disabled = true;
    try {
      await createLead(null, name, addrEl?.value.trim() || null);
      if (nameEl) nameEl.value = "";
      if (addrEl) addrEl.value = "";
      if (panel) panel.hidden = true;
      await refreshLeads();
    } finally {
      addBtn.disabled = false;
    }
  };
  addBtn?.addEventListener("click", () => void submit());
  addrEl?.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") void submit();
  });
}

async function refreshLeads(): Promise<void> {
  try {
    const { leads } = await listLeads();
    renderLeads(leads);
  } catch {
    const mount = byId("crm-table");
    if (mount) mount.innerHTML = `<p class="muted" style="padding:14px">Couldn't load leads.</p>`;
  }
}

const fmtDay = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

/** Actual progression: the earliest date each gate was reached, in gate order. */
function progression(events: OutreachLead["events"]): string {
  const firstByStage = new Map<string, string>();
  for (const e of events) if (!firstByStage.has(e.stage)) firstByStage.set(e.stage, e.changed_at);
  const parts = STAGES.filter((s) => firstByStage.has(s.code)).map((s) =>
    `<span class="crm-prog"><b>${esc(s.short)}</b> ${esc(fmtDay(firstByStage.get(s.code)!))}</span>`);
  return parts.length ? parts.join("") : `<span class="muted">—</span>`;
}

function renderLeads(leads: OutreachLead[]): void {
  const count = byId("crm-count");
  if (count) count.textContent = leads.length ? String(leads.length) : "";
  const mount = byId("crm-table");
  if (!mount) return;
  if (!leads.length) {
    mount.innerHTML = `<p class="muted" style="padding:14px">No leads yet — search a restaurant above to add your first.</p>`;
    return;
  }
  const dateCell = (l: OutreachLead, field: "outreach_date" | "planned_l3") =>
    `<input type="date" class="crm-cell" data-id="${l.id}" data-field="${field}" value="${esc(l[field] ?? "")}" />`;
  const stageCell = (l: OutreachLead) => `<div class="crm-stage-cell">
      <select class="crm-stage-sel" data-id="${l.id}">${
        STAGES.map((s) => `<option value="${s.code}"${l.stage === s.code ? " selected" : ""}>${esc(stageLabel(s))}</option>`).join("")
      }</select>
      <button type="button" class="crm-stage-btn" data-id="${l.id}">Update stage</button>
    </div>`;
  const statusCell = (l: OutreachLead) => {
    const cancelled = l.status === "cancelled";
    const options = [`<option value="active"${cancelled ? "" : " selected"}>Active</option>`]
      .concat(REASONS.map((r) =>
        `<option value="${r.code}"${cancelled && l.cancel_reason === r.code ? " selected" : ""}>Cancelled — ${esc(r.label)}</option>`));
    return `<select class="crm-status-sel" data-id="${l.id}">${options.join("")}</select>`;
  };
  const rows = leads.map((l) => `<tr class="${l.status === "cancelled" ? "crm-cancelled" : ""}">
      <td class="crm-name">${esc(l.name)}</td>
      <td class="crm-addr">${esc(l.address ?? "—")}</td>
      <td class="crm-status-cell">${statusCell(l)}</td>
      <td>${dateCell(l, "outreach_date")}</td>
      <td>${stageCell(l)}</td>
      <td>${dateCell(l, "planned_l3")}</td>
      <td class="crm-prog-cell">${progression(l.events)}</td>
      <td><button type="button" class="crm-del" data-id="${l.id}" title="Delete lead" aria-label="Delete lead">✕</button></td>
    </tr>`).join("");
  mount.innerHTML = `<table class="admin crm-table"><thead><tr>
      <th>Restaurant</th><th>Address</th><th>Status</th><th>Outreach</th><th>Stage</th>
      <th>Planned L3</th><th>Progression</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table>`;

  mount.querySelectorAll<HTMLInputElement>(".crm-cell").forEach((el) =>
    el.addEventListener("change", async () => {
      const id = Number(el.dataset.id);
      const field = el.dataset.field as string;
      el.classList.remove("crm-saved", "crm-error");
      try {
        await updateLead(id, { [field]: el.value });
        el.classList.add("crm-saved");
        window.setTimeout(() => el.classList.remove("crm-saved"), 800);
      } catch {
        el.classList.add("crm-error");
      }
    }));
  mount.querySelectorAll<HTMLButtonElement>(".crm-stage-btn").forEach((b) =>
    b.addEventListener("click", async () => {
      const id = Number(b.dataset.id);
      const sel = b.parentElement?.querySelector<HTMLSelectElement>("select.crm-stage-sel");
      if (!sel) return;
      b.disabled = true;
      try {
        await setLeadStage(id, sel.value);
        await refreshLeads(); // reflects the new progression entry
      } catch {
        b.disabled = false;
      }
    }));
  mount.querySelectorAll<HTMLSelectElement>(".crm-status-sel").forEach((sel) =>
    sel.addEventListener("change", async () => {
      const id = Number(sel.dataset.id);
      const tr = sel.closest("tr");
      const cancelled = sel.value !== "active"; // any reason code ⇒ cancelled
      try {
        await updateLead(id, cancelled
          ? { status: "cancelled", cancel_reason: sel.value }
          : { status: "active", cancel_reason: "" });
        tr?.classList.toggle("crm-cancelled", cancelled);
      } catch { /* ignore */ }
    }));
  mount.querySelectorAll<HTMLElement>(".crm-del").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!window.confirm("Delete this lead?")) return;
      try {
        await deleteLead(Number(b.dataset.id));
        await refreshLeads();
      } catch { /* leave the row */ }
    }));
}

function wireCrmSearch(): void {
  if (crmSearchWired) return;
  crmSearchWired = true;
  const input = byId<HTMLInputElement>("crm-search");
  const button = byId<HTMLButtonElement>("crm-search-btn");
  const results = byId("crm-results");
  if (!input || !button || !results) return;

  const showResults = (html: string) => { results.innerHTML = html; results.hidden = false; };

  // Google Places is a paid API — only call it when the button (or Enter) is
  // pressed, never on every keystroke.
  const runSearch = async () => {
    const q = input.value.trim();
    if (q.length < 2) { showResults(`<div class="crm-result-empty">Type at least 2 characters.</div>`); return; }
    button.disabled = true;
    showResults(`<div class="crm-result-empty">Searching…</div>`);
    let places: PlaceSuggestion[];
    try {
      places = (await crmSearchPlaces(q)).results;
    } catch {
      showResults(`<div class="crm-result-empty">Search failed — check GOOGLE_MAPS_API_KEY.</div>`);
      return;
    } finally {
      button.disabled = false;
    }
    if (!places.length) { showResults(`<div class="crm-result-empty">No matches.</div>`); return; }
    showResults(places.map((p) =>
      `<button type="button" class="crm-result" data-place="${esc(p.placeId)}">
        <span class="crm-result-name">${esc(p.name)}</span>
        <span class="crm-result-addr">${esc(p.address)}</span></button>`).join(""));
    results.querySelectorAll<HTMLElement>(".crm-result").forEach((el) =>
      el.addEventListener("click", async () => {
        const p = places.find((x) => x.placeId === el.dataset.place);
        if (!p) return;
        results.hidden = true; results.innerHTML = ""; input.value = "";
        try {
          await createLead(p.placeId, p.name, p.address);
          await refreshLeads();
        } catch { /* ignore */ }
      }));
  };

  button.addEventListener("click", () => void runSearch());
  input.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") { e.preventDefault(); void runSearch(); }
  });
  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest(".crm-search-box")) results.hidden = true;
  });
}

function setView(view: View): void {
  (["overview", "restaurants", "creators", "outreach", "schema"] as View[]).forEach((v) => {
    const sec = byId(`view-${v}`);
    if (sec) sec.hidden = v !== view;
  });
  document.querySelectorAll<HTMLElement>(".nav-item").forEach((b) => {
    b.classList.toggle("on", b.dataset.view === view);
  });
  if (window.location.hash !== `#${view}`) {
    window.history.replaceState(null, "", `#${view}`);
  }
}

async function loadDashboard(): Promise<void> {
  const [overview, restaurants, accounts, creators] = await Promise.all([
    getAdminOverview(), getAdminRestaurants(), getAdminAccounts(), getAdminCreators(),
  ]);
  renderOverview(overview);
  renderRestaurants(restaurants.restaurants, accounts.accounts);
  renderCreators(creators.creators);
  renderSchema();
  void loadOutreach();

  byId("admin-login")!.hidden = true;
  byId("admin-app")!.hidden = false;
  const hash = window.location.hash.replace("#", "") as View;
  setView(["overview", "restaurants", "creators", "outreach", "schema"].includes(hash) ? hash : "overview");
}

function showLogin(message?: string): void {
  byId("admin-app")!.hidden = true;
  byId("admin-login")!.hidden = false;
  const err = byId("admin-login-error");
  if (err) {
    err.hidden = !message;
    if (message) err.textContent = message;
  }
  byId<HTMLInputElement>("a-key")?.focus();
}

async function unlock(key: string): Promise<void> {
  if (!key) return;
  setAdminKey(key);
  try {
    await loadDashboard();
  } catch (err) {
    setAdminKey(null);
    const status = (err as { status?: number }).status;
    showLogin(status === 403 ? "That key is not valid." : "Couldn't load the control tower.");
  }
}

function wire(): void {
  const keyInput = byId<HTMLInputElement>("a-key");
  byId("admin-login-btn")?.addEventListener("click", () => void unlock(keyInput!.value.trim()));
  keyInput?.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") void unlock(keyInput.value.trim());
  });

  document.querySelectorAll<HTMLElement>(".nav-item").forEach((b) => {
    b.addEventListener("click", () => setView(b.dataset.view as View));
  });

  byId("admin-logout")?.addEventListener("click", () => {
    setAdminKey(null);
    showLogin();
  });

  if (getAdminKey()) void loadDashboard().catch(() => showLogin());
  else showLogin();
}

/** Render the control tower into the page and wire it up (called by the router). */
export function initAdmin(): void {
  document.title = "Control tower — Trending Table";
  document.body.className = "theme-risograph admin-page";
  document.body.innerHTML = MARKUP;
  wire();
}
