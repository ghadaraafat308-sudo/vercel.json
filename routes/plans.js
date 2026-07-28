// routes/plans.js
import { Router } from "express";
import { db } from "../db.js";

const router = Router();

router.get("/", async (req, res) => {
  const { plans } = await db.read();
  res.json(plans);
});

export default router;
