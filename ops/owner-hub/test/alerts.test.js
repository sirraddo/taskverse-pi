// Phone alerts + daily summary (web-push replaced by a fake that records what would be sent).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const os = require('os');
const sent = [];
const wpPath = require.resolve('web-push');
require.cache[wpPath] = { id: wpPath, filename: wpPath, loaded: true, exports: {
  generateVAPIDKeys: () => ({ publicKey: 'PUB', privateKey: 'PRIV' }),
  setVapidDetails: () => {},
  sendNotification: async (sub, payload) => { if (sub.endpoint.includes('gone')) throw Object.assign(new Error('gone'), { statusCode: 410 }); sent.push({ to: sub.endpoint, ...JSON.parse(payload) }); },
} };
const L = require('../lib');

test('attention alerts: once per kind, again after it clears; unreachable app keeps state', () => {
  const st = {};
  assert.equal(L.newAttention(st, { A: ['3 customer(s) owed a refund (π2.0159)'] }).length, 1);
  assert.equal(L.newAttention(st, { A: ['4 customer(s) owed a refund (π3.1)'] }).length, 0);
  assert.equal(L.newAttention(st, { A: null }).length, 0);
  assert.equal(L.newAttention(st, { A: ['4 customer(s) owed a refund (π3.1)'] }).length, 0, 'not re-sent after a failed read');
  L.newAttention(st, { A: [] });
  assert.equal(L.newAttention(st, { A: ['1 customer(s) owed a refund (π1)'] }).length, 1);
});

test('daily summary text', () => {
  const m = L.dailySummary('2026-11-23', { 'Zappi NG': { today: { orders: 1, salesNGN: 200, failed: 0 }, users: { newToday: 1 } } }, { uptimeByGroup: { 'Zappi NG': 100 }, attention: ['a'] });
  assert.equal(m.title, 'Yesterday (Mon 23 Nov)');
  assert.equal(m.body, 'Sales ₦200 · 1 new user · 1 thing needs attention');
  assert.match(m.text, /Zappi NG: 1 order · ₦200 · \+1 user/);
  assert.match(m.text, /Uptime: all apps 100%/);
  assert.match(L.dailySummary('2026-11-23', undefined).text, /No numbers were collected/);
});

test('server: subscribe needs login, alerts go to subscribed phones, dead phones removed, daily once', async () => {
  const apps = http.createServer((req, res) => {
    if (req.url.includes('/owner/summary')) return res.end(JSON.stringify({ at: new Date().toISOString(), users: { total: 1, newToday: 0 }, today: { orders: 1, salesNGN: 500 }, attention: ['2 open support ticket(s)'] }));
    res.end(JSON.stringify({ ok: true }));
  }).listen(0);
  await new Promise((r) => apps.once('listening', r));
  const base = `http://127.0.0.1:${apps.address().port}`;
  for (const s of require('../services')) { s.url = base + '/health'; if (s.summary) s.summary = base + '/api/owner/summary'; }
  Object.assign(process.env, { OWNER_PASSWORD: 'a-long-password', SESSION_SECRET: 's'.repeat(32), OWNER_KEY: 'k'.repeat(32) });
  process.chdir(os.tmpdir());
  const fs = require('fs'); const path = require('path');
  fs.rmSync(path.join(__dirname, '..', 'data'), { recursive: true, force: true });
  const hub = require('../server');
  hub.server.listen(0); await new Promise((r) => hub.server.once('listening', r));
  const H = `http://127.0.0.1:${hub.server.address().port}`;
  const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } };
  let r = await fetch(H + '/owner/push/subscribe', { method: 'POST', body: JSON.stringify(sub) });
  assert.equal(r.status, 401, 'needs login');
  r = await fetch(H + '/owner/login', { method: 'POST', body: 'password=a-long-password', headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  assert.equal((await (await fetch(H + '/owner/push/key', { headers: { cookie } })).json()).publicKey, 'PUB');
  r = await fetch(H + '/owner/push/subscribe', { method: 'POST', body: JSON.stringify({ endpoint: 'http://evil', keys: {} }), headers: { cookie } });
  assert.equal(r.status, 400);
  r = await fetch(H + '/owner/push/subscribe', { method: 'POST', body: JSON.stringify(sub), headers: { cookie } });
  assert.equal(r.status, 200);
  await fetch(H + '/owner/push/subscribe', { method: 'POST', body: JSON.stringify({ endpoint: 'https://push.example/gone', keys: { p256dh: 'p', auth: 'a' } }), headers: { cookie } });
  await new Promise((r2) => setTimeout(r2, 50));
  assert.ok(sent.some((s) => s.title === '🔔 Alerts are on'));
  sent.length = 0;
  await hub.watchSummaries();
  assert.equal(sent.length, 1); assert.match(sent[0].title, /3 things need attention/); assert.match(sent[0].body, /Zappi NG: 2 open support ticket/);
  assert.equal(hub.pushStore().subs.length, 1, 'phone that is gone was removed');
  await hub.watchSummaries();
  assert.equal(sent.length, 1, 'same problems not re-sent');
  r = await fetch(H + '/owner/push/test', { method: 'POST', headers: { cookie }, redirect: 'manual' });
  assert.equal(r.headers.get('location'), '/owner?sent=1');
  sent.length = 0;
  const m = await hub.maybeDailySummary(true);
  assert.equal(sent.length, 1); assert.match(sent[0].title, /^📊 Yesterday/); assert.ok(m.text.length > 10);
  hub.server.close(); apps.close();
  fs.rmSync(path.join(__dirname, '..', 'data'), { recursive: true, force: true });
});
