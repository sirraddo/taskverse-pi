/**
 * piPlatform.js — the ONLY module that talks to the Pi Platform API.
 *
 * Two auth modes per Pi docs:
 *  - User-scoped endpoints (/me):       Authorization: Bearer <accessToken>
 *  - Server-scoped endpoints (payments): Authorization: Key <PI_API_KEY>
 */
import axios from 'axios';

const BASE = process.env.PI_PLATFORM_API_URL || 'https://api.minepi.com/v2';

const serverClient = axios.create({
  baseURL: BASE,
  timeout: 20_000,
  headers: { Authorization: `Key ${process.env.PI_API_KEY}` },
});

/**
 * Verify a client-supplied access token by asking Pi who it belongs to.
 * Throws if invalid/expired. Returns the canonical /me payload.
 * This is the trust boundary: client claims are ignored; this is truth.
 */
export async function verifyAccessToken(accessToken) {
  const { data } = await axios.get(`${BASE}/me`, {
    timeout: 15_000,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data; // { uid, username, ... }
}

/** U2A step 1 — server-side approval of a payment the client created. */
export async function approvePayment(paymentId) {
  const { data } = await serverClient.post(`/payments/${paymentId}/approve`);
  return data;
}

/** U2A step 2 — server-side completion once client reports the txid. */
export async function completePayment(paymentId, txid) {
  const { data } = await serverClient.post(`/payments/${paymentId}/complete`, { txid });
  return data;
}

/** Fetch the canonical payment record (use to verify amount/metadata). */
export async function getPayment(paymentId) {
  const { data } = await serverClient.get(`/payments/${paymentId}`);
  return data;
}

/** Cancel a stuck/abandoned payment. */
export async function cancelPayment(paymentId) {
  const { data } = await serverClient.post(`/payments/${paymentId}/cancelled`);
  return data;
}

/**
 * A2U — pay a worker from the app wallet. No approval step is needed
 * because the flow originates from the app, but it still must be
 * completed with the txid after the Pi server processes it.
 *
 * NOTE: depending on your stack you may prefer the official Pi backend
 * SDK (e.g. pi-backend for Node) which wraps payment creation, blockchain
 * submission and completion. This raw-API version follows the documented
 * create → (Pi handles tx) → complete sequence.
 */
export async function createA2UPayment({ uid, amountPi, memo, metadata }) {
  const { data } = await serverClient.post('/payments', {
    payment: { amount: amountPi, memo, metadata, uid },
  });
  return data; // contains identifier (paymentId)
}

export async function completeA2UPayment(paymentId, txid) {
  return completePayment(paymentId, txid);
}
