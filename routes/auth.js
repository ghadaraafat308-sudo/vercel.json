// routes/auth.js
import { Router } from "express";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { OAuth2Client } from "google-auth-library";
import { db } from "../db.js";
import { signToken } from "../services/auth.js";
import { sendVerificationCode, sendPasswordResetCode } from "../services/notify.js";
import { rateLimit } from "../services/rateLimit.js";

const router = Router();
const googleClient = process.env.GOOGLE_CLIENT_ID ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID) : null;

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute
const MAX_CODE_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000; // 15 minutes
const MAX_LOGIN_ATTEMPTS = 5;

// Extra-strict limiter for the endpoints most worth protecting from
// brute force: wrong-password guessing, code guessing, and code spam.
const strictLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 8, message: "محاولات كتير، استنى شوية وجرب تاني" });

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

router.post("/signup", async (req, res) => {
  const { email, password, phone } = req.body;
  if (!email || !password || !phone) {
    return res.status(400).json({ error: "الإيميل ورقم الموبايل وكلمة المرور مطلوبين" });
  }

  const existing = await db.find("users", (u) => u.email === email);
  if (existing) return res.status(409).json({ error: "الإيميل ده مسجل قبل كده" });

  const passwordHash = await bcrypt.hash(password, 10);
  const code = generateCode();
  const user = {
    id: nanoid(),
    email,
    phone,
    passwordHash,
    emailVerified: false,
    verificationCode: code,
    verificationExpires: Date.now() + CODE_TTL_MS,
    verificationSentAt: Date.now(),
    createdAt: new Date().toISOString(),
  };
  await db.insert("users", user);
  await sendVerificationCode(email, code);

  res.status(201).json({ needsVerification: true, email });
});

router.post("/verify-email", strictLimiter, async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: "الإيميل والكود مطلوبين" });

  const user = await db.find("users", (u) => u.email === email);
  if (!user) return res.status(404).json({ error: "الحساب ده مش موجود" });
  if (user.emailVerified) return res.status(400).json({ error: "الإيميل ده اتفعّل قبل كده" });
  if (!user.verificationCode || Date.now() > user.verificationExpires) {
    return res.status(400).json({ error: "الكود منتهي، اطلب كود جديد" });
  }
  if (user.verificationCode !== code) {
    // Lock the code out after too many wrong guesses instead of letting
    // someone brute-force a 6-digit code within its 10-minute window.
    const attempts = (user.verificationAttempts || 0) + 1;
    if (attempts >= MAX_CODE_ATTEMPTS) {
      await db.update("users", (u) => u.id === user.id, {
        verificationCode: null,
        verificationExpires: null,
        verificationAttempts: 0,
      });
      return res.status(400).json({ error: "محاولات غلط كتير، اطلب كود جديد" });
    }
    await db.update("users", (u) => u.id === user.id, { verificationAttempts: attempts });
    return res.status(400).json({ error: "الكود غلط" });
  }

  const verified = await db.update("users", (u) => u.id === user.id, {
    emailVerified: true,
    verificationCode: null,
    verificationExpires: null,
    verificationAttempts: 0,
  });

  res.json({ token: signToken(verified), user: { id: verified.id, email: verified.email, phone: verified.phone } });
});

router.post("/resend-code", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "الإيميل مطلوب" });

  const user = await db.find("users", (u) => u.email === email);
  if (!user) return res.status(404).json({ error: "الحساب ده مش موجود" });
  if (user.emailVerified) return res.status(400).json({ error: "الإيميل ده اتفعّل قبل كده" });
  if (user.verificationSentAt && Date.now() - user.verificationSentAt < RESEND_COOLDOWN_MS) {
    return res.status(429).json({ error: "استنى شوية قبل ما تطلب كود جديد" });
  }

  const code = generateCode();
  await db.update("users", (u) => u.id === user.id, {
    verificationCode: code,
    verificationExpires: Date.now() + CODE_TTL_MS,
    verificationSentAt: Date.now(),
  });
  await sendVerificationCode(email, code);

  res.json({ ok: true });
});

