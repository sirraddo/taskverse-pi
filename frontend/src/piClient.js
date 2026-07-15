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
  const auth = await window.Pi.authenticate(
    ['username', 'payments', 'wallet_address'],
    handleIncompletePayment
  );
  const { sessionToken: token, user } = await api('/api/auth/verify', {
    accessToken: auth.accessToken,
  });
  sessionToken = token;
  return user;
}

/**
 * Hand a stranded Pi payment back to our server so it can be completed (if it
 * actually went through on-chain) or cancelled (if it didn't).
 *
 * Pi refuses to create a NEW payment while an incomplete one exists for that
 * user. So if this isn't cleared, every retry fails — Pi's API returns
 * `payment_not_found` (HTTP 404) and the user is stuck permanently, with no way
 * to know that the fix is "clear browser data and log in again".
 *
 * This must therefore be passed to BOTH authenticate() and createPayment().
 * It was previously only on authenticate(), which is why a real user hit a
 * permanent wall on 2026-07-12.
 */
function handleIncompletePayment(payment) {
  return api('/api/payments/incomplete', { payment }).catch((e) => {
    console.error('Failed to clear incomplete payment:', e);
  });
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
        // Clear a stranded payment from a previous attempt so this one can
        // proceed, instead of Pi blocking every retry forever.
        onIncompletePaymentFound: handleIncompletePayment,
        onCancel: () => reject(new Error('Payment cancelled')),
        onError: (error) => reject(explainPaymentError(error)),
      }
    );
  });
}

/**
 * Turn Pi's raw payment errors into something a user can act on.
 * "Request failed with status code 404" tells them nothing; the real meaning is
 * usually "you have a stranded payment from a previous attempt".
 */
function explainPaymentError(error) {
  const msg = String(error?.message || error || '');
  const body = JSON.stringify(error?.response?.data || {});
  if (/payment_not_found|status code 404/i.test(msg + body)) {
    return new Error(
      'That payment could not be completed — you may have an unfinished payment from a previous attempt. ' +
      'Please close the app, reopen it, and try again. If it keeps failing, sign out and sign back in.'
    );
  }
  if (/insufficient|balance/i.test(msg + body)) {
    return new Error('Not enough Pi in your wallet to cover this payment.');
  }
  return error instanceof Error ? error : new Error(msg || 'Payment failed');
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

/**
 * Like resizeImageToDataUrl, but for proof screenshots rather than avatars:
 * fits within max dimensions preserving aspect ratio (no crop — the whole
 * frame matters for proof, unlike an avatar), and allows a bit more size
 * since detail needs to stay legible.
 */
export function resizeProofImageToDataUrl(file, maxDim = 1280, quality = 0.75) {
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
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
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

/* ── Announcements ── */
export const fetchAnnouncement = () => api('/api/announcement');
export const dismissAnnouncement = (id) => api(`/api/announcement/${id}/dismiss`, {});
export const fetchAdminAnnouncements = () => api('/api/admin/announcements');
export const createAnnouncement = (payload) => api('/api/admin/announcements', payload);
export const setAnnouncementActive = (id, active) =>
  api(`/api/admin/announcements/${id}`, { active }, 'PATCH');
export const deleteAnnouncement = (id) =>
  api(`/api/admin/announcements/${id}`, undefined, 'DELETE');

/* ── Banners (promo carousel, e.g. cross-promoting Zappi NG) ── */
export const fetchBanners = () => api('/api/banners');
export const fetchAdminBanners = () => api('/api/admin/banners');
export const createBanner = (payload) => api('/api/admin/banners', payload);
export const updateBanner = (id, patch) => api(`/api/admin/banners/${id}`, patch, 'PATCH');
export const deleteBanner = (id) => api(`/api/admin/banners/${id}`, undefined, 'DELETE');

/* ── Feature flags (emergency brake + maintenance mode) ── */
export const fetchFlags = () => api('/api/flags');
export const fetchAdminFlags = () => api('/api/admin/flags');
export const createFlag = (key) => api('/api/admin/flags', { key });
export const setFlagEnabled = (key, enabled) =>
  api(`/api/admin/flags/${encodeURIComponent(key)}`, { enabled }, 'PATCH');
export const deleteFlag = (key) =>
  api(`/api/admin/flags/${encodeURIComponent(key)}`, undefined, 'DELETE');

/* ── Platform settings (fee rate, reward/slot limits, auto-approve thresholds) ── */
export const fetchSettings = () => api('/api/settings');
export const fetchAdminSettings = () => api('/api/admin/settings');
export const updateSettings = (patch) => api('/api/admin/settings', patch, 'PATCH');

/* ── Admin: user list & search ── */
export const fetchAdminUsers = (q, page = 1, limit = 20) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (q) params.set('q', q);
  return api(`/api/admin/users?${params.toString()}`);
};
export const setUserBanned = (id, banned) => api(`/api/admin/users/${id}/ban`, { banned }, 'PATCH');

/* ── Admin: transactions (all Payment records, refId lookup) ── */
export const fetchAdminTransactions = (params = {}) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, v); });
  return api(`/api/admin/transactions?${q.toString()}`);
};

/* ── Support tickets (user-facing) ── */
export const fetchMyTickets = () => api('/api/support/tickets');
export const createTicket = (payload) => api('/api/support/tickets', payload);
export const fetchMyTicket = (id) => api(`/api/support/tickets/${id}`);
export const replyToTicket = (id, message) => api(`/api/support/tickets/${id}/reply`, { message });

/* ── Support tickets (admin) ── */
export const fetchAdminTickets = (params = {}) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, v); });
  return api(`/api/admin/support/tickets?${q.toString()}`);
};
export const fetchAdminTicket = (id) => api(`/api/admin/support/tickets/${id}`);
export const replyToTicketAsAdmin = (id, message) => api(`/api/admin/support/tickets/${id}/reply`, { message });
export const setTicketStatus = (id, status) => api(`/api/admin/support/tickets/${id}`, { status }, 'PATCH');
export const fetchAdminSupportUnreadCount = () => api('/api/admin/support/unread-count');

/* ── Admin: audit log ── */
export const fetchAdminAuditLog = (params = {}) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, v); });
  return api(`/api/admin/audit-log?${q.toString()}`);
};

/**
 * Like resizeImageToDataUrl, but fits/crops to a wide banner aspect ratio
 * (16:7 by default) instead of a square, and keeps a slightly larger JPEG
 * since these are full-width promo graphics rather than small avatars.
 */
export function resizeBannerImageToDataUrl(file, width = 960, height = 420, quality = 0.82) {
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
          // Cover-fit: crop to the target aspect ratio, then scale to fill.
          const targetRatio = width / height;
          const srcRatio = img.width / img.height;
          let sx, sy, sw, sh;
          if (srcRatio > targetRatio) {
            sh = img.height; sw = sh * targetRatio;
            sx = (img.width - sw) / 2; sy = 0;
          } else {
            sw = img.width; sh = sw / targetRatio;
            sx = 0; sy = (img.height - sh) / 2;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
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
