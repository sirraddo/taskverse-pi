/**
 * SIRRADDO owner hub — one small server on the VPS:
 *   /            public status page (are the apps up? uptime, incidents, maintenance notice)
 *   /api/status  the same as JSON
 *   /owner       private owner dashboard (password): today's numbers from Zappi NG, TaskVerse and ZAPPI PAY,
 *                balances, what needs attention, and the maintenance notice
 *   /health      for the VPS monitor
 *
 * Settings (.env): OWNER_PASSWORD (10+ chars), SESSION_SECRET, OWNER_KEY (same value as in the three apps),
 * optional RESEND_API_KEY + ALERT_EMAIL (+ EMAIL_FROM) for "app down / back up" emails.
 * No database: history lives in data/state.json (90 days).
 */
require('fs').existsSync(__dirname + '/.env') && require('fs').readFileSync(__dirname + '/.env', 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
});
const http = require('http');
const fs = require('fs');
const path = require('path');
const SERVICES = require('./services');
const { esc, uptime, dailyBars, applyResult, makeSession, checkSession, passwordOk, cookies } = require('./lib');

const PORT = Number(process.env.PORT || 4103);
const DATA = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA, 'state.json');
const CHECK_EVERY = Number(process.env.CHECK_EVERY_MS || 60_000);
const SECRET = process.env.SESSION_SECRET || '';

/* ---------------- state ---------------- */
let state = { history: {}, live: {}, incidents: [], notice: '' };
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch { /* first run */ }
function save() {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(state));
  fs.renameSync(STATE_FILE + '.tmp', STATE_FILE);
}

/* ---------------- checks ---------------- */
async function checkOne(svc) {
  const t0 = Date.now();
  try {
    const r = await fetch(svc.url, { signal: AbortSignal.timeout(15_000), redirect: 'follow', headers: { 'user-agent': 'sirraddo-status/1.0' } });
    if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
    if (svc.expect) {
      const j = await r.json().catch(() => null);
      if (!svc.expect(j)) return { ok: false, detail: j && j.db === 'disconnected' ? 'database not connected' : 'unexpected reply' };
    }
    return { ok: true, detail: `${Date.now() - t0} ms` };
  } catch (e) {
    return { ok: false, detail: e.name === 'TimeoutError' ? 'no answer in 15 s' : (e.cause?.code || e.message) };
  }
}

async function sendEmail(subject, text) {
  const key = process.env.RESEND_API_KEY, to = process.env.ALERT_EMAIL;
  if (!key || !to) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM || 'SIRRADDO Status <onboarding@resend.dev>', to: to.split(',').map((s) => s.trim()), subject, text }),
    });
  } catch (e) { console.error('alert email failed:', e.message); }
}

let checking = false;
async function runChecks() {
  if (checking) return; checking = true;
  try {
    const results = await Promise.all(SERVICES.map(async (s) => [s, await checkOne(s)]));
    for (const [svc, r] of results) {
      const change = applyResult(state, svc.id, r.ok, r.detail);
      if (change === 'down') sendEmail(`🔴 ${svc.name} is down`, `${svc.name} has failed two checks in a row (${r.detail}).\n${svc.url}\n\nStatus page: https://status.sirraddo.com.ng`);
      if (change === 'up') sendEmail(`🟢 ${svc.name} is back up`, `${svc.name} is answering again.\n\nStatus page: https://status.sirraddo.com.ng`);
    }
    save();
  } catch (e) { console.error('checks failed:', e.message); }
  finally { checking = false; }
}

