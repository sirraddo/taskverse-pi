// Registers the service worker and shows an "Install app" button when the phone offers it.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
let deferred = null;
const btn = document.getElementById('install');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferred = e;
  if (btn) btn.hidden = false;
});
if (btn) btn.addEventListener('click', async () => {
  if (!deferred) return;
  deferred.prompt();
  await deferred.userChoice.catch(() => {});
  deferred = null; btn.hidden = true;
});
window.addEventListener('appinstalled', () => { if (btn) btn.hidden = true; });

// Phone alerts: ask permission, subscribe this phone, tell the server. Re-sent quietly on every visit.
const ab = document.getElementById('alerts');
const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
async function subscribe() {
  const { publicKey } = await (await fetch('/owner/push/key')).json();
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(publicKey) });
  const r = await fetch('/owner/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub) });
  if (!r.ok) throw new Error('server refused');
}
if (ab) (async () => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    ab.hidden = false; ab.disabled = true; ab.textContent = 'Install the app first, then alerts can be turned on'; return;
  }
  ab.hidden = false;
  if (Notification.permission === 'granted') {
    try { await subscribe(); ab.textContent = '🔔 Phone alerts are on'; ab.disabled = true; } catch { /* button stays */ }
  } else if (Notification.permission === 'denied') {
    ab.textContent = 'Alerts are blocked: allow notifications for this app in your phone settings'; ab.disabled = true;
  }
  ab.addEventListener('click', async () => {
    ab.disabled = true; ab.textContent = 'Turning on…';
    try {
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('Allow notifications to get alerts');
      await subscribe();
      ab.textContent = '🔔 Phone alerts are on';
    } catch (e) { ab.disabled = false; ab.textContent = '🔔 Turn on phone alerts (' + (e.message || 'try again') + ')'; }
  });
})();
