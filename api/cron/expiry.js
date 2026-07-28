// api/cron/expiry.js
// ------------------------------------------------------------------
// Serverless equivalent of the setInterval loop in services/expiry.js.
// Vercel's own Cron (vercel.json) can only call this once a day on the
// free Hobby plan, which is too slow for stopping/deleting expired
// servers on time — so in practice you point a free external
// scheduler (e.g. cron-job.org) at this URL every 5–10 minutes
// instead. Vercel Cron stays in vercel.json as a once-a-day safety
// net in case the external scheduler ever stops firing.
//
// Protected by CRON_SECRET so random visitors can't trigger it:
//   https://yourdomain.vercel.app/api/cron/expiry?secret=xxxx
// (Vercel's own cron calls also authenticate automatically via the
// Authorization header, which is checked first.)
// ------------------------------------------------------------------
import "dotenv/config";
import { checkExpirations } from "../../services/expiry.js";

export default async function handler(req, res) {
  const authHeader = req.headers.authorization || "";
  const bearerOk = process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const queryOk = process.env.CRON_SECRET && req.query.secret === process.env.CRON_SECRET;

  if (!bearerOk && !queryOk) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    await checkExpirations();
    res.status(200).json({ ok: true, checkedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[cron/expiry] failed:", err.message);
    res.status(500).json({ error: "expiry check failed" });
  }
}
