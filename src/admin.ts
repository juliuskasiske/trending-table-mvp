/**
 * Control tower — owner-only dashboard over the control database.
 * Standalone page (admin.html). Auth reuses the normal session (cookie +
 * bearer token); the backend gates every /api/admin/* call by ADMIN_EMAILS.
 */
import "./styles/theme.css";
import "./styles/admin.css";
import {
  getAdminAccounts,
  getAdminCreators,
  getAdminOverview,
  getAdminRestaurants,
  getMe,
  login,
  logout,
  type AdminAccount,
  type AdminCreator,
  type AdminRestaurant,
} from "./api.ts";

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
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function fmtEur(v: number | string | null): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? "€" + new Intl.NumberFormat().format(n) : "—";
}

function statusPill(status: string): string {
  return `<span class="pill ${esc(status)}">${esc(status)}</span>`;
}

function boolPill(v: boolean): string {
  return v ? `<span class="pill yes">verified</span>` : `<span class="pill no">unverified</span>`;
}

/** Build a <table> from a header list and pre-rendered HTML cells. */
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

function renderStats(o: Awaited<ReturnType<typeof getAdminOverview>>): void {
  const grid = byId("admin-stats");
  if (!grid) return;
  const byStatus = Object.entries(o.restaurants.by_status)
    .map(([s, n]) => `${n} ${s}`)
    .join(" · ");
  const cards: Array<{ v: string | number; l: string; accent?: boolean }> = [
    { v: o.restaurants.total, l: "Restaurants", accent: true },
    { v: o.restaurants.active, l: "Active restaurants" },
    { v: o.accounts.total, l: "Accounts" },
    { v: o.accounts.verified, l: "Verified accounts" },
    { v: o.accounts.last_7d, l: "New accounts · 7d" },
    { v: o.accounts.last_30d, l: "New accounts · 30d" },
    { v: o.creators.total, l: "Creators" },
  ];
  grid.innerHTML = cards
    .map(
      (c) =>
        `<div class="stat${c.accent ? " accent" : ""}"><div class="v">${esc(c.v)}</div>` +
        `<div class="l">${esc(c.l)}</div></div>`,
    )
    .join("");
  const note = byId("rest-count");
  if (note && byStatus) note.textContent = `(${byStatus})`;
}

async function loadDashboard(email: string): Promise<void> {
  byId("admin-login")!.hidden = true;
  byId("admin-dash")!.hidden = false;
  byId("admin-logout")!.hidden = false;
  const who = byId("admin-whoami");
  if (who) who.textContent = `Signed in as ${email}`;

  const [overview, restaurants, accounts, creators] = await Promise.all([
    getAdminOverview(),
    getAdminRestaurants(),
    getAdminAccounts(),
    getAdminCreators(),
  ]);

  renderStats(overview);

  const r = restaurants.restaurants;
  byId("rest-count")!.textContent = `· ${r.length}`;
  renderTable(
    byId("rest-table"),
    ["ID", "Name", "Status", "Owner", "Members", "Monthly limit", "Created"],
    r.map((x: AdminRestaurant) => [
      esc(x.id),
      esc(x.name || "—"),
      statusPill(x.status),
      esc(x.owner_emails || "—"),
      esc(x.member_count),
      fmtEur(x.spending_limit_eur),
      esc(fmtDate(x.created_at)),
    ]),
  );

  const a = accounts.accounts;
  byId("acct-count")!.textContent = `· ${a.length}`;
  renderTable(
    byId("acct-table"),
    ["ID", "Email", "Name", "Verified", "Restaurants", "Registered"],
    a.map((x: AdminAccount) => [
      esc(x.id),
      esc(x.email),
      esc(x.display_name || "—"),
      boolPill(x.email_verified),
      esc(x.restaurant_count),
      esc(fmtDate(x.created_at)),
    ]),
  );

  const c = creators.creators;
  byId("crea-count")!.textContent = `· ${c.length}`;
  renderTable(
    byId("crea-table"),
    ["ID", "Email", "Name", "Status", "Verified", "Registered"],
    c.map((x: AdminCreator) => [
      esc(x.id),
      esc(x.email),
      esc(x.display_name || "—"),
      statusPill(x.status),
      boolPill(x.email_verified),
      esc(fmtDate(x.created_at)),
    ]),
  );
}

function showLogin(message?: string): void {
  byId("admin-dash")!.hidden = true;
  byId("admin-logout")!.hidden = true;
  const card = byId("admin-login")!;
  card.hidden = false;
  const err = byId("admin-login-error");
  if (err) {
    err.hidden = !message;
    if (message) err.textContent = message;
  }
}

function wire(): void {
  byId("admin-login-btn")?.addEventListener("click", async () => {
    const email = byId<HTMLInputElement>("a-email")!.value.trim();
    const password = byId<HTMLInputElement>("a-password")!.value;
    try {
      const p = await login(email, password, "account");
      if (!p.is_admin) {
        showLogin("That account doesn't have control-tower access.");
        return;
      }
      await loadDashboard(p.email);
    } catch (err) {
      showLogin((err as Error)?.message || "Sign-in failed.");
    }
  });

  byId("admin-logout")?.addEventListener("click", async () => {
    await logout();
    showLogin();
  });

  void (async () => {
    const me = await getMe();
    if (me?.is_admin) await loadDashboard(me.email).catch(() => showLogin("Couldn't load the dashboard."));
    else showLogin(me ? "That account doesn't have control-tower access." : undefined);
  })();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wire, { once: true });
} else {
  wire();
}
