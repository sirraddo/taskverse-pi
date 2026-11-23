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
// Prefer IPv4: if the VPS has no working IPv6 route, Node may otherwise try IPv6 first and time out
// (e.g. reaching api.telegram.org).
require('dns').setDefaultResultOrder('ipv4first');
const http = require('http');
const fs = require('fs');
const path = require('path');
const SERVICES = require('./services');
const { esc, uptime, dailyBars, applyResult, makeSession, checkSession, passwordOk, cookies, dayKey, newAttention, dailySummary } = require('./lib');

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

/* ---------------- phone alerts (web push) ----------------
 * Keys are made on first start and kept in data/push.json with the phones that turned alerts on.
 * Sent: an app going down / coming back, a new kind of problem in "Needs attention", and the 8am summary. */
const PUSH_FILE = path.join(DATA, 'push.json');
let pushData = null;
function pushStore() {
  if (pushData) return pushData;
  try { pushData = JSON.parse(fs.readFileSync(PUSH_FILE, 'utf8')); } catch { pushData = { subs: [] }; }
  if (!pushData.vapid) { pushData.vapid = require('web-push').generateVAPIDKeys(); savePush(); }
  return pushData;
}
function savePush() {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(PUSH_FILE + '.tmp', JSON.stringify(pushData), { mode: 0o600 });
  fs.renameSync(PUSH_FILE + '.tmp', PUSH_FILE);
}
async function notifyAll(title, body, tag = 'sirraddo') {
  const st = pushStore();
  if (!st.subs.length) return 0;
  const wp = require('web-push');
  wp.setVapidDetails('mailto:' + (process.env.ALERT_EMAIL || 'info@sirraddo.com.ng').split(',')[0].trim(), st.vapid.publicKey, st.vapid.privateKey);
  let sent = 0; const keep = [];
  for (const sub of st.subs) {
    try { await wp.sendNotification(sub, JSON.stringify({ title, body: String(body).slice(0, 900), tag, url: '/owner' }), { TTL: 6 * 3600, urgency: 'high' }); sent++; keep.push(sub); }
    catch (e) { if (e.statusCode !== 404 && e.statusCode !== 410) keep.push(sub); else console.log('push: removed an old phone'); }
  }
  if (keep.length !== st.subs.length) { st.subs = keep; savePush(); }
  return sent;
}

/* ---------------- Telegram alerts (private bot) ----------------
 * TELEGRAM_BOT_TOKEN in .env. The owner links his Telegram from the Owner page (one-time code, 15 min);
 * only linked chats get alerts or answers. Commands: /status, /today. Linked chats: data/telegram.json. */
