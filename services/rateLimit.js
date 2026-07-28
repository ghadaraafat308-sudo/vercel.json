// services/rateLimit.js
// ------------------------------------------------------------------
// Minimal in-memory rate limiter — no extra dependency to install.
// Good enough for a single-process deployment (same assumption the
// SQLite setup already makes). If you later scale to multiple
// processes/servers, swap this for express-rate-limit + a shared
// store (Redis) so limits are counted across all instances.
// ------------------------------------------------------------------
const buckets = new Map();

export function rateLimit({ windowMs = 60_000, max = 20, message = "محاولات كتير، استنى شوية وجرب تاني" } = {}) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.method}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const fresh = (buckets.get(key) || []).filter((t) => now - t < windowMs);
    fresh.push(now);
    buckets.set(key, fresh);

    if (fresh.length > max) {
      return res.status(429).json({ error: message });
    }
    next();
  };
}

// Periodic cleanup so the map doesn't grow forever on a long-running process.
setInterval(() => {
  const now = Date.now();
  for (const [key, times] of buckets) {
    const fresh = times.filter((t) => now - t < 15 * 60_000);
    if (fresh.length === 0) buckets.delete(key);
    else buckets.set(key, fresh);
  }
}, 5 * 60_000).unref();
