// routes/webhook.js
import { Router } from "express";
import { db } from "../db.js";
import { verifyWebhookSignature } from "../services/paymob.js";
import { provisionForOrder, renewServer } from "../services/provision.js";

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
    await db.update("orders", (o) => o.id === order.id, { status: "paid" });

    if (order.renewServerId) {
      const server = await db.find("servers", (s) => s.id === order.renewServerId);
      if (server) await renewServer(server);
    } else {
      await provisionForOrder(order);
    }

    await db.update("orders", (o) => o.id === order.id, { status: "provisioned" });
  } else {
    await db.update("orders", (o) => o.id === order.id, { status: "failed" });
  }

  // Paymob just needs a 200 to know we received it.
  res.sendStatus(200);
});

export default router;
