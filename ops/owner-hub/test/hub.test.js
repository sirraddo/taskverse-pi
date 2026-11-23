const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const L = require('../lib');

test('uptime: two failed checks in a row = down, one blip ignored; recovery closes the incident', () => {
  const st = { history: {}, live: {}, incidents: [] };
  const t0 = Date.parse('2026-11-23T10:00:00Z');
  assert.equal(L.applyResult(st, 'a', true, 'ok', t0), 'up' === 'x' ? 1 : null);
  assert.equal(L.applyResult(st, 'a', false, 'HTTP 502', t0 + 60e3), null, 'one failure is a blip');
  assert.equal(L.applyResult(st, 'a', true, 'ok', t0 + 120e3), null);
  assert.equal(L.applyResult(st, 'a', false, 'x', t0 + 180e3), null);
  assert.equal(L.applyResult(st, 'a', false, 'x', t0 + 240e3), 'down');
  assert.equal(L.applyResult(st, 'a', false, 'x', t0 + 300e3), null, 'no repeat alert');
  assert.equal(st.incidents.length, 1);
  assert.equal(L.applyResult(st, 'a', true, 'ok', t0 + 360e3), 'up');
  assert.equal(st.incidents[0].end, t0 + 360e3);
  const u = L.uptime(st, 'a', 24, t0 + 400e3);
  assert.ok(Math.abs(u - (3 / 7) * 100) < 0.01, 'uptime ' + u);
  const bars = L.dailyBars(st, ['a'], 30, t0 + 400e3);
  assert.equal(bars.length, 30); assert.equal(bars.at(-1).day, '2026-11-23'); assert.ok(bars.at(-1).pct > 0); assert.equal(bars[0].pct, null);
});

test('history keeps 90 days only', () => {
  const st = { history: {}, live: {}, incidents: [] };
  const now = Date.parse('2026-11-23T10:00:00Z');
  L.recordCheck(st, 'a', true, now - 100 * 86400e3);
  L.recordCheck(st, 'a', true, now);
  assert.deepEqual(Object.keys(st.history.a.hours), ['2026-11-23T10']);
});

test('login cookie: signed, expires, cannot be forged', () => {
  const s = 'x'.repeat(32);
  const c = L.makeSession(s, 7, 1000);
  assert.equal(L.checkSession(s, c, 2000), true);
  assert.equal(L.checkSession(s, c, 1000 + 8 * 86400e3), false, 'expired');
  assert.equal(L.checkSession('y'.repeat(32), c, 2000), false, 'other secret');
  const [exp, mac] = c.split('.');
  assert.equal(L.checkSession(s, `${Number(exp) + 1}.${mac}`, 2000), false, 'edited expiry');
  assert.equal(L.passwordOk('correct horse', 'correct horse'), true);
  assert.equal(L.passwordOk('nope', 'correct horse'), false);
  assert.equal(L.passwordOk('short', 'short'), false, 'too-short password never accepted');
});

test('server: status page, JSON, owner login, notice, owner dashboard with app numbers', async () => {
  // fake apps
  const apps = http.createServer((req, res) => {
    if (req.url.endsWith('/health')) { res.end(JSON.stringify({ ok: true, db: 'connected' })); return; }
    if (req.url.includes('/owner/summary')) {
      if (req.headers['x-owner-key'] !== 'k'.repeat(32)) { res.statusCode = 401; return res.end('{}'); }
      return res.end(JSON.stringify({ app: 'X', at: new Date().toISOString(), users: { total: 5, newToday: 1 }, today: { orders: 2, salesNGN: 1500, failed: 0 }, balances: { vtpassNGN: 9000 }, attention: ['2 open support ticket(s) <b>'] }));
    }
    res.end('<html>ok</html>');
  }).listen(0);
  await new Promise((r) => apps.once('listening', r));
  const base = `http://127.0.0.1:${apps.address().port}`;
  const services = require('../services');
  for (const s of services) { s.url = base + new URL(s.url).pathname; if (s.summary) s.summary = base + new URL(s.summary).pathname; }
  Object.assign(process.env, { OWNER_PASSWORD: 'a-long-password', SESSION_SECRET: 's'.repeat(32), OWNER_KEY: 'k'.repeat(32) });
  process.chdir(require('os').tmpdir());
  const hub = require('../server');
  hub._setState({ history: {}, live: {}, incidents: [], notice: '' });
  await hub.runChecks(); await hub.runChecks();
  hub.server.listen(0);
  await new Promise((r) => hub.server.once('listening', r));
  const H = `http://127.0.0.1:${hub.server.address().port}`;
  let r = await fetch(H + '/'); let t = await r.text();
  assert.match(t, /All services are working/); assert.match(t, /Zappi NG/); assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  const j = await (await fetch(H + '/api/status')).json();
  assert.equal(j.groups.length, 4); assert.ok(j.groups.every((g) => g.status === 'up'));
  r = await fetch(H + '/owner'); assert.match(await r.text(), /Password/);
  r = await fetch(H + '/owner/login', { method: 'POST', body: 'password=wrong', headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
  assert.equal(r.status, 401);
  r = await fetch(H + '/owner/login', { method: 'POST', body: 'password=a-long-password', headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
  assert.equal(r.status, 303); const cookie = r.headers.get('set-cookie').split(';')[0];
  assert.match(r.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
  t = await (await fetch(H + '/owner', { headers: { cookie } })).text();
  assert.match(t, /Sales today \(all apps\)/); assert.match(t, /₦4,500/, 'three apps × ₦1,500');
  assert.match(t, /2 open support ticket\(s\) &lt;b&gt;/, 'app text escaped');
  r = await fetch(H + '/owner/notice', { method: 'POST', body: 'notice=' + encodeURIComponent('Update <script> tonight'), headers: { 'content-type': 'application/x-www-form-urlencoded', cookie }, redirect: 'manual' });
  assert.equal(r.status, 303);
  t = await (await fetch(H + '/')).text(); assert.match(t, /Update &lt;script&gt; tonight/);
  r = await fetch(H + '/owner/notice', { method: 'POST', body: 'notice=hacked', headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
  t = await (await fetch(H + '/')).text(); assert.doesNotMatch(t, /hacked/, 'notice needs login');
  for (let i = 0; i < 6; i++) r = await fetch(H + '/owner/login', { method: 'POST', body: 'password=x', headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
  assert.equal(r.status, 429, 'login attempts limited');
  hub.server.close(); apps.close();
});
