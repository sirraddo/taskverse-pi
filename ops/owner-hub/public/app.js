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
