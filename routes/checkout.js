// routes/checkout.js
import { Router } from "express";
import { nanoid } from "nanoid";
import { db } from "../db.js";
import { requireAuth } from "../services/auth.js";
import { startCardCheckout } from "../services/paymob.js";

const router = Router();

router.post("/", requireAuth, async (req, res) => {
  const { planId, phoneNumber, renewServerId } = req.body;
  const plan = await db.find("plans", (p) => p.id === planId);
  if (!plan) return res.status(400).json({ error: "الباقة غير موجودة" });

  // If this is a renewal, make sure the server actually belongs to this user.
  if (renewServerId) {
    const target = await db.find("servers", (s) => s.id === renewServerId && s.userId === req.user.uid);
    if (!target) return res.status(404).json({ error: "السيرفر غير موجود" });
  }

  const user = await db.find("users", (u) => u.id === req.user.uid);

  const order = await db.insert("orders", {
    id: nanoid(),
    userId: user.id,
    planId: plan.id,
    amountEGP: plan.priceEGP,
    status: "pending", // pending -> (webhook confirms) -> pending_review -> (admin assigns) -> provisioned  |  failed
    paymentProvider: "paymob-card",
    payerPhone: phoneNumber || null,
    renewServerId: renewServerId || null,
    createdAt: new Date().toISOString(),
  });

  try {
    const redirectUrl = await startCardCheckout({ order, plan, customer: { email: user.email, phone: user.phone } });
    res.json({ orderId: order.id, redirectUrl });
  } catch (err) {
    console.error("Paymob card checkout error:", err.response?.data || err.message);
    await db.update("orders", (o) => o.id === order.id, { status: "failed" });
    res.status(502).json({ error: "تعذر بدء عملية الدفع، حاول تاني" });
  }
});

export default router;