/* ---------------- views ---------------- */
const BRAND = '<span class="logo">SI<b>RR</b>A<b>DD</b>O</span>';
const CSS = `
*{box-sizing:border-box}body{margin:0;font:15px/1.5 -apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;background:#F5F7FB;color:#13254F}
header{background:#13254F;color:#fff;padding:18px 16px}header .w,main{max-width:760px;margin:0 auto}
.logo{font-weight:900;letter-spacing:-.5px;font-size:22px}.logo b{color:#D9A21B;font-weight:900}
header small{display:block;opacity:.8;font-size:13px}main{padding:16px}
.card{background:#fff;border-radius:14px;padding:14px 16px;margin:0 0 12px;box-shadow:0 1px 3px rgba(19,37,79,.08)}
.row{display:flex;justify-content:space-between;gap:10px;align-items:center}.muted{color:#5b6b8c;font-size:13px}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle}
.up{background:#16a34a}.down{background:#dc2626}.unknown{background:#9ca3af}
.bars{display:flex;gap:2px;margin-top:8px}.bars i{flex:1;height:26px;border-radius:2px;background:#e5e7eb}
.b-ok{background:#16a34a!important}.b-mid{background:#f59e0b!important}.b-bad{background:#dc2626!important}
.notice{background:#FFF7E0;border:1px solid #D9A21B;border-radius:12px;padding:12px 14px;margin-bottom:12px}
.big{font-size:20px;font-weight:800}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:8px}
.grid div{background:#F5F7FB;border-radius:10px;padding:8px 10px}.grid span{display:block;font-size:12px;color:#5b6b8c}
ul{margin:6px 0 0;padding-left:18px}input,textarea,button{font:inherit}input,textarea{width:100%;padding:10px;border:1px solid #cbd3e3;border-radius:10px}
button{background:#13254F;color:#fff;border:0;border-radius:10px;padding:10px 14px;font-weight:700}button.ghost{background:#fff;color:#13254F;border:1px solid #13254F}
h2{font-size:16px;margin:18px 0 8px}a{color:#13254F}.warn{color:#b45309}.bad{color:#b91c1c}`;
const page = (title, body, { refresh } = {}) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh ? `<meta http-equiv="refresh" content="${refresh}">` : ''}<title>${esc(title)}</title><meta name="theme-color" content="#13254F"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/favicon.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="SIRRADDO"><style>${CSS}</style></head><body>${body}<script src="/app.js" defer></script></body></html>`;
const fmtTime = (t) => t ? new Date(t).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const pct = (v) => (v === null ? '—' : `${v >= 99.995 ? '100' : v.toFixed(2)}%`);
const dur = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} days`; };

