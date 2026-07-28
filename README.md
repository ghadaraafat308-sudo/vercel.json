# Nodrix — متجر بيع سيرفرات RDP

باك إند كامل + متجر + لوحة تحكم لبيع سيرفرات RDP على AWS، بدفع فودافون كاش/انستاباي عن طريق Paymob.

## هيكل المشروع

```
server/
├── server.js              # نقطة التشغيل الرئيسية
├── db.js                  # قاعدة بيانات SQLite حقيقية (better-sqlite3) — ملف data.sqlite
├── routes/
│   ├── auth.js             # تسجيل / دخول
│   ├── plans.js            # عرض الباقات
│   ├── checkout.js         # بدء الدفع عبر Paymob
│   ├── webhook.js          # استقبال تأكيد الدفع من Paymob
│   └── servers.js          # سيرفرات العميل (عرض / إيقاف)
├── services/
│   ├── aws.js               # إنشاء سيرفر EC2، إيقافه، تشغيله، وفك تشفير الباسورد
│   ├── paymob.js             # التكامل مع Paymob (محفظة فودافون كاش/انستاباي)
│   ├── provision.js          # الربط بين الدفع الناجح وإنشاء/تجديد السيرفر
│   ├── expiry.js              # يفحص كل 5 دقايق ويوقف/يمسح السيرفرات المنتهية
│   ├── notify.js               # إشعارات إيميل (Nodemailer) و SMS (Twilio)
│   └── auth.js               # JWT
└── public/
    ├── index.html             # المتجر (الواجهة التسويقية)
    └── dashboard.html         # لوحة تحكم العميل
```

## قاعدة البيانات (Firebase Firestore)

المشروع بيحفظ كل حاجة (المستخدمين، الطلبات، السيرفرات، الباقات) في **Firebase Firestore** بدل ملف SQLite محلي — عشان فيرسيل بيمسح أي ملفات محلية بين كل طلب، فمحتاجين قاعدة بيانات برّه السيرفر نفسه.

**الإعداد (مرة واحدة بس):**

