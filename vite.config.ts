import { defineConfig } from "vite";

// Trending Table SPA. The API is the FastAPI backend (mvp/backend) — in dev,
// Vite proxies /api to it so the browser sees one origin (cookies just work).
// Start the backend with: cd backend && ./.venv/bin/uvicorn src.api.app:app --port 8000
export default defineConfig({
  root: ".",
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
});