function groups() {
  const g = {};
  for (const s of SERVICES) (g[s.group] ||= []).push(s);
  return Object.entries(g).map(([name, svcs]) => {
    const statuses = svcs.map((s) => state.live[s.id]?.status || 'unknown');
    const status = statuses.includes('down') ? 'down' : statuses.every((x) => x === 'up') ? 'up' : 'unknown';
    const ids = svcs.map((s) => s.id);
    const avg = (h) => { const v = ids.map((id) => uptime(state, id, h)).filter((x) => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    return { name, status, svcs, up24: avg(24), up30: avg(24 * 30), bars: dailyBars(state, ids, 30) };
  });
}

function statusPage() {
  const gs = groups();
  const allUp = gs.every((g) => g.status === 'up');
  const anyDown = gs.some((g) => g.status === 'down');
  const head = anyDown ? '<span class="dot down"></span>Some services are having problems' : allUp ? '<span class="dot up"></span>All services are working' : '<span class="dot unknown"></span>Checking services…';
  const cards = gs.map((g) => `<div class="card"><div class="row"><b><span class="dot ${g.status}"></span>${esc(g.name)}</b><span class="muted">${g.status === 'up' ? 'Working' : g.status === 'down' ? 'Problem' : 'Checking'}</span></div>
    <div class="bars" aria-label="Last 30 days">${g.bars.map((b) => `<i title="${esc(b.day)}: ${pct(b.pct)}" class="${b.pct === null ? '' : b.pct >= 99.5 ? 'b-ok' : b.pct >= 95 ? 'b-mid' : 'b-bad'}"></i>`).join('')}</div>
    <div class="row muted" style="margin-top:4px;font-size:12px"><span>30 days ago</span><span>Today</span></div>
    <div class="muted">Uptime: last 24 h ${pct(g.up24)} · last 30 days ${pct(g.up30)}</div></div>`).join('');
  const names = Object.fromEntries(SERVICES.map((s) => [s.id, s.name]));
  const inc = state.incidents.slice(0, 6).map((i) => `<li>${esc(names[i.id] || i.id)}: ${fmtTime(i.start)}${i.end ? ` · back after ${dur(i.end - i.start)}` : ' · <b class="bad">ongoing</b>'}</li>`).join('');
  return page('SIRRADDO status', `<header><div class="w">${BRAND}<small>Service status · Zappi NG · TaskVerse · ZAPPI PAY</small></div></header><main>
    ${state.notice ? `<div class="notice"><b>Notice:</b> ${esc(state.notice)}</div>` : ''}
    <div class="card big">${head}</div>${cards}
    <h2>Recent incidents</h2><div class="card">${inc ? `<ul>${inc}</ul>` : '<span class="muted">No incidents recorded.</span>'}</div>
    <p class="muted">Checked every minute. Last check ${fmtTime(Math.max(0, ...Object.values(state.live).map((l) => l.lastCheck || 0)))} (Lagos time). This page refreshes itself.</p></main>`, { refresh: 60 });
}

async function fetchSummary(svc) {
  try {
    const r = await fetch(svc.summary, { signal: AbortSignal.timeout(10_000), headers: { 'x-owner-key': process.env.OWNER_KEY || '' } });
    if (r.status === 404) return { error: 'Not switched on in this app yet (OWNER_KEY missing there)' };
    if (r.status === 401) return { error: 'The key does not match (OWNER_KEY differs)' };
    if (!r.ok) return { error: `HTTP ${r.status}` };
    return await r.json();
  } catch (e) { return { error: e.name === 'TimeoutError' ? 'no answer in 10 s' : e.message }; }
}

const naira = (n) => (n === null || n === undefined ? '—' : `₦${Math.round(Number(n)).toLocaleString('en-NG')}`);
function summaryCard(svc, s) {
  const live = state.live[svc.id]?.status || 'unknown';
  if (s.error) return `<div class="card"><div class="row"><b><span class="dot ${live}"></span>${esc(svc.group)}</b></div><p class="warn">${esc(s.error)}</p></div>`;
  const t = s.today || {}, cells = [];
  if (t.orders !== undefined) cells.push(['Orders today', t.orders]);
  if (t.salesNGN !== undefined) cells.push(['Sales today', naira(t.salesNGN)]);
  if (t.salesPi !== undefined) cells.push(['Paid in Pi', `π${t.salesPi}`]);
  if (t.failed !== undefined) cells.push(['Failed today', t.failed]);
  if (t.fundedNGN !== undefined) cells.push(['Wallets funded', naira(t.fundedNGN)]);
  if (t.approved !== undefined) cells.push(['Tasks approved', t.approved]);
  if (t.feesPi !== undefined) cells.push(['Fees earned', `π${t.feesPi}`]);
  if (t.liveTasks !== undefined) cells.push(['Live tasks', t.liveTasks]);
  cells.push(['Users', `${s.users?.total ?? '—'} (+${s.users?.newToday ?? 0} today)`]);
  if (s.balances?.vtpassNGN !== undefined) cells.push(['VTpass balance', naira(s.balances.vtpassNGN)]);
  if (s.payouts) cells.push(['Payouts waiting', `${s.payouts.pending} (π${Number(s.payouts.pendingPi).toFixed(2)})`]);
  const att = (s.attention || []).map((a) => `<li>${esc(a)}</li>`).join('');
  return `<div class="card"><div class="row"><b><span class="dot ${live}"></span>${esc(svc.group)}</b><span class="muted">${fmtTime(s.at)}</span></div>
    <div class="grid">${cells.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
    ${att ? `<div style="margin-top:10px"><b class="warn">Needs attention</b><ul>${att}</ul></div>` : '<p class="muted" style="margin:10px 0 0">Nothing needs attention.</p>'}</div>`;
}

async function ownerPage() {
  const withSummary = SERVICES.filter((s) => s.summary);
  const sums = await Promise.all(withSummary.map(fetchSummary));
  const down = SERVICES.filter((s) => state.live[s.id]?.status === 'down');
  const total = sums.reduce((a, s) => a + (s.today?.salesNGN || 0), 0);
  return page('Owner dashboard · SIRRADDO', `<header><div class="w">${BRAND}<small>Owner dashboard · ${fmtTime(Date.now())}</small></div></header><main>
    <div class="card"><div class="row"><div><span class="muted">Sales today (all apps)</span><div class="big">${naira(total)}</div></div>
    <div style="text-align:right">${down.length ? `<b class="bad">${down.length} service(s) down</b><div class="muted">${down.map((d) => esc(d.name)).join(', ')}</div>` : '<b style="color:#16a34a">All services up</b>'}<div class="muted"><a href="/">Status page</a></div></div></div></div>
    ${withSummary.map((svc, i) => summaryCard(svc, sums[i])).join('')}
    <h2>Notice on the status page</h2><form class="card" method="post" action="/owner/notice"><textarea name="notice" rows="2" maxlength="300" placeholder="e.g. Zappi NG is being updated, back by 9pm">${esc(state.notice)}</textarea><div class="row" style="margin-top:8px"><span class="muted">Leave empty to remove it.</span><button>Save notice</button></div></form>
    <button id="install" hidden style="width:100%;margin-top:4px">📲 Install as an app</button>
    <form method="post" action="/owner/logout" style="margin-top:12px"><button class="ghost">Log out</button> <a href="/owner" style="margin-left:10px">Refresh</a></form>
    ${!process.env.RESEND_API_KEY || !process.env.ALERT_EMAIL ? '<p class="muted">Down/up emails are off (add RESEND_API_KEY and ALERT_EMAIL to turn them on).</p>' : ''}</main>`);
}

const loginPage = (msg) => page('Owner login · SIRRADDO', `<header><div class="w">${BRAND}<small>Owner dashboard</small></div></header><main><form class="card" method="post" action="/owner/login" style="max-width:380px;margin:30px auto">
  <label for="p"><b>Password</b></label><input id="p" type="password" name="password" autocomplete="current-password" autofocus required style="margin:8px 0 12px">
  ${msg ? `<p class="bad">${esc(msg)}</p>` : ''}<button style="width:100%">Log in</button></form></main>`);

/* ---------------- http ---------------- */
// Files that make the owner dashboard installable as an app on the phone.
const STATIC = {
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json', 'no-cache'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8', 'no-cache'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8', 'no-cache'],
  '/icon-192.png': ['icon-192.png', 'image/png', 'public, max-age=604800'],
  '/icon-512.png': ['icon-512.png', 'image/png', 'public, max-age=604800'],
  '/icon-maskable-512.png': ['icon-maskable-512.png', 'image/png', 'public, max-age=604800'],
  '/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png', 'public, max-age=604800'],
  '/favicon.png': ['favicon.png', 'image/png', 'public, max-age=604800'],
};
const attempts = new Map();
const tooMany = (ip) => { const now = Date.now(); const a = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60_000); attempts.set(ip, a); return a.length >= 5; };
const readForm = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 4000) req.destroy(); }); req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(b)))); });
const SEC = { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; img-src 'self'; manifest-src 'self'; worker-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };
function send(res, code, body, type = 'text/html; charset=utf-8', extra = {}) { res.writeHead(code, { 'Content-Type': type, ...SEC, ...extra }); res.end(body); }
const authed = (req) => SECRET.length >= 16 && checkSession(SECRET, cookies(req).oh);
const COOKIE = (v, maxAge) => `oh=${v}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  try {
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, '{"ok":true}', 'application/json');
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const [file, type, cache] = STATIC[url.pathname];
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'public', file)), type, { 'Cache-Control': cache });
    }
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, statusPage(), undefined, { 'Cache-Control': 'no-store' });
    if (req.method === 'GET' && url.pathname === '/api/status') {
      return send(res, 200, JSON.stringify({ notice: state.notice || null, groups: groups().map((g) => ({ name: g.name, status: g.status, uptime24h: g.up24, uptime30d: g.up30 })) }), 'application/json', { 'Cache-Control': 'no-store' });
    }
    if (url.pathname === '/owner' && req.method === 'GET') {
      if (!process.env.OWNER_PASSWORD || SECRET.length < 16) return send(res, 503, loginPage('The owner page is not set up yet (OWNER_PASSWORD and SESSION_SECRET).'));
      return authed(req) ? send(res, 200, await ownerPage(), undefined, { 'Cache-Control': 'no-store' }) : send(res, 200, loginPage());
    }
    if (url.pathname === '/owner/login' && req.method === 'POST') {
      if (tooMany(ip)) return send(res, 429, loginPage('Too many tries. Wait 15 minutes.'));
      const f = await readForm(req);
      if (SECRET.length >= 16 && passwordOk(f.password, process.env.OWNER_PASSWORD)) {
        attempts.delete(ip);
        return send(res, 303, '', undefined, { Location: '/owner', 'Set-Cookie': COOKIE(makeSession(SECRET, 30), 30 * 86400) });
      }
      attempts.get(ip).push(Date.now());
      return send(res, 401, loginPage('Wrong password.'));
    }
    if (url.pathname === '/owner/logout' && req.method === 'POST') return send(res, 303, '', undefined, { Location: '/owner', 'Set-Cookie': COOKIE('', 0) });
    if (url.pathname === '/owner/notice' && req.method === 'POST') {
      if (!authed(req)) return send(res, 303, '', undefined, { Location: '/owner' });
      const f = await readForm(req);
      state.notice = String(f.notice || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      save();
      return send(res, 303, '', undefined, { Location: '/owner' });
    }
    send(res, 404, page('Not found', '<main><p>Not found. <a href="/">Status page</a></p></main>'));
  } catch (e) {
    console.error(e);
    send(res, 500, page('Error', '<main><p>Something went wrong.</p></main>'));
  }
});

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => console.log(`owner-hub on 127.0.0.1:${PORT}`));
  runChecks();
  setInterval(runChecks, CHECK_EVERY).unref?.();
}
module.exports = { server, runChecks, _state: () => state, _setState: (s) => { state = s; } };
