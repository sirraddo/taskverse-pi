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

module.exports = { esc, hourKey, dayKey, recordCheck, uptime, dailyBars, applyResult, makeSession, checkSession, passwordOk, cookies };
