/**
 * piClient.js — the only frontend module that touches window.Pi.
 * Prerequisite: index.html loads https://sdk.minepi.com/pi-sdk.js
 */

const API = import.meta.env.VITE_API_URL || 'https://taskverse-pi-backend.onrender.com';
let sessionToken = null;

export const getSessionToken = () => sessionToken;

async function api(path, body, method) {
  const res = await fetch(`${API}${path}`, {
    method: method || (body ? 'POST' : 'GET'),
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
export const setMyCountry = (country) => api('/api/me/country', { country }, 'PATCH');
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

// Support: read-only payment lookup + payout wallet overview
export const fetchWorkerPaymentLookup = (q) => api(`/api/admin/worker-payment-lookup?q=${encodeURIComponent(q)}`);
export const fetchWalletOverview = () => api('/api/admin/wallet-overview');

/**
 * Flush backlogged A2U payouts. Fail-safe by design:
 *  - {}                      → dry-run preview, pays nothing
 *  - { submissionId }        → pays exactly that one submission
 *  - { limit: N }            → pays at most N from the unpaid queue
 */
export const reconcileA2U = (opts = {}) => api('/api/admin/reconcile-a2u', opts);
export const fetchUnpayableSubmissions = () => api('/api/admin/unpayable-submissions');
export const reconcileConsolidated = (opts = {}) => api('/api/admin/reconcile-consolidated', opts);

/* ── Avatars ──
 * Pictures are resized + compressed in the browser BEFORE upload (see
 * resizeImageToDataUrl below), so what reaches the server is a small
 * JPEG data URL rather than a multi-megabyte camera photo.
 */
export const uploadAvatar = (avatar) => api('/api/me/avatar', { avatar }, 'PUT');
export const deleteAvatar = () => api('/api/me/avatar', undefined, 'DELETE');
export const fetchAvatar = (piUid) => api(`/api/avatar/${encodeURIComponent(piUid)}`);
export const adminRemoveAvatar = (piUid, unblock = false) =>
  api('/api/admin/avatar-remove', { piUid, unblock });

/**
 * Read a File, downscale it to fit `max`x`max`, centre-crop to a square,
 * and return a compressed JPEG data URL.
 * This is what keeps avatars ~30-50KB instead of several megabytes.
 */
export function resizeImageToDataUrl(file, max = 256, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      return reject(new Error('Please choose an image file.'));
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a valid image.'));
      img.onload = () => {
        try {
          // Centre-crop to a square so avatars are never stretched.
          const side = Math.min(img.width, img.height);
          const sx = (img.width - side) / 2;
          const sy = (img.height - side) / 2;

          const canvas = document.createElement('canvas');
          canvas.width = max;
          canvas.height = max;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, sx, sy, side, side, 0, 0, max, max);

          // JPEG keeps it small. (No SVG/PNG-with-alpha needed for avatars.)
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (e) {
          reject(new Error('Could not process that image.'));
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ── Proof screenshots (self-hosted) ──
 * Previously these went to ImgBB using a VITE_ API key, which is baked into
 * the public bundle (readable by anyone) and made the whole proof pipeline
 * depend on a third party. Now the image is compressed in-browser and posted
 * to our own backend, which returns an opaque "local:<id>" reference.
 */
export const uploadProofImage = (image, taskId) =>
  api('/api/proof-image', { image, taskId });

/**
 * Load a proof screenshot for display.
 * The endpoint is auth-gated, and <img src> cannot send an Authorization
 * header — so we fetch the bytes with the header and hand back an object URL.
 * (Putting the session token in a query string would leak it into server logs.)
 * Remember to URL.revokeObjectURL() when done.
 */
export async function loadProofImage(ref) {
  if (!ref || ref === 'expired') return '';
  const m = /^local:([a-f0-9]{24})$/i.exec(String(ref));
  if (!m) return String(ref); // legacy ImgBB URL from older submissions
  const res = await fetch(`${API}/api/proof-image/${m[1]}`, {
    headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {},
  });
  if (!res.ok) throw new Error('Could not load screenshot');
  return URL.createObjectURL(await res.blob());
}
