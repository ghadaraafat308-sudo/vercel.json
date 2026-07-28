// routes/servers.js
import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../services/auth.js";
import { terminateServer } from "../services/aws.js";

const router = Router();

// List only the current user's servers — never expose other customers' data.
router.get("/", requireAuth, async (req, res) => {
  const servers = await db.filter("servers", (s) => s.userId === req.user.uid);

  // Don't leak raw AWS instance ids to the client; keep the response
  // scoped to what the customer actually needs to connect.
  const safe = servers.map(({ instanceId, ...rest }) => rest);
  res.json(safe);
});

router.post("/:id/terminate", requireAuth, async (req, res) => {
  const server = await db.find("servers", (s) => s.id === req.params.id && s.userId === req.user.uid);
  if (!server) return res.status(404).json({ error: "السيرفر غير موجود" });

  if (server.instanceId) {
    await terminateServer(server.instanceId);
  }
  await db.update("servers", (s) => s.id === server.id, { status: "terminated" });
  res.json({ ok: true });
});

export default router;
