/**
 * Trending Table MVP — restaurant onboarding entry point.
 * Loads styles and boots the multi-step onboarding controller once the DOM is
 * ready.
 */
import "./styles/theme.css";
import "./styles/onboarding.css";
import { initOnboarding } from "./onboarding.ts";

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initOnboarding, { once: true });
} else {
  initOnboarding();
}
