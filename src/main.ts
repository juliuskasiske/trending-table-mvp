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
  // Owner control tower is an in-app route, lazy-loaded so it never ships in
  // the customer onboarding path.
  const path = window.location.pathname.replace(/\/+$/, "");
  if (path === "/admin") {
    void import("./admin.ts").then((m) => m.initAdmin());
    return;
  }
  if (path === "/account") {
    // Post-login account management, lazy-loaded like the control tower.
    void import("./account.ts").then((m) => m.initAccount());
    return;
  }
  initI18n(); // translate static markup + wire the EN/DE toggle first
  initOnboarding();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
