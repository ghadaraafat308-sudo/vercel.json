// services/notify.js
// ------------------------------------------------------------------
// Central place for every customer-facing notification. Both channels
// fail silently (log + continue) so a broken email/SMS provider never
// crashes a provisioning or expiry cycle — notifications are important
// but shouldn't be able to break the core flow.
// ------------------------------------------------------------------
import nodemailer from "nodemailer";
import twilio from "twilio";

let mailer = null;
function getMailer() {
  if (mailer) return mailer;
  if (!process.env.SMTP_HOST) return null; // not configured yet
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return mailer;
}

let smsClient = null;
function getSmsClient() {
  if (smsClient) return smsClient;
  if (!process.env.TWILIO_ACCOUNT_SID) return null; // not configured yet
  smsClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return smsClient;
}

export async function sendEmail(to, subject, html) {
  const transport = getMailer();
  if (!transport) {
    console.warn(`[notify] SMTP not configured — skipped email "${subject}" to ${to}`);
    return;
  }
  try {
    await transport.sendMail({ from: process.env.SMTP_FROM, to, subject, html });
  } catch (err) {
    console.error(`[notify] Failed to send email to ${to}:`, err.message);
  }
}

export async function sendSms(to, body) {
  const client = getSmsClient();
  if (!client) {
    console.warn(`[notify] Twilio not configured — skipped SMS to ${to}`);
    return;
  }
  try {
    await client.messages.create({ from: process.env.TWILIO_FROM_NUMBER, to, body });
  } catch (err) {
    console.error(`[notify] Failed to send SMS to ${to}:`, err.message);
  }
}

/**
 * Egyptian mobile numbers are usually stored as 01xxxxxxxxx locally —
 * Twilio (and most SMS gateways) need E.164 format (+201xxxxxxxxx).
 */
function toE164Egypt(localPhone) {
  const digits = localPhone.replace(/\D/g, "");
  if (digits.startsWith("20")) return `+${digits}`;
  if (digits.startsWith("0")) return `+2${digits}`;
  return `+20${digits}`;
}

// ---------- Branded email template ----------
// Matches the site's dark + blue look so codes/emails don't feel like
// generic plaintext notifications.
function brandedEmail({ title, bodyHtml, badge = "" }) {
  return `
  <div dir="rtl" style="background:#06080F; padding:40px 16px; font-family:Tahoma, Arial, sans-serif;">
    <div style="max-width:480px; margin:0 auto; background:#0C111D; border:1px solid #212B41; border-radius:16px; overflow:hidden;">
      <div style="padding:26px 32px; border-bottom:1px solid #212B41; display:flex; align-items:center; gap:10px;">
        <span style="display:inline-block; width:10px; height:10px; border-radius:2px; background:#3B82F6;"></span>
        <span style="color:#E8EBF5; font-size:18px; font-weight:700;">Nodrix</span>
      </div>
      <div style="padding:36px 32px;">
        ${badge ? `<div style="display:inline-block; background:rgba(59,130,246,0.1); color:#3B82F6; border:1px solid rgba(59,130,246,0.3); font-size:12px; padding:5px 12px; border-radius:100px; margin-bottom:18px;">${badge}</div>` : ""}
        <h2 style="color:#E8EBF5; font-size:20px; margin:0 0 14px;">${title}</h2>
        <div style="color:#8891A6; font-size:14.5px; line-height:1.8;">${bodyHtml}</div>
      </div>
      <div style="padding:18px 32px; border-top:1px solid #212B41; color:#8891A6; font-size:12px;">
        Nodrix — سيرفرات RDP مبنية على AWS
      </div>
    </div>
  </div>`;
}

export async function sendVerificationCode(email, code) {
  await sendEmail(
    email,
    `${code} هو كود التفعيل بتاعك — Nodrix`,
    brandedEmail({
      badge: "تفعيل الحساب",
      title: "أكّد إيميلك عشان تفعّل حسابك",
      bodyHtml: `
        <p style="margin:0 0 22px;">استخدم الكود ده في صفحة التسجيل، وهيخلص بعد 10 دقايق:</p>
        <div style="background:#121A2B; border:1px dashed #212B41; border-radius:10px; padding:18px; text-align:center; margin-bottom:22px;">
          <span style="font-family:'Courier New', monospace; font-size:32px; font-weight:700; letter-spacing:8px; color:#3B82F6; direction:ltr; display:inline-block;">${code}</span>
        </div>
        <p style="margin:0;">لو مطلبتش الكود ده، تجاهل الإيميل ببساطة.</p>
      `,
    })
  );
}