const TG_FILE = path.join(DATA, 'telegram.json');
let tg = null;
function tgStore() {
  if (tg) return tg;
  try { tg = JSON.parse(fs.readFileSync(TG_FILE, 'utf8')); } catch { tg = { chats: [], offset: 0 }; }
  return tg;
}
function saveTg() {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(TG_FILE + '.tmp', JSON.stringify(tg), { mode: 0o600 });
  fs.renameSync(TG_FILE + '.tmp', TG_FILE);
}
const tgOn = () => /^\d+:[\w-]{20,}$/.test(process.env.TELEGRAM_BOT_TOKEN || '');
async function tgCall(method, body, timeoutMs = 20_000) {
  const r = await fetch(`${process.env.TELEGRAM_API || 'https://api.telegram.org'}/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(timeoutMs),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw Object.assign(new Error(j.description || `Telegram HTTP ${r.status}`), { retryAfter: Number(j.parameters?.retry_after) || 0 });
  return j.result;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Telegram says "retry after N seconds" when it is busy: wait that long and try once more.
async function tgSay(chatId, text) {
  const body = { chat_id: chatId, text: String(text).slice(0, 4000), disable_web_page_preview: true };
  try { return await tgCall('sendMessage', body); }
  catch (e) { if (!e.retryAfter || e.retryAfter > 60) throw e; await sleep((e.retryAfter + 1) * 1000); return tgCall('sendMessage', body); }
}
async function tgSendAll(text) {
  if (!tgOn()) return 0;
  let n = 0;
  for (const c of [...tgStore().chats]) {
    try { await tgSay(c.id, text); n++; }
    catch (e) {
      console.error('telegram:', e.message);
      if (/blocked|chat not found|kicked|deactivated/i.test(e.message)) { tg.chats = tg.chats.filter((x) => x.id !== c.id); saveTg(); }
    }
  }
  return n;
}
let botName = null;
async function tgBotName() {
  if (!botName) botName = tgStore().botName || null;
  if (!botName) { botName = (await tgCall('getMe', {}, 30_000)).username; tg.botName = botName; saveTg(); }
  return botName;
}
const linkCodes = new Map(); // code -> expiry

function statusText() {
  const gs = groups();
  const lines = gs.map((g) => `${g.status === 'up' ? '🟢' : g.status === 'down' ? '🔴' : '⚪'} ${g.name}`);
  const att = state.lastAttention || [];
  return `SIRRADDO status\n${lines.join('\n')}${att.length ? `\n\nNeeds attention:\n${att.map((a) => '• ' + a).join('\n')}` : '\n\nNothing needs attention.'}`;
}
function todayText() {
  const m = dailySummary(dayKey(), state.days?.[dayKey()], { attention: state.lastAttention || [] });
  return `Today so far (updated every 5 min)\n${m.text}`;
}

async function tgHandle(u) {
  const msg = u.message; if (!msg || !msg.chat) return;
  const chatId = msg.chat.id, text = String(msg.text || '').trim();
  const st = tgStore();
  const linked = st.chats.some((c) => c.id === chatId);
  const m = text.match(/^\/start\s+([A-Za-z0-9]{10,40})$/);
  if (m) {
    const exp = linkCodes.get(m[1]);
    if (exp && exp > Date.now()) {
      linkCodes.delete(m[1]);
      if (!linked) { st.chats.push({ id: chatId, name: [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(' ') || msg.chat.title || '', at: Date.now() }); saveTg(); }
      return tgSay(chatId, '✅ Linked. You will get SIRRADDO alerts here and the summary every morning at 8:00.\n\nSend /status or /today any time.');
    }
    return tgSay(chatId, 'That link has expired. Open the Owner app and tap "Link Telegram" again.');
  }
  if (!linked) return tgSay(chatId, 'This is a private bot.');
  if (/^\/status\b/.test(text)) return tgSay(chatId, statusText());
  if (/^\/today\b/.test(text)) return tgSay(chatId, todayText());
  return tgSay(chatId, 'Send /status or /today.');
}

async function tgPollOnce(timeout = 25) {
  const st = tgStore();
  const updates = await tgCall('getUpdates', { offset: st.offset || 0, timeout, allowed_updates: ['message'] }, (timeout + 10) * 1000);
  for (const u of updates) {
    st.offset = u.update_id + 1;
    try { await tgHandle(u); } catch (e) { console.error('telegram reply:', e.message); }
  }
  if (updates.length) saveTg();
  return updates.length;
}
async function tgLoop() {
  while (tgOn()) {
    try { await tgPollOnce(); }
    catch (e) {
      console.error('telegram poll:', e.message);
      // Wait as long as Telegram asks (retrying sooner only extends the block), else 15 s.
      await sleep(e.retryAfter ? (e.retryAfter + 2) * 1000 : 15_000);
    }
  }
}

/** Every alert goes to the phone (web push) and to Telegram. */
async function alertAll(title, body, tag) {
  const [p, t] = await Promise.all([notifyAll(title, body, tag).catch(() => 0), tgSendAll(`${title}\n${body}`).catch(() => 0)]);
  return p + t;
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
      if (change === 'down') alertAll(`🔴 ${svc.name} is down`, `Failed two checks in a row (${r.detail}).`, 'down-' + svc.id);
      if (change === 'up') alertAll(`🟢 ${svc.name} is back up`, 'Answering again.', 'down-' + svc.id);
      if (change === 'down') sendEmail(`🔴 ${svc.name} is down`, `${svc.name} has failed two checks in a row (${r.detail}).\n${svc.url}\n\nStatus page: https://status.sirraddo.com.ng`);
      if (change === 'up') sendEmail(`🟢 ${svc.name} is back up`, `${svc.name} is answering again.\n\nStatus page: https://status.sirraddo.com.ng`);
    }
    save();
  } catch (e) { console.error('checks failed:', e.message); }
  finally { checking = false; }
}

/* ---------------- watching the apps' numbers ----------------
 * Every 5 minutes: read each app's summary, keep the latest numbers for each Lagos day (for the 8am message),
 * and alert when a new kind of problem shows up in "Needs attention". */
async function watchSummaries() {
  const svcs = SERVICES.filter((s) => s.summary);
  const sums = await Promise.all(svcs.map(fetchSummary));
  const day = dayKey();
  state.days ||= {}; state.days[day] ||= {};
  const perGroup = {};
  svcs.forEach((svc, i) => {
    const s = sums[i];
    if (s.error) { perGroup[svc.group] = null; return; }
    state.days[day][svc.group] = { today: s.today, users: s.users, payouts: s.payouts, balances: s.balances };
    perGroup[svc.group] = s.attention || [];
  });
  for (const d of Object.keys(state.days)) if (d < dayKey(Date.now() - 14 * 86_400_000)) delete state.days[d];
  const fresh = newAttention(state, perGroup);
  state.lastAttention = Object.entries(perGroup).flatMap(([g, items]) => (items || []).map((a) => `${g}: ${a}`));
  save();
  if (fresh.length) await alertAll(fresh.length === 1 ? '⚠️ Needs attention' : `⚠️ ${fresh.length} things need attention`, fresh.join('\n'), 'attention');
}

