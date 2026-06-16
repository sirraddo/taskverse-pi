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
    const { data } = await serverClient.post(`/payments/${paymentId}/cancelled`);
    return data;
  } catch (e) {
    console.error('cancelPayment failed (may already be cancelled):', e.message);
    return null;
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

export async function getIncompleteServerPayments() {
  const sdk = getPiSdk();
  if (!sdk) return [];
  return sdk.getIncompleteServerPayments();
}
