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
