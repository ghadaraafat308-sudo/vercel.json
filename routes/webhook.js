// routes/webhook.js
import { Router } from "express";
import { db } from "../db.js";
import { verifyWebhookSignature } from "../services/paymob.js";
import { renewServer } from "../services/provision.js";

const router = Router();

// Paymob calls this URL after the customer confirms (or cancels) payment
// in their Vodafone Cash / InstaPay app.
router.post("/paymob", async (req, res) => {
  const receivedHmac = req.query.hmac;
  const payload = req.body.obj || req.body;

  const isValid = verifyWebhookSignature(payload, receivedHmac);
  if (!isValid) {
    console.warn("Rejected webhook with invalid HMAC signature");
    return res.status(401).json({ error: "invalid signature" });
  }

  const merchantOrderId = payload.order?.merchant_order_id;
  const order = await db.find("orders", (o) => o.id === merchantOrderId);
  if (!order) return res.status(404).json({ error: "order not found" });

  if (payload.success === true || payload.success === "true") {
    if (order.renewServerId) {
      // Renewing an existing server doesn't need a human to pick
      // anything — just extend the expiry (and restart it if it was
      // suspended), so this stays fully automatic.
      const server = await db.find("servers", (s) => s.id === order.renewServerId);
      if (server) await renewServer(server);
      await db.update("orders", (o) => o.id === order.id, { status: "provisioned" });
    } else {
      // New order: payment is confirmed, but no server is auto-launched
      // (AWS auto-provisioning isn't set up yet) — hand it to the admin
      // to assign one from inventory or type in IP details by hand.
      await db.update("orders", (o) => o.id === order.id, { status: "pending_review" });
    }
  } else {
    await db.update("orders", (o) => o.id === order.id, { status: "failed" });
  }

  // Paymob just needs a 200 to know we received it.
  res.sendStatus(200);
});

export default router;