const lagosHour = () => new Date(Date.now() + 3_600_000).getUTCHours();
async function maybeDailySummary(force = false) {
  const today = dayKey();
  if (!force && (lagosHour() < 8 || state.lastDaily === today)) return null;
  const yesterday = dayKey(Date.now() - 86_400_000);
  const groupsList = groups();
  const uptimeByGroup = Object.fromEntries(groupsList.map((g) => { const b = dailyBars(state, g.svcs.map((s) => s.id), 2)[0]; return [g.name, b.pct]; }));
  const from = Date.parse(yesterday + 'T00:00:00Z') - 3_600_000, to = from + 86_400_000;
  const incidents = state.incidents.filter((i) => i.start >= from && i.start < to).length;
  const msg = dailySummary(yesterday, state.days?.[yesterday], { uptimeByGroup, incidents, attention: state.lastAttention || [] });
  if (!force) { state.lastDaily = today; save(); }
  await notifyAll('📊 ' + msg.title, msg.body, 'daily').catch(() => {});
  await tgSendAll(`📊 ${msg.title}\n${msg.text}`).catch(() => {});
  await sendEmail(`SIRRADDO daily summary · ${msg.title}`, `${msg.text}\n\nOwner dashboard: https://status.sirraddo.com.ng/owner`);
  return msg;
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
const page = (title, body, { refresh } = {}) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh ? `<meta http-equiv="refresh" content="${refresh}">` : ''}<title>${esc(title)}</title><meta name="theme-color" content="#13254F"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/favicon.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Owner"><style>${CSS}</style></head><body>${body}<script src="/app.js" defer></script></body></html>`;
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

