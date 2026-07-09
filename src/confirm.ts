/** Shared confirmation modal used by both the locale and creator apps. */
import { t } from "./i18n.ts";

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export interface ConfirmOpts {
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button. Defaults to "danger"; use "primary" for non-destructive confirms. */
  variant?: "danger" | "primary";
}

/** Show a modal. If `matchWord` is set, the confirm button stays disabled until
 * the user types it exactly (used for destructive actions like delete). */
export function confirmBox(
  title: string,
  message: string,
  matchWord: string | null,
  onConfirm: () => Promise<void>,
  opts: ConfirmOpts = {},
): void {
  const confirmLabel = opts.confirmLabel ?? t("account.confirm.confirm");
  const cancelLabel = opts.cancelLabel ?? t("account.confirm.cancel");
  const okClass = opts.variant === "primary" ? "btn-primary" : "btn-danger";
  const wrap = document.createElement("div");
  wrap.className = "confirm-wrap";
  wrap.innerHTML = `
    <div class="confirm-box card">
      <h2>${esc(title)}</h2>
      <p>${esc(message)}</p>
      ${matchWord !== null ? `<input class="input" id="confirm-input" autocomplete="off" />` : ""}
      <div class="confirm-actions">
        <button type="button" class="btn btn-ghost" id="confirm-cancel">${esc(cancelLabel)}</button>
        <button type="button" class="btn ${okClass}" id="confirm-ok" ${matchWord !== null ? "disabled" : ""}>${esc(confirmLabel)}</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const okBtn = wrap.querySelector<HTMLButtonElement>("#confirm-ok")!;
  const input = wrap.querySelector<HTMLInputElement>("#confirm-input");
  input?.addEventListener("input", () => {
    okBtn.disabled = input.value.trim() !== matchWord;
  });
  input?.focus();
  const close = () => wrap.remove();
  wrap.querySelector("#confirm-cancel")?.addEventListener("click", close);
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) close();
  });
  okBtn.addEventListener("click", async () => {
    okBtn.disabled = true;
    okBtn.textContent = t("account.confirm.working");
    try {
      await onConfirm();
    } catch (e) {
      okBtn.disabled = false;
      okBtn.textContent = confirmLabel;
      const p = wrap.querySelector("p");
      if (p) p.textContent = (e as Error).message || t("account.error.save");
      return;
    }
    close();
  });
}
