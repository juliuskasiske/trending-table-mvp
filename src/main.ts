/**
 * Trending Table MVP — restaurant onboarding entry point.
 * Loads styles and boots the multi-step onboarding controller once the DOM is
 * ready.
 */
import "./styles/theme.css";
import "./styles/onboarding.css";
import { initI18n } from "./i18n.ts";
import { initOnboarding } from "./onboarding.ts";

function boot(): void {
  initI18n(); // translate static markup + wire the EN/DE toggle first
  initOnboarding();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