async function ownerPage(url) {
  const withSummary = SERVICES.filter((s) => s.summary);
  const sums = await Promise.all(withSummary.map(fetchSummary));
  const down = SERVICES.filter((s) => state.live[s.id]?.status === 'down');
  const total = sums.reduce((a, s) => a + (s.today?.salesNGN || 0), 0);
  return page('Owner dashboard · SIRRADDO', `<header><div class="w">${BRAND}<small>Owner dashboard · ${fmtTime(Date.now())}</small></div></header><main>
    <div class="card"><div class="row"><div><span class="muted">Sales today (all apps)</span><div class="big">${naira(total)}</div></div>
    <div style="text-align:right">${down.length ? `<b class="bad">${down.length} service(s) down</b><div class="muted">${down.map((d) => esc(d.name)).join(', ')}</div>` : '<b style="color:#16a34a">All services up</b>'}<div class="muted"><a href="/">Status page</a></div></div></div></div>
    ${withSummary.map((svc, i) => summaryCard(svc, sums[i])).join('')}
    <h2>Notice on the status page</h2><form class="card" method="post" action="/owner/notice"><textarea name="notice" rows="2" maxlength="300" placeholder="e.g. Zappi NG is being updated, back by 9pm">${esc(state.notice)}</textarea><div class="row" style="margin-top:8px"><span class="muted">Leave empty to remove it.</span><button>Save notice</button></div></form>
    <h2>Phone alerts</h2><div class="card">
      <p class="muted" style="margin-top:0">Get a notification when an app goes down or comes back, when something new needs attention, and a summary of yesterday every morning at 8:00${process.env.RESEND_API_KEY && process.env.ALERT_EMAIL ? ' (also by email)' : ''}.</p>
      <button id="alerts" hidden style="width:100%">🔔 Turn on phone alerts</button>
      <div class="row" style="margin-top:8px;gap:8px">
        <form method="post" action="/owner/push/test" style="flex:1"><button class="ghost" style="width:100%">Send a test alert</button></form>
        <form method="post" action="/owner/push/daily" style="flex:1"><button class="ghost" style="width:100%">Send the daily summary now</button></form>
      </div>
      ${tgOn() ? `<a href="/owner/telegram/link" style="display:block;text-align:center;margin-top:8px;padding:10px;border-radius:10px;background:#229ED9;color:#fff;font-weight:700;text-decoration:none">✈️ ${tgStore().chats.length ? 'Link another Telegram' : 'Link Telegram'}</a><p class="muted" style="margin:6px 0 0">Telegram: ${tgStore().chats.length ? `${tgStore().chats.length} chat(s) linked (${esc(tgStore().chats.map((c) => c.name).filter(Boolean).join(', '))})` : 'not linked yet'}. In Telegram, send /status or /today any time.</p>` : '<p class="muted" style="margin:8px 0 0">Telegram alerts: add TELEGRAM_BOT_TOKEN to turn them on.</p>'}
      <p class="muted" style="margin-bottom:0">${pushStore().subs.length} phone(s) receiving app alerts.${url && url.searchParams.get('sent') !== null ? ` · Sent to ${esc(url.searchParams.get('sent'))}.` : ''}</p></div>
    <button id="install" hidden style="width:100%;margin-top:12px">📲 Install as an app</button>
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
const readBody = (req, max) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > max) req.destroy(); }); req.on('end', () => resolve(b)); });
const readForm = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 4000) req.destroy(); }); req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(b)))); });
const SEC = { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; img-src 'self'; manifest-src 'self'; worker-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };
function send(res, code, body, type = 'text/html; charset=utf-8', extra = {}) { res.writeHead(code, { 'Content-Type': type, ...SEC, ...extra }); res.end(body); }
const authed = (req) => SECRET.length >= 16 && checkSession(SECRET, cookies(req).oh);
// Lax (not Strict): when the installed app is opened from the home screen, Android starts it like a link from
// another app, and Chrome would hold back a Strict cookie on that first page, logging you out every time.
const COOKIE = (v, maxAge) => `oh=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

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
      return authed(req) ? send(res, 200, await ownerPage(url), undefined, { 'Cache-Control': 'no-store' }) : send(res, 200, loginPage());
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
    if (url.pathname.startsWith('/owner/push/') && !authed(req)) return send(res, 401, '{"error":"log in first"}', 'application/json');
    if (url.pathname === '/owner/push/key' && req.method === 'GET') return send(res, 200, JSON.stringify({ publicKey: pushStore().vapid.publicKey }), 'application/json', { 'Cache-Control': 'no-store' });
    if (url.pathname === '/owner/push/subscribe' && req.method === 'POST') {
      const raw = await readBody(req, 4000);
      let sub; try { sub = JSON.parse(raw); } catch { sub = null; }
      if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return send(res, 400, '{"error":"bad subscription"}', 'application/json');
      const st = pushStore();
      const isNew = !st.subs.some((x) => x.endpoint === sub.endpoint);
      st.subs = st.subs.filter((x) => x.endpoint !== sub.endpoint).concat([{ endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } }]).slice(-10);
      savePush();
      if (isNew) notifyAll('🔔 Alerts are on', 'You will be told here when something needs your attention.', 'welcome');
      return send(res, 200, '{"ok":true}', 'application/json');
    }
    if (url.pathname === '/owner/push/test' && req.method === 'POST') {
      const n = await alertAll('✅ Test alert', 'Alerts from the SIRRADDO Owner app work.', 'test');
      return send(res, 303, '', undefined, { Location: `/owner?sent=${n}` });
    }
    if (url.pathname === '/owner/push/daily' && req.method === 'POST') {
      await maybeDailySummary(true);
      return send(res, 303, '', undefined, { Location: `/owner?sent=${pushStore().subs.length}` });
    }
    if (url.pathname === '/owner/telegram/link' && req.method === 'GET') {
      if (!authed(req)) return send(res, 303, '', undefined, { Location: '/owner' });
      if (!tgOn()) return send(res, 400, page('Telegram', '<main><p>Telegram is not set up (TELEGRAM_BOT_TOKEN).</p><a href="/owner">Back</a></main>'));
      const code = require('crypto').randomBytes(12).toString('hex');
      linkCodes.set(code, Date.now() + 15 * 60_000);
      for (const [c, e] of linkCodes) if (e < Date.now()) linkCodes.delete(c);
      try { return send(res, 303, '', undefined, { Location: `https://t.me/${await tgBotName()}?start=${code}` }); }
      catch (e) { return send(res, 502, page('Telegram', `<main><p>Could not reach Telegram: ${esc(e.message)}</p><a href="/owner">Back</a></main>`)); }
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
  pushStore();
  runChecks();
  setInterval(() => { runChecks().then(() => maybeDailySummary()).catch((e) => console.error(e.message)); }, CHECK_EVERY).unref?.();
  if (tgOn()) tgLoop();
  setTimeout(() => watchSummaries().catch((e) => console.error('watch:', e.message)), 20_000);
  setInterval(() => watchSummaries().catch((e) => console.error('watch:', e.message)), 5 * 60_000).unref?.();
}
module.exports = { server, runChecks, watchSummaries, tgPollOnce, alertAll, tgStore, maybeDailySummary, notifyAll, pushStore, _state: () => state, _setState: (s) => { state = s; } };
