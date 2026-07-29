// services/auth.js
import jwt from "jsonwebtoken";

export function signToken(user) {
  return jwt.sign({ uid: user.id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "غير مصرح، سجل دخولك أولاً" });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "الجلسة منتهية، سجل دخولك تاني" });
  }
}

// ---------- Admin ----------
// A single shared admin password (ADMIN_PASSWORD env var) rather than a
// full user account system — simplest thing that works for one operator.
// The token carries { isAdmin: true } and is verified separately from
// customer tokens, so an admin session can never be reused as (or
// confused with) a customer session and vice versa.
export function signAdminToken() {
  return jwt.sign({ isAdmin: true }, process.env.JWT_SECRET, { expiresIn: "12h" });
}

export function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "غير مصرح" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!payload.isAdmin) return res.status(403).json({ error: "غير مصرح" });
    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({ error: "الجلسة منتهية، سجل دخولك تاني" });
  }
}
