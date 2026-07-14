/**
 * Shared rendering for the bookable-services pages (creator + locale/account).
 * Both sides render identical cards from Stripe products; only the sectioning
 * and data source differ, so the card + helpers live here.
 */
import type { CreatorService } from "./api.ts";
import { getLang, t } from "./i18n.ts";

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

/** "€12,99 / Monat" | "5,99 € einmalig" | "Kostenlos", localized. */
export function svcPriceLabel(amountCents: number | null, interval: string | null): string {
  const amount = (amountCents ?? 0) / 100;
  if (amount === 0) return t("creator.services.free");
  const price = new Intl.NumberFormat(getLang() === "de" ? "de-DE" : "en-GB",
    { style: "currency", currency: "EUR" }).format(amount);
  return interval === "month" ? `${price} ${t("creator.services.perMonth")}`
    : `${price} ${t("creator.services.oneTime")}`;
}

/** Human-readable perks pulled from a service's Stripe metadata. */
export function svcFeatures(meta: Record<string, string>): string[] {
  const feats: string[] = [];
  if (meta.max_coops) {
    if (meta.max_coops === "unlimited") feats.push(t("creator.services.coopsUnlimited"));
    else if (meta.max_coops === "1") feats.push(t("creator.services.coopsOne", { n: "1" }));
    else feats.push(t("creator.services.coops", { n: meta.max_coops }));
  }
  if (meta.includes_boost === "true") feats.push(t("creator.services.inclBoost"));
  if (meta.boost_days) feats.push(t("creator.services.boostDays", { n: meta.boost_days }));
  if (meta.block_months) feats.push(t("creator.services.blockMonths", { n: meta.block_months }));
  if (meta.duration_months) feats.push(t("creator.services.usageMonths", { n: meta.duration_months }));
  return feats;
}

export interface ServiceCardOpts {
  stripeEnabled: boolean;
  current?: boolean;       // the account's/creator's active plan → badge, no button
  booked?: boolean;        // already booked (one-time add-on) → disabled "Booked"
  recommended?: boolean;   // show the "Empfohlen" banner
  displayName?: string;    // override the Stripe product name for display
  features?: string[];     // override the metadata-derived feature bullets
}

/** One service card — identical markup for both sides (styled via .svc-*). */
export function serviceCard(s: CreatorService, opts: ServiceCardOpts): string {
  const name = opts.displayName ?? s.name;
  const feats = opts.features ?? svcFeatures(s.metadata);
  let action: string;
  if (opts.current) {
    action = `<span class="svc-current-badge">${esc(t("creator.services.currentBadge"))}</span>`;
  } else if (opts.booked) {
    action = `<button type="button" class="btn btn-ghost svc-book" disabled>${esc(t("creator.services.booked"))}</button>`;
  } else {
    action = `<button type="button" class="btn btn-ink svc-book" data-price="${esc(s.price_id)}"${opts.stripeEnabled ? "" : " disabled"}>${esc(t("creator.services.book"))}</button>`;
  }
  return `
    <div class="svc-card${opts.current ? " current" : ""}${opts.recommended ? " recommended" : ""}">
      ${opts.recommended ? `<div class="svc-rec">${esc(t("creator.services.recommended"))}</div>` : ""}
      <h3 class="svc-card-name">${esc(name)}</h3>
      <div class="svc-price">${esc(svcPriceLabel(s.amount, s.interval))}</div>
      ${feats.length ? `<ul class="svc-feats">${feats.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
      ${action}
    </div>`;
}

/** Wire every ".svc-book" button in `container` to start a Checkout redirect. */
export function wireServiceCheckout(
  container: HTMLElement, start: (priceId: string) => Promise<{ url: string }>,
): void {
  container.querySelectorAll<HTMLButtonElement>(".svc-book").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const price = btn.dataset.price;
      if (!price) return;
      btn.disabled = true;
      btn.textContent = t("creator.services.redirecting");
      try {
        const { url } = await start(price);
        window.location.assign(url);   // hand off to Stripe Checkout
      } catch (e) {
        btn.disabled = false;
        btn.textContent = t("creator.services.book");
        alert((e as Error).message || t("creator.error"));
      }
    }));
}
