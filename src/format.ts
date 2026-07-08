/**
 * Shared value formatters. One euro formatter for the whole app so the customer
 * app, the control tower and onboarding never drift apart on how money looks.
 * Backend numerics arrive as strings like "500.00".
 */
import { getLang } from "./i18n.ts";

const localeFor = () => (getLang() === "de" ? "de-DE" : "en-US");

export interface EurOptions {
  /** Max fraction digits (default 2). Pass 0 for whole euros. */
  decimals?: number;
  /** "€1,234" vs "1.234 €" (default "suffix", the German convention). */
  position?: "prefix" | "suffix";
  /** Override the locale; defaults to the active UI language. */
  locale?: string;
}

/** Format a euro amount, or "—" for empty/invalid input. */
export function fmtEur(v: string | number | null | undefined, opts: EurOptions = {}): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (!Number.isFinite(n)) return "—";
  const { decimals = 2, position = "suffix", locale = localeFor() } = opts;
  const num = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(n);
  return position === "prefix" ? `€${num}` : `${num} €`;
}
