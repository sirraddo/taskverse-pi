// Pure helpers (tested in test/): uptime history, login cookies, escaping.
const crypto = require('crypto');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LAGOS = 3_600_000;
const hourKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 13); // UTC hour
const dayKey = (t = Date.now()) => new Date(t + LAGOS).toISOString().slice(0, 10); // Lagos day

/** Records one check. history[id] = { hours: { 'YYYY-MM-DDTHH': [ok, total] }, ... } (90 days kept). */
function recordCheck(state, id, ok, now = Date.now()) {
  const h = (state.history[id] ||= { hours: {} });
  const k = hourKey(now);
  const b = (h.hours[k] ||= [0, 0]);
  b[0] += ok ? 1 : 0; b[1] += 1;
  const cutoff = hourKey(now - 90 * 86_400_000);
  for (const key of Object.keys(h.hours)) if (key < cutoff) delete h.hours[key];
}

/** Uptime % over the last `hours` hours (null when there is no data yet). */
function uptime(state, id, hours, now = Date.now()) {
  const h = state.history[id]?.hours || {};
  const from = hourKey(now - hours * 3_600_000);
  let ok = 0, total = 0;
  for (const [k, [o, t]] of Object.entries(h)) if (k > from) { ok += o; total += t; }
  return total ? (ok / total) * 100 : null;
}

/** Per Lagos day for the last `days` days: { day, pct|null } oldest first. */
function dailyBars(state, ids, days, now = Date.now()) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push({ day: dayKey(now - i * 86_400_000), ok: 0, total: 0 });
  const idx = Object.fromEntries(out.map((d, i) => [d.day, i]));
  for (const id of ids) {
    for (const [k, [o, t]] of Object.entries(state.history[id]?.hours || {})) {
      const i = idx[dayKey(Date.parse(k + ':00:00Z'))];
      if (i !== undefined) { out[i].ok += o; out[i].total += t; }
    }
  }
  return out.map((d) => ({ day: d.day, pct: d.total ? (d.ok / d.total) * 100 : null }));
}

/** Applies a check result to the live state; returns 'down' | 'up' when an alert should go out. */
function applyResult(state, id, ok, detail, now = Date.now()) {
  const s = (state.live[id] ||= { status: 'unknown', fails: 0, since: now });
  recordCheck(state, id, ok, now);
  s.lastCheck = now; s.detail = detail;
  if (ok) {
    s.fails = 0;
    if (s.status !== 'up') {
      const wasDown = s.status === 'down';
      if (wasDown) closeIncident(state, id, now);
      s.status = 'up'; s.since = now;
      return wasDown ? 'up' : null;
    }
    return null;
  }
  s.fails += 1;
  if (s.status !== 'down' && s.fails >= 2) { // two failed checks in a row = down (one blip is ignored)
    s.status = 'down'; s.since = now;
    state.incidents.unshift({ id, start: now, end: null, detail });
    state.incidents = state.incidents.slice(0, 50);
    return 'down';
  }
  return null;
}
function closeIncident(state, id, now) {
  const inc = state.incidents.find((i) => i.id === id && !i.end);
  if (inc) inc.end = now;
}

/* ---- owner login cookie: "<expiresMs>.<hmac>" ---- */
const sign = (secret, v) => crypto.createHmac('sha256', secret).update(v).digest('base64url');
function makeSession(secret, days = 7, now = Date.now()) { const exp = String(now + days * 86_400_000); return `${exp}.${sign(secret, exp)}`; }
function checkSession(secret, cookie, now = Date.now()) {
  const [exp, mac] = String(cookie || '').split('.');
  if (!exp || !mac || !/^\d+$/.test(exp) || Number(exp) < now) return false;
  const want = sign(secret, exp);
  return mac.length === want.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want));
}
function passwordOk(given, want) {
  if (!want || want.length < 10) return false;
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  return crypto.timingSafeEqual(a, b);
}
const cookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));


