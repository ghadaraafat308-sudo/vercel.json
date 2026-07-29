// routes/checkout.js
import { Router } from "express";
import { nanoid } from "nanoid";
import { db } from "../db.js";
import { requireAuth } from "../services/auth.js";

const router = Router();

// ------------------------------------------------------------------
// Payments are MANUAL for now: the customer submits an order, an admin
// reviews it in /admin.html and approves it by hand (after confirming
// the money actually arrived), which is what triggers provisioning.
// No Paymob call happens here. To switch back to automatic payments
// later, re-introduce the startWalletCheckout() call from
// services/paymob.js the way it was before, inside the try block below.
// ------------------------------------------------------------------
router.post("/", requireAuth, async (req, res) => {
  const { planId, phoneNumber, renewServerId } = req.body;
  const plan = await db.find("plans", (p) => p.id === planId);
  if (!plan) return res.status(400).json({ error: "الباقة غير موجودة" });
  if (!phoneNumber) return res.status(400).json({ error: "رقم المحفظة مطلوب" });

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
    status: "pending_review", // pending_review -> (admin approves) -> provisioned  |  (admin rejects) -> rejected
    paymentProvider: "manual",
    payerPhone: phoneNumber,
    renewServerId: renewServerId || null,
    createdAt: new Date().toISOString(),
  });

  res.json({
    orderId: order.id,
    message: "استلمنا طلبك — هيتراجع ويتفعّل بعد تأكيد الدفع من فريقنا خلال وقت قصير.",
  });
});

export default router;
