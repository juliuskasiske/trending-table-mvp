/**
 * Shared "confirm your email" barrier. After signup a user cannot continue into
 * the app until their email is verified. This renders the gate, polls the
 * server for the verified flag (so clicking the link in another tab advances
 * the flow automatically), and offers a manual re-check + resend.
 *
 * The backend enforces the same barrier (require_verified_* deps), so this is
 * the friendly front door, not the lock itself.
 */
import { t } from "./i18n.ts";
import { getMe, resendVerification } from "./api.ts";

export interface VerifyOpts {
  email: string;
  onVerified: () => void;
}

let pollTimer: number | undefined;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export function stopVerifyPoll(): void {
  if (pollTimer !== undefined) { window.clearInterval(pollTimer); pollTimer = undefined; }
}

const mailIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';

/** Fill an existing element with the verify card and wire it up. */
export function renderVerifyInto(el: HTMLElement, opts: VerifyOpts): void {
  stopVerifyPoll();
  // Apply the verify-card styling to whatever container we fill (the creator
  // card or the full-page wrapper) so the scoped rules take effect in both.
  el.classList.add("verify-card");
  el.innerHTML = `
    <div class="verify-icon" aria-hidden="true">${mailIcon}</div>
    <p class="step-eyebrow verify-eyebrow">${esc(t("verify.gate.eyebrow"))}</p>
    <h1 class="step-title verify-title">${esc(t("verify.gate.title"))}</h1>
    <p class="step-sub verify-sub">${t("verify.gate.sub", { email: `<b>${esc(opts.email)}</b>` })}</p>
    <p class="verify-status" id="verify-status" hidden></p>
    <button type="button" class="btn btn-primary verify-continue" id="verify-continue">${esc(t("verify.gate.continue"))}</button>
    <button type="button" class="btn btn-ghost verify-resend" id="verify-resend">${esc(t("verify.gate.resend"))}</button>
    <p class="verify-hint">${esc(t("verify.gate.hint"))}</p>`;

  const statusEl = el.querySelector<HTMLElement>("#verify-status");
  const setStatus = (msg: string, kind: "ok" | "error" | "muted") => {
    if (!statusEl) return;
    statusEl.hidden = false;
    statusEl.textContent = msg;
    statusEl.className = "verify-status " + kind;
  };

  async function check(manual: boolean): Promise<void> {
    const me = await getMe().catch(() => null);
    if (me && me.email_verified) { stopVerifyPoll(); opts.onVerified(); return; }
    if (manual) setStatus(t("verify.gate.notyet"), "error");
  }

  el.querySelector("#verify-continue")?.addEventListener("click", () => void check(true));
  el.querySelector("#verify-resend")?.addEventListener("click", async () => {
    const btn = el.querySelector<HTMLButtonElement>("#verify-resend");
    if (btn) btn.disabled = true;
    try {
      await resendVerification();
      setStatus(t("verify.gate.resent"), "ok");
    } catch {
      setStatus(t("verify.gate.resendFail"), "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Auto-advance when the link is opened (same session) in another tab.
  pollTimer = window.setInterval(() => void check(false), 3000);
}

/** Take over the whole page with a centered verify card (onboarding / account). */
export function renderVerifyFullpage(opts: VerifyOpts): void {
  document.body.className = "theme-risograph verify-page";
  document.body.innerHTML = `
    <div class="verify-wrap">
      <section class="card verify-card" id="verify-card"></section>
    </div>`;
  renderVerifyInto(document.getElementById("verify-card")!, opts);
}
