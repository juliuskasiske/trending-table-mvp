import { defineConfig, type PluginOption } from "vite";
import "dotenv/config";
import { createApiApp } from "./server/api.mjs";

// Mounts the Express API router onto Vite's dev server so `npm run dev` serves
// both the app and /api from one process — no separate backend to start.
function apiMiddleware(): PluginOption {
  return {
    name: "trending-table-api",
    configureServer(server) {
      server.middlewares.use("/api", createApiApp());
    },
  };
}

// Trending Table MVP — the restaurant onboarding flow. Vite serves it in dev
// and bundles a static build into dist/ for deployment (served by server/index.mjs).
export default defineConfig({
  root: ".",
  plugins: [apiMiddleware()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
});
