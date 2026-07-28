// server.js
// Entry point for running Nodrix as a normal, always-on Node process
// (local development, Render, Railway, a VPS...). NOT used on Vercel —
// see api/index.js for the serverless entry point there.
import { app } from "./app.js";
import { startExpiryScheduler } from "./services/expiry.js";

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Nodrix server running on http://localhost:${PORT}`);
  // Only meaningful on an always-on process — a setInterval like this
  // does nothing useful in a serverless environment, since the process
  // doesn't stay alive between requests. On Vercel, api/cron/expiry.js
  // does the equivalent job instead, triggered by an external cron.
  startExpiryScheduler();
});
