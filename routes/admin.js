// routes/admin.js
import { Router } from "express";
import { nanoid } from "nanoid";
import { db } from "../db.js";
import { requireAdmin } from "../services/auth.js";
import { provisionForOrder, renewServer } from "../services/provision.js";
import { stopServer, startServer, getPublicIp, terminateServer } from "../services/aws.js";
import { rateLimit } from "../services/rateLimit.js";

const router = Router();
router.use(requireAdmin);
router.use(rateLimit({ windowMs: 60 * 1000, max: 60 }));

function publicUser(u) {
  return { id: u.id, email: u.email, phone: u.phone, emailVerified: !!u.emailVerified, createdAt: u.createdAt };
}

// ---------- Users ----------
router.get("/users", async (req, res) => {
  const { users } = await db.read();
  res.json(users.map(publicUser));
});

// ---------- Orders ----------
router.get("/orders", async (req, res) => {
  const { orders, users, plans } = await db.read();
  const byId = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));
  const usersById = byId(users);
  const plansById = byId(plans);

  const enriched = orders
    .map((o) => ({
      ...o,
      userEmail: usersById[o.userId]?.email || null,
      planName: plansById[o.planId]?.name || o.planId,
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json(enriched);
});

// Admin confirms the money actually arrived — this is what triggers
// provisioning (or renewal) since payments are manual right now.
router.post("/orders/:id/approve", async (req, res) => {
  const order = await db.find("orders", (o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "الطلب غير موجود" });
  if (order.status !== "pending_review") {
    return res.status(400).json({ error: "الطلب ده اتراجع قبل كده" });
  }

  await db.update("orders", (o) => o.id === order.id, { status: "paid", approvedAt: new Date().toISOString() });

  try {
    if (order.renewServerId) {
      const server = await db.find("servers", (s) => s.id === order.renewServerId);
      if (server) await renewServer(server);
    } else {
      await provisionForOrder(order);
    }
    await db.update("orders", (o) => o.id === order.id, { status: "provisioned" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Admin approve → provisioning failed:", err.message);
    await db.update("orders", (o) => o.id === order.id, { status: "failed" });
    res.status(500).json({ error: "تم قبول الطلب لكن فشل تجهيز السيرفر — راجع اللوجات" });
  }
});

router.post("/orders/:id/reject", async (req, res) => {
  const order = await db.find("orders", (o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "الطلب غير موجود" });
  if (order.status !== "pending_review") {
    return res.status(400).json({ error: "الطلب ده اتراجع قبل كده" });
  }
  await db.update("orders", (o) => o.id === order.id, { status: "rejected", rejectedAt: new Date().toISOString() });
  res.json({ ok: true });
});

// ---------- Servers ----------
router.get("/servers", async (req, res) => {
  const { servers, users, plans } = await db.read();
  const byId = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));
  const usersById = byId(users);
  const plansById = byId(plans);

  const enriched = servers
    .map((s) => ({
      ...s,
      userEmail: usersById[s.userId]?.email || null,
      planName: plansById[s.planId]?.name || s.planId,
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json(enriched);
});

router.post("/servers/:id/stop", async (req, res) => {
  const server = await db.find("servers", (s) => s.id === req.params.id);
  if (!server) return res.status(404).json({ error: "السيرفر غير موجود" });
  if (!server.instanceId) return res.status(400).json({ error: "السيرفر لسه بيتجهز، معندوش instance بعد" });

  try {
    await stopServer(server.instanceId);
    const updated = await db.update("servers", (s) => s.id === server.id, {
      status: "suspended",
      suspendedAt: new Date().toISOString(),
    });
    res.json(updated);
  } catch (err) {
    console.error("Admin stop server failed:", err.message);
    res.status(502).json({ error: "تعذر إيقاف السيرفر من AWS" });
  }
});

router.post("/servers/:id/start", async (req, res) => {
  const server = await db.find("servers", (s) => s.id === req.params.id);
  if (!server) return res.status(404).json({ error: "السيرفر غير موجود" });
  if (!server.instanceId) return res.status(400).json({ error: "السيرفر لسه بيتجهز، معندوش instance بعد" });

  try {
    await startServer(server.instanceId);
    await new Promise((r) => setTimeout(r, 15_000));
    const publicIp = await getPublicIp(server.instanceId);
    const updated = await db.update("servers", (s) => s.id === server.id, {
      status: "ready",
      suspendedAt: null,
      publicIp: publicIp || server.publicIp,
    });
    res.json(updated);
  } catch (err) {
    console.error("Admin start server failed:", err.message);
    res.status(502).json({ error: "تعذر تشغيل السيرفر من AWS" });
  }
});

router.post("/servers/:id/terminate", async (req, res) => {
  const server = await db.find("servers", (s) => s.id === req.params.id);
  if (!server) return res.status(404).json({ error: "السيرفر غير موجود" });

  try {
    if (server.instanceId) await terminateServer(server.instanceId);
    const updated = await db.update("servers", (s) => s.id === server.id, {
      status: "terminated",
      terminatedAt: new Date().toISOString(),
    });
    res.json(updated);
  } catch (err) {
    console.error("Admin terminate server failed:", err.message);
    res.status(502).json({ error: "تعذر مسح السيرفر من AWS" });
  }
});

// Manually create + provision a server for a user without going through
// the order/payment flow at all (e.g. a courtesy server, or a payment
// that arrived outside the normal checkout).
router.post("/servers/add", async (req, res) => {
  const { userId, planId } = req.body;
  const user = await db.find("users", (u) => u.id === userId);
  if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });
  const plan = await db.find("plans", (p) => p.id === planId);
  if (!plan) return res.status(400).json({ error: "الباقة غير موجودة" });

  const order = await db.insert("orders", {
    id: nanoid(),
    userId: user.id,
    planId: plan.id,
    amountEGP: plan.priceEGP,
    status: "provisioned",
    paymentProvider: "manual",
    payerPhone: null,
    renewServerId: null,
    note: "created directly by admin",
    createdAt: new Date().toISOString(),
    approvedAt: new Date().toISOString(),
  });

  try {
    const server = await provisionForOrder(order);
    res.json(server);
  } catch (err) {
    console.error("Admin add server failed:", err.message);
    res.status(500).json({ error: "فشل تجهيز السيرفر — راجع اللوجات" });
  }
});

export default router;
