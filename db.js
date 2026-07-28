// db.js
// ------------------------------------------------------------------
// Storage backed by Firebase Firestore instead of a local SQLite
// file. Vercel's serverless functions each run in their own
// throwaway filesystem, so a local file would get wiped between
// requests — an external database is required.
//
// Every collection (users, orders, servers, plans) is a Firestore
// collection, one document per record (document id = record id, the
// document's fields ARE the record). That keeps the exact same
// find/filter/insert/update API the rest of the app already uses —
// only the storage underneath changed, no route or service file
// needed to change its own logic.
//
// One-time setup (see README): create a Firebase project, enable
// Firestore, generate a service account key, and set
// FIREBASE_SERVICE_ACCOUNT_KEY in your environment.
// ------------------------------------------------------------------
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "Missing FIREBASE_SERVICE_ACCOUNT_KEY — set it in your environment (see README)."
    );
  }
  // Accept either the raw JSON (pasted as-is) or a base64-encoded copy
  // of it — whichever is easier to paste into your .env / Vercel env
  // vars without newline issues.
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(Buffer.from(raw, "base64").toString("utf-8"));
    } catch {
      throw new Error(
        "FIREBASE_SERVICE_ACCOUNT_KEY مش JSON صحيح ولا base64 صحيح — راجع خطوات الإعداد في README."
      );
    }
  }
}

if (!getApps().length) {
  initializeApp({ credential: cert(loadServiceAccount()) });
}

const firestore = getFirestore();

const COLLECTIONS = ["users", "orders", "servers", "plans"];

async function rowsToRecords(collection) {
  const snap = await firestore.collection(collection).get();
  return snap.docs.map((doc) => doc.data());
}

const DEFAULT_PLANS = [
  { id: "starter", name: "Starter", priceEGP: 350, vcpu: 2, ramGB: 4, storageGB: 60, awsInstanceType: "t3.medium" },
  { id: "pro", name: "Pro", priceEGP: 650, vcpu: 4, ramGB: 8, storageGB: 120, awsInstanceType: "t3.xlarge" },
  { id: "business", name: "Business", priceEGP: 1200, vcpu: 8, ramGB: 16, storageGB: 250, awsInstanceType: "t3.2xlarge" },
];

// Seed default plans once, the first time the collection is empty.
// Cheap enough to check on every cold start; only actually writes once.
let plansSeeded = false;
async function ensurePlansSeeded() {
  if (plansSeeded) return;
  const existing = await rowsToRecords("plans");
  if (existing.length === 0) {
    const batch = firestore.batch();
    for (const plan of DEFAULT_PLANS) {
      batch.set(firestore.collection("plans").doc(plan.id), plan);
    }
    await batch.commit();
  }
  plansSeeded = true;
}

export const db = {
  async read() {
    await ensurePlansSeeded();
    const out = {};
    for (const name of COLLECTIONS) out[name] = await rowsToRecords(name);
    return out;
  },

  async find(collection, predicate) {
    if (collection === "plans") await ensurePlansSeeded();
    const records = await rowsToRecords(collection);
    return records.find(predicate);
  },

  async filter(collection, predicate) {
    if (collection === "plans") await ensurePlansSeeded();
    const records = await rowsToRecords(collection);
    return records.filter(predicate);
  },

  async insert(collection, record) {
    await firestore.collection(collection).doc(record.id).set(record);
    return record;
  },

  async update(collection, predicate, patch) {
    const records = await rowsToRecords(collection);
    const existing = records.find(predicate);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    await firestore.collection(collection).doc(updated.id).set(updated);
    return updated;
  },
};
