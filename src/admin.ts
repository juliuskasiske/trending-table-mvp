/**
 * Control tower — owner-only dashboard over the control database.
 *
 * In-app route (`/admin`), lazy-loaded by the SPA. Layout: a left nav toggling
 * Overview / Restaurants / Creators. Access is a single ADMIN_KEY (X-Admin-Key).
 */
import "./styles/theme.css";
import "./styles/onboarding.css"; // shared shell/topbar/card/input/button styles
import "./styles/admin.css";
import {
  getAdminAccounts,
  getAdminCreators,
  getAdminKey,
  getAdminOverview,
  getAdminRestaurants,
  setAdminKey,
  type AdminAccount,
  type AdminCreator,
  type AdminOverview,
  type AdminRestaurant,
  type FunnelStage,
} from "./api.ts";

type View = "overview" | "restaurants" | "creators";

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

      <h2 class="section-head">Payments</h2>
      <div class="stat-grid" id="payment-stats"></div>

      <h2 class="section-head">At a glance</h2>
      <div class="stat-grid" id="glance-stats"></div>
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

/** Horizontal funnel: each stage's bar width is relative to the first stage. */
function renderFunnel(mount: HTMLElement | null, stages: FunnelStage[]): void {
  if (!mount) return;
  const top = stages[0]?.value || 0;
  mount.innerHTML = stages
    .map((s, i) => {
      const pctOfTop = top ? Math.round((s.value / top) * 100) : 0;
      const width = top ? Math.max((s.value / top) * 100, s.value > 0 ? 6 : 0) : 0;
      const drop =
        i === 0 || !stages[i - 1].value
          ? ""
          : `<span class="funnel-drop">${Math.round((s.value / stages[i - 1].value) * 100)}% of prev</span>`;
      return (
        `<div class="funnel-stage">` +
        `<div class="funnel-top"><span class="funnel-label">${esc(s.label)}</span>` +
        `<span class="funnel-meta">${esc(s.value)} · ${pctOfTop}%${drop ? " · " + drop : ""}</span></div>` +
        `<div class="funnel-track"><div class="funnel-bar" style="width:${width}%"></div></div>` +
        `</div>`
      );
    })
    .join("");
}

function renderOverview(o: AdminOverview): void {
  renderFunnel(byId("rest-funnel"), o.restaurant_funnel);
  renderFunnel(byId("crea-funnel"), o.creator_funnel);

  const p = o.payments;
  byId("payment-stats")!.innerHTML = [
    statCard(fmtEur(p.total_spending_limit), "Total spending limit (all restaurants)", true),
    statCard(fmtEur(p.active_spending_limit), "Spending limit (active only)"),
    statCard(fmtEur(p.avg_spending_limit), "Avg limit per restaurant"),
    statCard(fmtEur(p.est_monthly_fees), "Est. monthly platform fees"),
  ].join("");

  const s = o.stats;
  const byStatus = Object.entries(s.by_status).map(([k, n]) => `${n} ${k}`).join(" · ") || "—";
  byId("glance-stats")!.innerHTML = [
    statCard(s.restaurants_total, "Restaurants"),
    statCard(s.restaurants_active, "Active restaurants"),
    statCard(s.multi_restaurant_owners, "Multi-restaurant owners"),
    statCard(s.creators_connected, "Creators w/ connected social"),
    statCard(s.signups_7d, "New accounts · 7d"),
    statCard(s.signups_30d, "New accounts · 30d"),
    statCard(byStatus, "Restaurants by status"),
  ].join("");
}

function renderRestaurants(rs: AdminRestaurant[], as: AdminAccount[]): void {
  byId("rest-count")!.textContent = `· ${rs.length}`;
  renderTable(
    byId("rest-table"),
    ["ID", "Name", "Status", "Owner", "Members", "Monthly limit", "Created"],
    rs.map((x) => [
      esc(x.id), esc(x.name || "—"), statusPill(x.status), esc(x.owner_emails || "—"),
      esc(x.member_count), fmtEur(x.spending_limit_eur), esc(fmtDate(x.created_at)),
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

function setView(view: View): void {
  (["overview", "restaurants", "creators"] as View[]).forEach((v) => {
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

  byId("admin-login")!.hidden = true;
  byId("admin-app")!.hidden = false;
  const hash = window.location.hash.replace("#", "") as View;
  setView(["overview", "restaurants", "creators"].includes(hash) ? hash : "overview");
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
