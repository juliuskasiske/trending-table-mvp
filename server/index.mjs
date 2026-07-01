/**
 * Production server: serves the built frontend (dist/) and the API under /api.
 * In development you don't run this — Vite serves the app and mounts the same
 * API router itself (see vite.config.ts). Run with: `npm run build && npm start`.
 */
import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createApiRouter } from "./api.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = join(__dirname, "..", "dist");
const port = process.env.PORT || 3000;

const app = express();
app.use("/api", createApiRouter());
app.use(express.static(dist));
// SPA fallback for any non-API route (Express 5 rejects a bare "*" path,
// so use a terminal middleware instead).
app.use((_req, res) => res.sendFile(join(dist, "index.html")));

app.listen(port, () => {
  console.log(`Trending Table MVP running on http://localhost:${port}`);
});