export async function sendPasswordResetCode(email, code) {
  await sendEmail(
    email,
    `${code} هو كود استرجاع كلمة المرور — Nodrix`,
    brandedEmail({
      badge: "استرجاع كلمة المرور",
      title: "اطلب كلمة مرور جديدة",
      bodyHtml: `
        <p style="margin:0 0 22px;">استخدم الكود ده عشان تحط كلمة مرور جديدة، وهيخلص بعد 10 دقايق:</p>
        <div style="background:#121A2B; border:1px dashed #212B41; border-radius:10px; padding:18px; text-align:center; margin-bottom:22px;">
          <span style="font-family:'Courier New', monospace; font-size:32px; font-weight:700; letter-spacing:8px; color:#3B82F6; direction:ltr; display:inline-block;">${code}</span>
        </div>
        <p style="margin:0;">لو مطلبتش الكود ده، تجاهل الإيميل — حسابك آمن ومفيش حاجة اتغيرت.</p>
      `,
    })
  );
}

export async function notifyServerReady(user, server, plan) {
  await sendEmail(
    user.email,
    "سيرفرك جاهز — Nodrix",
    `
      <div dir="rtl" style="font-family:sans-serif">
        <h2>سيرفر ${plan.name} بتاعك جاهز</h2>
        <p>بيانات الدخول:</p>
        <ul>
          <li>IP: <b>${server.publicIp}</b></li>
          <li>اسم المستخدم: <b>${server.username}</b></li>
          <li>كلمة المرور: <b>${server.password}</b></li>
        </ul>
        <p>الاشتراك ساري لحد: ${new Date(server.expiresAt).toLocaleDateString("ar-EG")}</p>
      </div>
    `
  );
  await sendSms(
    toE164Egypt(user.phone),
    `سيرفرك جاهز! IP: ${server.publicIp} — بيانات الدخول كاملة في لوحة التحكم Nodrix.`
  );
}

export async function notifyServerSuspended(user, server, graceDays) {
  await sendEmail(
    user.email,
    "الاشتراك خلص — سيرفرك اتوقف مؤقتًا",
    `
      <div dir="rtl" style="font-family:sans-serif">
        <h2>سيرفرك اتوقف مؤقتًا</h2>
        <p>الاشتراك بتاعك خلص، فوقفنا السيرفر — بياناتك محفوظة زي ما هي.</p>
        <p>جدد خلال <b>${graceDays} أيام</b> قبل ما يتمسح نهائيًا.</p>
      </div>
    `
  );
  await sendSms(
    toE164Egypt(user.phone),
    `سيرفرك اتوقف مؤقتًا لانتهاء الاشتراك. جدد خلال ${graceDays} أيام قبل ما يتمسح نهائيًا.`
  );
}

export async function notifyServerTerminated(user, server) {
  await sendEmail(
    user.email,
    "تم حذف السيرفر نهائيًا",
    `
      <div dir="rtl" style="font-family:sans-serif">
        <h2>السيرفر اتمسح نهائيًا</h2>
        <p>فترة السماح خلصت من غير تجديد، فتم حذف السيرفر وبياناته بشكل نهائي.</p>
        <p>تقدر تطلب سيرفر جديد في أي وقت من لوحة التحكم.</p>
      </div>
    `
  );
}

export async function notifyExpiryReminder(user, server, plan, daysLeft) {
  await sendEmail(
    user.email,
    `اشتراكك هيخلص خلال ${daysLeft} يوم`,
    `
      <div dir="rtl" style="font-family:sans-serif">
        <h2>تذكير بتجديد الاشتراك</h2>
        <p>سيرفر ${plan.name} بتاعك هيخلص خلال ${daysLeft} يوم. جدده دلوقتي عشان يفضل شغال من غير انقطاع.</p>
      </div>
    `
  );
  await sendSms(
    toE164Egypt(user.phone),
    `اشتراك سيرفرك هيخلص خلال ${daysLeft} يوم. جدده من لوحة التحكم Nodrix.`
  );
}
