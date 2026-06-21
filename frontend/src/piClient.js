/**
 * piClient.js — the only frontend module that touches window.Pi.
 * Prerequisite: index.html loads https://sdk.minepi.com/pi-sdk.js
 */

const API = import.meta.env.VITE_API_URL || 'https://taskverse-pi-backend.onrender.com';
let sessionToken = null;

export const getSessionToken = () => sessionToken;

async function api(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Bypass-Tunnel-Reminder': 'true',
      'ngrok-skip-browser-warning': 'true',
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.reasons = data.reasons;
    throw err;
  }
  return data;
}

export function initPi() {
  if (!window.Pi) throw new Error('Pi SDK not loaded — open this app inside the Pi Browser.');
  window.Pi.init({ version: '2.0', sandbox: import.meta.env.VITE_PI_SANDBOX === 'true' });
}
/**
 * Open an external (non-TaskVerse) URL, e.g. a task's posted link.
 * Inside Pi Browser, app content is rendered in an iframe, so a plain
 * anchor with target=_blank can't reliably hand off to native apps via Android
 * App Links / iOS Universal Links - it can fall through to a generic
 * "open in store" resolution instead. Pi.openUrlInSystemBrowser() routes
 * the URL through the OS system browser, where App Link handoff works
 * normally (e.g. https://x.com/... opens directly in the X app).
 * Falls back to window.open for non-Pi-Browser contexts (e.g. local dev)
 * or older Pi Browser versions that don't support this SDK method.
 */
export async function openExternalLink(url) {
  if (window.Pi && typeof window.Pi.openUrlInSystemBrowser === 'function') {
    try {
      await window.Pi.openUrlInSystemBrowser(url);
      return;
    } catch (err) {
      console.warn('Pi.openUrlInSystemBrowser failed, falling back:', err?.message || err);
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
export async function authenticateWithPi() {
  initPi();
  const onIncompletePaymentFound = (payment) =>
    api('/api/payments/incomplete', { payment }).catch(console.error);
  const auth = await window.Pi.authenticate(['username', 'payments', 'wallet_address'], onIncompletePaymentFound);
  const { sessionToken: token, user } = await api('/api/auth/verify', {
    accessToken: auth.accessToken,
  });
  sessionToken = token;
  navigator.clipboard.writeText(token).then(
      () => alert('Token copied to clipboard!'),
      () => alert('Clipboard failed — token:\n' + token)
        );
  return user;
}

export function payForTaskFunding({ taskId, amountToPay, title }) {
  return new Promise((resolve, reject) => {
    window.Pi.createPayment(
      { amount: amountToPay, memo: `TaskVerse campaign: ${title}`.slice(0, 100), metadata: { taskId } },
      {
        onReadyForServerApproval: (paymentId) =>
          api('/api/payments/approve', { paymentId, taskId }).catch(reject),
        onReadyForServerCompletion: (paymentId, txid) =>
          api('/api/payments/complete', { paymentId, txid }).then(resolve).catch(reject),
        onCancel: () => reject(new Error('Payment cancelled')),
        onError: (error) => reject(error),
      }
    );
  });
}

/* ── Worker API ── */
export const createTask = (payload) => api('/api/tasks', payload);
export const fetchTasks = () => api('/api/tasks');
export const fetchMe = () => api('/api/me');
export const submitProof = (id, p) => api(`/api/tasks/${id}/submissions`, p);
export const fetchPayoutHistory= () => api('/api/me/history');
export const fetchLeaderboard = (period = 'week') => api(`/api/leaderboard?period=${period}`);
export const submitDisputeStatement = (id, statement) =>
  api(`/api/me/disputes/${id}/statement`, { statement });

/* ── Admin API ── */
export const fetchAdminQueue = () => api('/api/admin/queue');
export const approveSubmission= (id) => api(`/api/admin/submissions/${id}/approve`, {});
export const rejectSubmission = (id) => api(`/api/admin/submissions/${id}/reject`, {});
export const fetchDisputes = () => api('/api/admin/disputes');
export const resolveDispute = (id, d, note='')=> api(`/api/admin/disputes/${id}/resolve`, { decision: d, note });
export const fetchRevenue = () => api('/api/admin/revenue');
/** Create a sponsored task (goes live instantly, no Pi payment) */
export const createAdminTask = (payload) => api('/api/admin/tasks', payload);
/** Scan and complete any pending A2U payouts whose txid is now available */
export const reconcilePayouts = () => api('/api/admin/reconcile', {});
/** Cancel tasks that have been stuck in awaiting_funding longer than hoursOld (default 24) */
export const cancelStaleFunding = (hoursOld = 24) => api('/api/admin/cancel-stale-funding', { hoursOld });
