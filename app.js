// app.js
// ------------------------------------------------------------------
// The actual Express app, with no app.listen() call — this file is
// shared between two entry points:
//   - server.js   → runs it as a normal always-on Node process
//                    (local dev, Render, Railway, a VPS...)
//   - api/index.js → wraps it as a single Vercel serverless function
// ------------------------------------------------------------------
import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import authRoutes from "./routes/auth.js";
import planRoutes from "./routes/plans.js";
import checkoutRoutes from "./routes/checkout.js";
import webhookRoutes from "./routes/webhook.js";
import serverRoutes from "./routes/servers.js";
import adminRoutes from "./routes/admin.js";
import { rateLimit } from "./services/rateLimit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const app = express();

// If you're behind Nginx/Cloudflare/Vercel/a load balancer, this makes
// req.ip (used by the rate limiter) reflect the real client IP instead
// of the proxy's IP. Safe to leave on regardless.
app.set("trust proxy", 1);

// Only your own dashboard domain is allowed to call the API — stops
// other sites from making authenticated requests using a logged-in
// user's browser (CSRF-style abuse) or scraping your endpoints.
app.use(cors({ origin: process.env.DASHBOARD_URL || "http://localhost:4000" }));
app.use(express.json());

// A few basic security headers (a lightweight stand-in for `helmet`,
// with no extra dependency to install).
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer-when-downgrade");
  next();
});

// General safety net on top of the stricter per-endpoint limits inside
// routes/auth.js — no single IP can hammer any /api/auth/* route.
// NOTE: on Vercel, every serverless invocation may land on a different
// underlying instance, so this in-memory limiter only really bites
// within one warm instance. The per-account lockouts in routes/auth.js
// (which live in the database, not memory) are what actually matters
// there — this is just an extra layer.
app.use("/api/auth", rateLimit({ windowMs: 60 * 1000, max: 30 }));

app.use("/api/auth", authRoutes);
app.use("/api/plans", planRoutes);
app.use("/api/checkout", checkoutRoutes);
app.use("/api/webhook", webhookRoutes);
app.use("/api/servers", serverRoutes);
app.use("/api/admin", adminRoutes);

app.use(express.static(path.join(__dirname, "public")));

// Vercel's serverless bundler doesn't always pick up every file inside a
// directory just from a generic express.static() call — it reliably
// bundles a file only when the exact path is referenced directly in
// code like this. index.html works via express.static's automatic
// directory-index behavior, but these two need an explicit route.
app.get("/dashboard.html", (req, res) => res.sendFile(path.join(__dirname, "public", "dashboard.html")));
app.get("/admin.html", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/api/config", (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || "" });
});

export default app;