/* ---- alerts: only tell the owner when a kind of problem first appears ----
 * "3 customer(s) owed a refund (π2.0159)" and "4 customer(s) owed…" are the same kind (numbers ignored),
 * so the owner is told once; if it clears and comes back later, he is told again. */
const attentionKey = (group, text) => `${group}|${String(text).replace(/[\d.,]+/g, '#')}`;
function newAttention(state, perGroup, now = Date.now()) {
  state.seen ||= {};
  const current = new Set(), fresh = [];
  for (const [group, items] of Object.entries(perGroup)) {
    if (items === null) { for (const k of Object.keys(state.seen)) if (k.startsWith(group + '|')) current.add(k); continue; } // app not reachable: keep what we knew
    for (const a of items) {
      const k = attentionKey(group, a); current.add(k);
      if (!state.seen[k]) { state.seen[k] = now; fresh.push(`${group}: ${a}`); }
    }
  }
  for (const k of Object.keys(state.seen)) if (!current.has(k)) delete state.seen[k];
  return fresh;
}

/* ---- the 8am message about yesterday ---- */
const ngn = (n) => `₦${Math.round(Number(n) || 0).toLocaleString('en-NG')}`;
function dailySummary(day, snap, { uptimeByGroup = {}, incidents = 0, attention = [] } = {}) {
  const label = new Date(day + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const lines = [], short = [];
  if (!snap || !Object.keys(snap).length) {
    lines.push('No numbers were collected yesterday (the dashboard started later in the day).');
  } else {
    let total = 0, newUsers = 0;
    for (const [g, s] of Object.entries(snap)) {
      const t = s.today || {}; total += Number(t.salesNGN) || 0; newUsers += Number(s.users?.newToday) || 0;
      const bits = [];
      if (t.orders !== undefined) bits.push(`${t.orders} order${t.orders === 1 ? '' : 's'}`);
      if (t.salesNGN !== undefined) bits.push(ngn(t.salesNGN));
      if (t.salesPi) bits.push(`π${t.salesPi}`);
      if (t.failed) bits.push(`${t.failed} failed`);
      if (t.fundedNGN) bits.push(`${ngn(t.fundedNGN)} wallets funded`);
      if (t.approved !== undefined) bits.push(`${t.approved} task${t.approved === 1 ? '' : 's'} approved`);
      if (t.feesPi) bits.push(`π${t.feesPi} fees`);
      if (s.users?.newToday) bits.push(`+${s.users.newToday} user${s.users.newToday === 1 ? '' : 's'}`);
      lines.push(`${g}: ${bits.join(' · ') || 'no activity'}`);
    }
    lines.unshift(`Sales: ${ngn(total)} · New users: ${newUsers}`);
    short.push(`Sales ${ngn(total)}`, `${newUsers} new user${newUsers === 1 ? '' : 's'}`);
  }
  const ups = Object.entries(uptimeByGroup).filter(([, v]) => v !== null);
  const down = ups.filter(([, v]) => v < 99.9);
  const upLine = !ups.length ? '' : down.length ? `Uptime: ${down.map(([g, v]) => `${g} ${v.toFixed(1)}%`).join(', ')} (others 100%)` : 'Uptime: all apps 100%';
  if (upLine) lines.push(upLine + (incidents ? ` · ${incidents} incident${incidents === 1 ? '' : 's'}` : ''));
  if (down.length) short.push(`${down.length} app${down.length === 1 ? '' : 's'} had downtime`);
  if (attention.length) { lines.push('', 'Needs attention now:', ...attention.map((a) => `• ${a}`)); short.push(`${attention.length} thing${attention.length === 1 ? ' needs' : 's need'} attention`); }
  return { title: `Yesterday (${label})`, body: short.join(' · ') || 'Quiet day', text: lines.join('\n') };
}

module.exports = { attentionKey, newAttention, dailySummary, esc, hourKey, dayKey, recordCheck, uptime, dailyBars, applyResult, makeSession, checkSession, passwordOk, cookies };
