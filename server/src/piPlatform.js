import axios from 'axios';
import PiNetworkPkg from 'pi-backend';
const PiNetwork = PiNetworkPkg.default ?? PiNetworkPkg;

const BASE = process.env.PI_PLATFORM_API_URL || 'https://api.minepi.com/v2';

const serverClient = axios.create({
  baseURL: BASE,
  timeout: 20_000,
  headers: { Authorization: `Key ${process.env.PI_API_KEY}` },
});

// pi-backend SDK handles A2U: create → sign → submit → complete
let piSdk = null;
function getPiSdk() {
  if (!piSdk && process.env.PI_API_KEY && process.env.PI_WALLET_SEED) {
    piSdk = new PiNetwork(process.env.PI_API_KEY, process.env.PI_WALLET_SEED);
  }
  return piSdk;
}

export async function verifyAccessToken(accessToken) {
  const { data } = await axios.get(`${BASE}/me`, {
    timeout: 15_000,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function approvePayment(paymentId) {
  const { data } = await serverClient.post(`/payments/${paymentId}/approve`);
  return data;
}

export async function completePayment(paymentId, txid) {
  const { data } = await serverClient.post(`/payments/${paymentId}/complete`, { txid });
  return data;
}

export async function cancelPayment(paymentId) {
  try {
    const { data } = await serverClient.post(`/payments/${paymentId}/cancel`);
    return data;
  } catch (e) {
    console.error('cancelPayment failed (may already be cancelled):', e.message);
    return null;
  }
}

// TEMP: verbose cancel — surfaces Pi's full error response for debugging.
export async function cancelPaymentVerbose(paymentId) {
  try {
    const { data } = await serverClient.post(`/payments/${paymentId}/cancel`);
    return { ok: true, data };
  } catch (e) {
    return {
      ok: false,
      httpStatus: e.response?.status ?? null,
      piBody: e.response?.data ?? null,
      message: e.message,
    };
  }
}

export async function getPayment(paymentId) {
  const { data } = await serverClient.get(`/payments/${paymentId}`);
  return data;
}

// A2U: uses pi-backend SDK for full create → blockchain submit → complete flow
export async function createA2UPayment({ uid, amountPi, memo, metadata }) {
  const sdk = getPiSdk();
  if (!sdk) throw new Error('PI_WALLET_SEED not configured — A2U disabled');

  // Step 1: Create payment on Pi Platform
  const paymentId = await sdk.createPayment({ amount: amountPi, memo, metadata, uid });

  // Step 2: Sign & submit to Pi blockchain
  const txid = await sdk.submitPayment(paymentId);

  // Step 3: Mark complete on Pi Platform
  const completed = await sdk.completePayment(paymentId, txid);

  return { identifier: paymentId, txid, completed };
}

/* ── Horizon (read-only blockchain reads) ────────────────────────
* Pi runs its own Horizon instance. Base verified empirically against
* testnet: https://api.testnet.minepi.com (/accounts/:pk returns the
* standard Stellar account shape; /transactions/:hash for tx lookup).
* These are READ-ONLY GETs — no seed, no signing, no fund movement.
*/
const HORIZON = (process.env.PI_HORIZON_URL || 'https://api.testnet.minepi.com').replace(/\/$/, '');

const horizonClient = axios.create({ baseURL: HORIZON, timeout: 15_000 });

// Account balance + sequence. Returns null if the account doesn't exist (404).
export async function getHorizonAccount(publicKey) {
  try {
    const { data } = await horizonClient.get(`/accounts/${publicKey}`);
    const native = (data.balances || []).find((b) => b.asset_type === 'native');
    return {
      accountId: data.account_id || publicKey,
      balancePi: native ? Number(native.balance) : 0,
      sequence: data.sequence,
      balances: data.balances || [],
    };
  } catch (e) {
    if (e.response && e.response.status === 404) return null;
    throw e;
  }
}

// Recent payments to/from an account (most recent first).
export async function getHorizonPayments(publicKey, limit = 10) {
  const { data } = await horizonClient.get(
    `/accounts/${publicKey}/payments`,
    { params: { order: 'desc', limit } },
  );
  const records = (data._embedded && data._embedded.records) || [];
  return records.map((r) => ({
    id: r.id,
    type: r.type,
    from: r.from,
    to: r.to,
    amount: r.amount,
    txHash: r.transaction_hash,
    createdAt: r.created_at,
  }));
}

// Single transaction by hash (txid). Returns null if not found on-chain (404).
export async function getHorizonTransaction(txid) {
  try {
    const { data } = await horizonClient.get(`/transactions/${txid}`);
    return {
      hash: data.hash,
      successful: data.successful,
      ledger: data.ledger,
      createdAt: data.created_at,
      sourceAccount: data.source_account,
      feeCharged: data.fee_charged,
    };
  } catch (e) {
    if (e.response && e.response.status === 404) return null;
    throw e;
  }
}

export async function getIncompleteServerPayments() {
  const sdk = getPiSdk();
  if (!sdk) return [];
  return sdk.getIncompleteServerPayments();
}