router.post("/login", strictLimiter, async (req, res) => {
  const { email, password } = req.body;
  const user = await db.find("users", (u) => u.email === email);
  if (!user) return res.status(401).json({ error: "بيانات الدخول غلط" });
  if (!user.passwordHash) return res.status(401).json({ error: "الحساب ده اتعمل بجوجل، سجل دخولك بجوجل" });

  if (user.lockUntil && Date.now() < user.lockUntil) {
    const minsLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
    return res.status(429).json({ error: `محاولات كتير غلط، الحساب مقفول مؤقتاً — جرب تاني بعد ${minsLeft} دقيقة` });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    // Lock the account for a while after too many wrong passwords in a
    // row, instead of allowing unlimited guesses forever.
    const attempts = (user.failedLoginAttempts || 0) + 1;
    const patch = { failedLoginAttempts: attempts };
    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      patch.lockUntil = Date.now() + LOGIN_LOCK_MS;
      patch.failedLoginAttempts = 0;
    }
    await db.update("users", (u) => u.id === user.id, patch);
    return res.status(401).json({ error: "بيانات الدخول غلط" });
  }

  if (user.failedLoginAttempts || user.lockUntil) {
    await db.update("users", (u) => u.id === user.id, { failedLoginAttempts: 0, lockUntil: null });
  }
  if (!user.emailVerified) return res.status(403).json({ error: "لازم تفعّل إيميلك الأول", needsVerification: true, email: user.email });

  res.json({ token: signToken(user), user: { id: user.id, email: user.email, phone: user.phone } });
});

// ---------- Forgot / reset password ----------
router.post("/forgot-password", strictLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "الإيميل مطلوب" });

  const user = await db.find("users", (u) => u.email === email);
  // Always answer the same way whether the email exists or not, and
  // whether it's a password account or a Google-only account — this
  // stops the endpoint being used to check which emails are registered.
  if (user && user.passwordHash) {
    if (!user.resetSentAt || Date.now() - user.resetSentAt >= RESEND_COOLDOWN_MS) {
      const code = generateCode();
      await db.update("users", (u) => u.id === user.id, {
        resetCode: code,
        resetExpires: Date.now() + CODE_TTL_MS,
        resetSentAt: Date.now(),
        resetAttempts: 0,
      });
      await sendPasswordResetCode(email, code);
    }
  }

  res.json({ ok: true, message: "لو الإيميل ده مسجل عندنا، هيوصله كود استرجاع كلمة المرور" });
});

router.post("/reset-password", strictLimiter, async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) return res.status(400).json({ error: "البيانات ناقصة" });
  if (newPassword.length < 6) return res.status(400).json({ error: "كلمة المرور لازم تكون 6 حروف على الأقل" });

  const user = await db.find("users", (u) => u.email === email);
  if (!user || !user.resetCode || Date.now() > user.resetExpires) {
    return res.status(400).json({ error: "الكود غلط أو منتهي" });
  }
  if (user.resetCode !== code) {
    const attempts = (user.resetAttempts || 0) + 1;
    if (attempts >= MAX_CODE_ATTEMPTS) {
      await db.update("users", (u) => u.id === user.id, { resetCode: null, resetExpires: null, resetAttempts: 0 });
      return res.status(400).json({ error: "محاولات غلط كتير، اطلب كود جديد" });
    }
    await db.update("users", (u) => u.id === user.id, { resetAttempts: attempts });
    return res.status(400).json({ error: "الكود غلط" });
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const updated = await db.update("users", (u) => u.id === user.id, {
    passwordHash,
    resetCode: null,
    resetExpires: null,
    resetAttempts: 0,
    failedLoginAttempts: 0,
    lockUntil: null,
  });

  res.json({ token: signToken(updated), user: { id: updated.id, email: updated.email, phone: updated.phone } });
});

router.post("/google", async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: "بيانات جوجل ناقصة" });
  if (!googleClient) return res.status(500).json({ error: "تسجيل الدخول بجوجل مش مفعّل على السيرفر" });

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: "تعذر التحقق من حساب جوجل" });
  }

  if (!payload?.email) return res.status(400).json({ error: "الحساب مفيهوش إيميل" });

  let user = await db.find("users", (u) => u.googleId === payload.sub || u.email === payload.email);
  if (!user) {
    user = {
      id: nanoid(),
      email: payload.email,
      phone: "",
      googleId: payload.sub,
      passwordHash: null,
      emailVerified: true,
      createdAt: new Date().toISOString(),
    };
    await db.insert("users", user);
  } else if (!user.googleId || !user.emailVerified) {
    user = await db.update("users", (u) => u.id === user.id, { googleId: payload.sub, emailVerified: true });
  }

  res.json({ token: signToken(user), user: { id: user.id, email: user.email, phone: user.phone } });
});

export default router;
