// services/paymob.js
// ------------------------------------------------------------------
// Paymob is the payment aggregator most Egyptian businesses use to
// accept Vodafone Cash and InstaPay without building a direct
// integration with either — Paymob exposes one API for both as
// "mobile wallet" payments.
//
// Flow:
//  1. authenticate()        -> short-lived auth token
//  2. createOrder()         -> a Paymob order tied to our order id
//  3. createPaymentKey()    -> a token used to open the wallet payment
//  4. payWithWallet()       -> triggers the actual Vodafone Cash /
//                               InstaPay prompt on the customer's phone
//  5. Paymob calls our webhook when the customer confirms payment.
//     verifyWebhookSignature() checks that callback is genuinely from
//     Paymob before we provision anything.
// ------------------------------------------------------------------
import axios from "axios";
import crypto from "crypto";

const BASE_URL = "https://accept.paymob.com/api";

export async function authenticate() {
  const { data } = await axios.post(`${BASE_URL}/auth/tokens`, {
    api_key: process.env.PAYMOB_API_KEY,
  });
  return data.token;
}

export async function createOrder({ authToken, amountCents, merchantOrderId }) {
  const { data } = await axios.post(`${BASE_URL}/ecommerce/orders`, {
    auth_token: authToken,
    delivery_needed: false,
    amount_cents: amountCents,
    currency: "EGP",
    merchant_order_id: merchantOrderId,
    items: [],
  });
  return data;
}

export async function createPaymentKey({ authToken, order, amountCents, billingData }) {
  const { data } = await axios.post(`${BASE_URL}/acceptance/payment_keys`, {
    auth_token: authToken,
    amount_cents: amountCents,
    expiration: 3600,
    order_id: order.id,
    billing_data: billingData,
    currency: "EGP",
    integration_id: process.env.PAYMOB_INTEGRATION_ID_WALLET,
  });
  return data.token;
}

/**
 * Kicks off the actual wallet payment. Paymob sends a push/USSD prompt
 * to the customer's phone for them to confirm in their Vodafone Cash
 * or InstaPay app.
 */
export async function payWithWallet({ paymentToken, phoneNumber }) {
  const { data } = await axios.post(`${BASE_URL}/acceptance/payments/pay`, {
    source: { identifier: phoneNumber, subtype: "WALLET" },
    payment_token: paymentToken,
  });
  return data; // includes redirect/iframe info depending on wallet
}

/**
 * High-level helper combining the four calls above.
 */
export async function startWalletCheckout({ order, plan, phoneNumber, customer }) {
  const authToken = await authenticate();
  const amountCents = plan.priceEGP * 100;

  const paymobOrder = await createOrder({
    authToken,
    amountCents,
    merchantOrderId: order.id,
  });

  const paymentToken = await createPaymentKey({
    authToken,
    order: paymobOrder,
    amountCents,
    billingData: {
      first_name: customer.firstName || "NA",
      last_name: customer.lastName || "NA",
      email: customer.email,
      phone_number: phoneNumber,
      apartment: "NA",
      floor: "NA",
      street: "NA",
      building: "NA",
      city: "Cairo",
      country: "EG",
      state: "NA",
    },
  });

  const result = await payWithWallet({ paymentToken, phoneNumber });
  return result;
}

/**
 * Paymob signs webhook payloads with an HMAC — verify it before trusting
 * the callback and provisioning a server. Never skip this in production.
 * See Paymob docs for the exact field order used in the HMAC string;
 * this list follows their transaction-processed callback.
 */
export function verifyWebhookSignature(body, receivedHmac) {
  const orderedFields = [
    "amount_cents",
    "created_at",
    "currency",
    "error_occured",
    "has_parent_transaction",
    "id",
    "integration_id",
    "is_3d_secure",
    "is_auth",
    "is_capture",
    "is_refunded",
    "is_standalone_payment",
    "is_voided",
    "order.id",
    "owner",
    "pending",
    "source_data.pan",
    "source_data.sub_type",
    "source_data.type",
    "success",
  ];

  const getNested = (obj, path) =>
    path.split(".").reduce((o, k) => (o ? o[k] : undefined), obj);

  const concatenated = orderedFields.map((f) => String(getNested(body, f))).join("");
  const computed = crypto
    .createHmac("sha512", process.env.PAYMOB_HMAC_SECRET)
    .update(concatenated)
    .digest("hex");

  return computed === receivedHmac;
}