1. روح على [console.firebase.google.com](https://console.firebase.google.com) واعمل مشروع جديد (Add project) — سمّيه Nodrix مثلاً.
2. من القائمة الجانبية: **Build → Firestore Database → Create database**. اختار أي region قريب منك، وابدأ في **production mode**.
3. من ⚙️ **Project settings → Service accounts**، دوس **Generate new private key**. هيتنزّلك ملف JSON.
4. افتح الملف ده، وانسخ **كل المحتوى بتاعه** والصقه كقيمة `FIREBASE_SERVICE_ACCOUNT_KEY` في `.env` (أو في Environment Variables بتاعة فيرسيل).

مفيش حد سيرفر قاعدة بيانات تشغّله بنفسك، ومفيش ملفات تتمسح — البيانات محفوظة عند Firebase بشكل دائم، والباقات الافتراضية (`plans`) بتتزرع تلقائي أول مرة يشتغل فيها الموقع.

## النشر على Vercel

المشروع بقى شغال بطريقتين في نفس الوقت:
- `server.js` — للتشغيل المحلي أو أي سيرفر عادي شغال طول الوقت (VPS مثلاً).
- `api/index.js` — نقطة الدخول لـ Vercel (serverless)، بتستخدم نفس الكود بالظبط من `app.js`.

**خطوات الرفع:**

1. ارفع المشروع على GitHub (مستودع خاص يفضّل، عشان فيه `.env` — تأكد إنه متضاف في `.gitignore` ومش هيتبعت).
2. من [vercel.com](https://vercel.com) → **Add New Project** → اختار المستودع.
3. في **Environment Variables**، ضيف كل المتغيرات اللي في `.env` بتاعك (JWT_SECRET، FIREBASE_SERVICE_ACCOUNT_KEY، AWS_*، PAYMOB_*، إلخ) — بما فيهم `CRON_SECRET` (اعمل قيمة عشوائية طويلة).
4. `DASHBOARD_URL` حطه بدومين فيرسيل بتاعك بعد أول نشر (شكله `https://your-project.vercel.app`)، وارجع حدّثه في Environment Variables، وأعد النشر (Redeploy) عشان قيمة CORS تتحدث.
5. **حدّث webhook Paymob** في لوحة Paymob بنفس الدومين: `https://your-project.vercel.app/api/webhook/paymob`.
6. **حدّث Google OAuth**: ضيف `https://your-project.vercel.app` في Authorized JavaScript origins.

### إيقاف السيرفرات المنتهية على فيرسيل — لازم Cron خارجي

فيرسيل المجاني (Hobby) بيشغّل الـ Cron بتاعه **مرة واحدة في اليوم بس** — ده بطيء جداً لإيقاف سيرفرات منتهية (المفروض تتفحص كل 5-10 دقايق زي `services/expiry.js` الأصلي). عشان كده لازم خدمة Cron مجانية من برّه تنده على الموقع بنفسها كل شوية:

1. اعمل حساب مجاني على [cron-job.org](https://cron-job.org).
2. اعمل job جديد يندهلك على:
   ```
   https://your-project.vercel.app/api/cron/expiry?secret=CRON_SECRET_بتاعك
   ```
3. اضبطه يشتغل كل 5-10 دقايق.

ده هيخلّي `checkExpirations()` تشتغل بانتظام تماماً زي `setInterval` القديم، وده كويس عموماً عشان الموقع يفضل شغال بانتظام.

### ملحوظة عن الاستخدام التجاري على خطة فيرسيل المجانية

خطة Vercel Hobby المجانية شروطها بتقول إنها **للاستخدام الشخصي/غير التجاري بس** — رسمياً مش مخصصة لموقع بياخد فلوس حقيقية من عملاء. تقدر تبدأ بيها للتجربة، بس أول ما تبدأ تاخد مدفوعات حقيقية من عملاء حقيقيين، الأنسب (وده اللي الشروط بتطلبه فعلياً) إنك تترقّى لخطة Pro (حوالي 20$/الشهر).

## نقطة مهمة: كل حاجة بقت async

كل استدعاءات `db.find` / `db.filter` / `db.insert` / `db.update` / `db.read` بقت بترجع Promise (لأنها بتتكلم مع Firebase عبر الإنترنت بدل ملف محلي)، فكل مكان بيستخدمها لازم يبقى جواه `await` جوه دالة `async` — ده اتعمل بالفعل في كل الملفات الموجودة، بس لو ضفت أي كود جديد يستخدم `db`، افتكر الجزئية دي.

## التشغيل محليًا

```bash
cd server
npm install
cp .env.example .env   # واملأ القيم الحقيقية (JWT_SECRET, FIREBASE_SERVICE_ACCOUNT_KEY, ...)
npm start
```

الموقع هيشتغل على `http://localhost:4000`.

## تفعيل الإيميل بكود (Email Verification)

التسجيل اليدوي (إيميل + باسورد) بقى محتاج تأكيد الإيميل قبل ما الحساب يشتغل:

1. المستخدم بيسجل من `/dashboard.html` (تسجيل جديد).
2. السيرفر بيبعت إيميل فيه كود من 6 أرقام (شكل الإيميل نفسه مبني على براند Nodrix — خلفية غامقة وأزرق، مش إيميل عادي).
3. المستخدم بيدخل الكود في نفس الصفحة، ولو صح بيتفعل الحساب ويدخل على طول.
4. الكود صالح 10 دقايق، وفيه زرار "إعادة إرسال" بحد أقصى مرة كل دقيقة.
5. حسابات جوجل (Google Sign-In) بتتفعل تلقائي من غير كود، لأن جوجل أصلاً بتأكد الإيميل.

**ده محتاج SMTP شغال في `.env`** (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) عشان الكود يوصل فعليًا — من غيره السيرفر هيسجل تحذير في الـ console ومش هيبعت حاجة.

## إعداد تسجيل الدخول بجوجل (خطوة بخطوة)

1. روح على [Google Cloud Console](https://console.cloud.google.com/) وسجّل دخولك بحساب جوجل.
2. من أعلى الصفحة، اعمل مشروع جديد (New Project) — سمّيه Nodrix مثلاً.
3. من القائمة الجانبية: **APIs & Services → OAuth consent screen**.
   - اختار **External**.
   - املأ اسم التطبيق (Nodrix)، وإيميلك كـ Support email، وإيميلك تاني في Developer contact.
   - احفظ (مش لازم تنشر التطبيق للتجربة، لكن لو هتفتحه لأي حد لازم تعمل Publish بعدين).
4. من نفس القائمة: **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Web application**.
   - Authorized JavaScript origins: ضيف الدومين بتاعك، مثلاً `https://yourdomain.com`، وكمان `http://localhost:4000` عشان تجرب محليًا.
   - مش محتاج تحط Redirect URI — إحنا مستخدمين Google Identity Services (زرار "Continue with Google") مش الـ redirect flow القديم.
   - دوس Create.
5. هيديك **Client ID** (شكله بيخلص بـ `.apps.googleusercontent.com`). انسخه.
6. حطه في ملف `.env` بتاعك:
   ```
   GOOGLE_CLIENT_ID=xxxxxxxxxx.apps.googleusercontent.com
   ```
7. ارستارت السيرفر (`npm start`). زرار "Continue with Google" هيظهر تلقائي في صفحة الدخول بالداشبورد.

ملحوظة: مش محتاج Client Secret خالص في الطريقة دي — التحقق بيتم بمكتبة `google-auth-library` على السيرفر باستخدام الـ ID Token اللي بيرجع من الزرار مباشرة.

## إعداد AWS (خطوة بخطوة)

1. اعمل IAM user مخصص **للأتمتة بس**، وحطله صلاحيات EC2 محدودة فقط
   (`RunInstances`, `DescribeInstances`, `GetPasswordData`, `CreateTags`, `TerminateInstances`) —
   متستخدمش الـ root keys أبدًا.
2. جهّز key pair في نفس الـ region وحط اسمه في `AWS_KEY_PAIR_NAME`، واحفظ
   المفتاح الخاص (PEM) في متغيّر `AWS_KEY_PAIR_PRIVATE_PEM` — ده اللي بيفك تشفير
   باسورد الـ Administrator اللي AWS بترجعه.
3. جهّز Security Group يسمح بدخول بورت `3389` (RDP) — يُفضّل تقييده لاحقًا
   بمصادر معروفة بدل فتحه للعالم كله.
4. حدد AMI لويندوز سيرفر في الـ region بتاعك وحطه في `AWS_WINDOWS_AMI_ID`
   (الـ AMI ids بتتغير مع كل تحديث، تابعها من AWS Console).

## إعداد Paymob

1. افتح حساب على [Paymob](https://paymob.com) واختار **Integration** من نوع
   Mobile Wallet (بيغطي فودافون كاش وانستاباي مع بعض).
2. من الـ Dashboard خد: `API Key`، `Integration ID` بتاع الـ Wallet، و `HMAC Secret`.
3. حط الـ webhook URL بتاعك (`https://yourdomain.com/api/webhook/paymob`) في
   إعدادات Paymob عشان يبعتلك تأكيد الدفع أوتوماتيك.

## إيقاف السيرفر تلقائي بعد ما الاشتراك يخلص

في `services/expiry.js` — بيشتغل كل 5 دقايق ويعمل خطوتين:

1. **أي سيرفر `ready` عدّى معاد انتهائه** → بيوقف (Stop، مش Terminate) عشان بيانات
   العميل تفضل محفوظة، وحالته بتتغير لـ `suspended`.
2. **أي سيرفر فضل `suspended` لمدة 3 أيام** (فترة سماح قابلة للتعديل في
   `GRACE_PERIOD_MS`) **من غير تجديد** → بيتمسح نهائيًا (Terminate) وحالته
   بتبقى `terminated`.

لو العميل جدد وهو لسه في فترة السماح، `renewServer()` في `services/provision.js`
بيشغّل السيرفر تاني ويمدد `expiresAt`، ولو جدد قبل ما الاشتراك يخلص أصلًا،
بيضيفله 30 يوم فوق المعاد الحالي بدل ما يضيّع عليه الأيام الباقية.

**تنبيه مهم:** إعادة تشغيل سيرفر متوقف بتدّيه IP جديد (إلا لو حجزت له Elastic IP)،
فالكود بيسحب الـ IP الجديد تلقائي ويحدّثه في لوحة التحكم — كويس تبعت للعميل
إشعار إن الـ IP اتغير بعد أي تجديد.

## إشعارات الإيميل والـ SMS

`services/notify.js` بيبعت 4 أنواع رسائل تلقائي (إيميل + SMS مع بعض):

| اللحظة | بتتبعت من |
|---|---|
| السيرفر بقى جاهز (IP + بيانات الدخول) | `provision.js` بعد ما `pollUntilReady` يخلص |
| هيخلص خلال يومين (مرة واحدة بس لكل سيرفر) | `expiry.js` |
| الاشتراك خلص واتوقف مؤقتًا | `expiry.js` |
| اتمسح نهائي بعد فترة السماح | `expiry.js` |

**الإعداد:**
- **الإيميل**: أي SMTP provider (Gmail، SendGrid، Mailgun...) — حط بياناته في
  `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`.
- **الـ SMS**: [Twilio](https://twilio.com) — حط `TWILIO_ACCOUNT_SID` و
  `TWILIO_AUTH_TOKEN` و`TWILIO_FROM_NUMBER`. أرقام العملاء بتتخزن محلي
  (`01xxxxxxxxx`) والكود بيحولها تلقائي لصيغة دولية (`+201xxxxxxxxx`).
  لو حابب تستخدم بديل مصري محلي بدل Twilio (زي SMS Misr أو Vonage)،
  بدّل جوه `getSmsClient()` و`sendSms()` في `services/notify.js` بس —
  باقي الكود مش هيتأثر.
- **لو سبت المتغيرات فاضية**: الكود بيشتغل عادي وبيطبع تحذير في اللوج
  بدل ما يكسر أي حاجة — كويس تسيبها فاضية وأنت لسه بتجرب محليًا.

## نقاط أمان مهمة قبل ما تنزل بالموقع لايف

- **قاعدة البيانات بقت SQLite حقيقية** (مش JSON) — مناسبة لحجم متوسط من الترافيك. لو المشروع كبر جدًا وحبيت تتوسع على أكتر من سيرفر، وقتها انقل لـ Postgres/MySQL (شوف قسم "قاعدة البيانات" فوق).
- **قيّد الـ Security Group** بدل ما تفتح RDP للعالم كله، أو استخدم VPN/bastion.
- **فعّل HTTPS** على السيرفر بتاعك (Let's Encrypt أو عبر الـ load balancer).
- **افحص الـ webhook HMAC** دايمًا قبل ما تعتبر أي دفع ناجح (متعمول بالفعل في الكود).
- **حط شروط استخدام واضحة (AUP)** بتمنع الاستخدام المسيء، وده بيحميك من
  إيقاف حساب AWS بتاعك لو حد استخدم سيرفر لغرض ضار.
- فكّر في نظام **KYC بسيط** (تأكيد رقم موبايل/إيميل) قبل تفعيل أي سيرفر.

## الخطوات الناقصة لو حبيت تكمل

- تجديد تلقائي كامل للاشتراك (بدون تدخل العميل، حفظ وسيلة دفع)
- صفحة أدمن لمتابعة كل الطلبات والسيرفرات
- نظام KYC بسيط قبل تفعيل أي سيرفر
