// services/expiry.js
// ------------------------------------------------------------------
// Runs on an interval and enforces subscription expiry:
//   ready       --(2 days before expiry)--> reminder email/SMS sent once
//   ready       --(expiresAt passed)--> suspended  (instance STOPPED)
//   suspended   --(grace period passed)--> terminated (instance DELETED)
//
// Stopping first (instead of terminating immediately) protects the
// customer from instant data loss if they forget to renew -- they get
// a window to pay again before anything is destroyed.
// ------------------------------------------------------------------
import { db } from "../db.js";
import { stopServer, terminateServer } from "./aws.js";
import { notifyServerSuspended, notifyServerTerminated, notifyExpiryReminder } from "./notify.js";

const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000; // 3 days after expiry before permanent deletion
const REMINDER_WINDOW_MS = 2 * 24 * 60 * 60 * 1000; // send a reminder 2 days before expiry
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes

async function getUserAndPlan(server) {
  const user = await db.find("users", (u) => u.id === server.userId);
  const plan = await db.find("plans", (p) => p.id === server.planId);
  return { user, plan };
}

export async function checkExpirations() {
  const now = Date.now();
  const { servers } = await db.read();

  for (const server of servers) {
    const expiresAtMs = new Date(server.expiresAt).getTime();

    // 1. Active server approaching expiry -> send a one-time reminder.
    if (
      server.status === "ready" &&
      !server.reminderSentAt &&
      expiresAtMs - now <= REMINDER_WINDOW_MS &&
      expiresAtMs - now > 0
    ) {
      const { user, plan } = await getUserAndPlan(server);
      if (user && plan) {
        const daysLeft = Math.max(1, Math.ceil((expiresAtMs - now) / (24 * 60 * 60 * 1000)));
        await notifyExpiryReminder(user, server, plan, daysLeft);
      }
      await db.update("servers", (s) => s.id === server.id, { reminderSentAt: new Date().toISOString() });
    }

    // 2. Active server whose subscription just ended -> stop it.
    if (server.status === "ready" && expiresAtMs <= now) {
      try {
        if (server.instanceId) await stopServer(server.instanceId);
        await db.update("servers", (s) => s.id === server.id, {
          status: "suspended",
          suspendedAt: new Date().toISOString(),
        });
        console.log(`Server ${server.id} suspended (subscription expired)`);

        const { user } = await getUserAndPlan(server);
        const graceDays = GRACE_PERIOD_MS / (24 * 60 * 60 * 1000);
        if (user) await notifyServerSuspended(user, server, graceDays);
      } catch (err) {
        console.error(`Failed to suspend server ${server.id}:`, err.message);
      }
      continue;
    }

    // 3. Suspended server past the grace period -> delete permanently.
    if (server.status === "suspended" && server.suspendedAt) {
      const suspendedFor = now - new Date(server.suspendedAt).getTime();
      if (suspendedFor >= GRACE_PERIOD_MS) {
        try {
          if (server.instanceId) await terminateServer(server.instanceId);
          await db.update("servers", (s) => s.id === server.id, { status: "terminated" });
          console.log(`Server ${server.id} terminated (grace period expired)`);

          const { user } = await getUserAndPlan(server);
          if (user) await notifyServerTerminated(user, server);
        } catch (err) {
          console.error(`Failed to terminate server ${server.id}:`, err.message);
        }
      }
    }
  }
}

export function startExpiryScheduler() {
  checkExpirations(); // run once at boot too, not just after the first interval
  setInterval(checkExpirations, CHECK_INTERVAL_MS);
  console.log("Expiry scheduler started (checking every 5 minutes)");
}
