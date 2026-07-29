// services/provision.js
import { nanoid } from "nanoid";
import { db } from "../db.js";
import { launchServer, pollUntilReady, startServer, getPublicIp } from "./aws.js";
import { notifyServerReady } from "./notify.js";

/**
 * Manual path: the admin already has a Windows RDP box ready (bought
 * elsewhere, set up by hand, whatever) and just wants to hand it to a
 * customer. No AWS call at all — the server record is created already
 * "ready" with whatever IP/username/password the admin typed in.
 */
export async function provisionManual(order, { publicIp, username, password }) {
  const plan = await db.find("plans", (p) => p.id === order.planId);
  if (!plan) throw new Error(`Unknown plan for order ${order.id}`);

  const server = await db.insert("servers", {
    id: nanoid(),
    orderId: order.id,
    userId: order.userId,
    planId: plan.id,
    status: "ready",
    instanceId: null, // no AWS instance behind this one
    publicIp,
    username,
    password,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const user = await db.find("users", (u) => u.id === order.userId);
  if (user) await notifyServerReady(user, server, plan);

  return server;
}

/**
 * Called once a payment is confirmed (from the Paymob webhook).
 * Launches the AWS instance in the background so the webhook response
 * to Paymob isn't held up by a multi-minute Windows boot.
 */
export async function provisionForOrder(order) {
  const plan = await db.find("plans", (p) => p.id === order.planId);
  if (!plan) throw new Error(`Unknown plan for order ${order.id}`);

  const server = await db.insert("servers", {
    id: nanoid(),
    orderId: order.id,
    userId: order.userId,
    planId: plan.id,
    status: "provisioning", // provisioning -> ready -> expired -> terminated
    instanceId: null,
    publicIp: null,
    username: null,
    password: null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });

  // Fire-and-forget: don't block the webhook response on this.
  runProvisioning(server, plan).catch(async (err) => {
    console.error(`Provisioning failed for server ${server.id}:`, err.message);
    await db.update("servers", (s) => s.id === server.id, { status: "failed" });
  });

  return server;
}

async function runProvisioning(server, plan) {
  const { instanceId } = await launchServer({ plan, orderId: server.orderId });
  await db.update("servers", (s) => s.id === server.id, { instanceId });

  const { publicIp, username, password } = await pollUntilReady(instanceId);

  const updated = await db.update("servers", (s) => s.id === server.id, {
    status: "ready",
    publicIp,
    username,
    password,
  });

  const user = await db.find("users", (u) => u.id === server.userId);
  if (user) await notifyServerReady(user, updated, plan);
}

/**
 * Called when a customer pays to renew an existing server (order carries
 * a renewServerId instead of provisioning a brand new one).
 *  - If the subscription hadn't lapsed yet, this simply pushes expiresAt
 *    another 30 days out — nothing on AWS changes.
 *  - If the server was "suspended" (stopped after the grace-period check
 *    in services/expiry.js), this restarts the instance too. Restarting
 *    a stopped EC2 instance usually assigns a NEW public IP unless an
 *    Elastic IP is attached, so we re-fetch and store it.
 */
export async function renewServer(server) {
  // Extend from the later of "now" or the current expiry, so renewing
  // early doesn't waste days the customer already paid for.
  const base = Math.max(Date.now(), new Date(server.expiresAt).getTime());
  const newExpiresAt = new Date(base + 30 * 24 * 60 * 60 * 1000).toISOString();

  if (server.status === "suspended" && server.instanceId) {
    await startServer(server.instanceId);
    // Give AWS a moment to assign networking before we ask for the IP.
    await new Promise((r) => setTimeout(r, 15_000));
    const publicIp = await getPublicIp(server.instanceId);

    await db.update("servers", (s) => s.id === server.id, {
      status: "ready",
      expiresAt: newExpiresAt,
      suspendedAt: null,
      publicIp: publicIp || server.publicIp,
    });
  } else {
    await db.update("servers", (s) => s.id === server.id, { expiresAt: newExpiresAt });
  }
}
