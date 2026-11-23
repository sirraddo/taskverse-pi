// Telegram alerts: linking with a one-time code, private bot, alerts and commands (fake Telegram API).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const wpPath = require.resolve('web-push');
require.cache[wpPath] = { id: wpPath, filename: wpPath, loaded: true, exports: { generateVAPIDKeys: () => ({ publicKey: 'P', privateKey: 'K' }), setVapidDetails() {}, sendNotification: async () => {} } };

test('telegram: link, private, alerts, /status, /today', async () => {
  const said = []; let queue = [];
  const tgApi = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      const body = JSON.parse(b || '{}'); const m = req.url.split('/').pop();
      assert.match(req.url, /^\/bot123:[\w-]+\//);
      const ok = (result) => res.end(JSON.stringify({ ok: true, result }));
      if (m === 'getMe') return ok({ username: 'sirraddo_test_bot' });
      if (m === 'getUpdates') { const u = queue.filter((x) => x.update_id >= (body.offset || 0)); queue = []; return ok(u); }
      if (m === 'sendMessage') { said.push(body); return ok({}); }
      res.end(JSON.stringify({ ok: false, description: 'unknown' }));
    });
  }).listen(0);
  await new Promise((r) => tgApi.once('listening', r));
  fs.rmSync(path.join(__dirname, '..', 'data'), { recursive: true, force: true });
  Object.assign(process.env, { TELEGRAM_API: `http://127.0.0.1:${tgApi.address().port}`, TELEGRAM_BOT_TOKEN: '123:' + 'A'.repeat(30), OWNER_PASSWORD: 'a-long-password', SESSION_SECRET: 's'.repeat(32) });
  for (const s of require('../services')) { s.url = 'http://127.0.0.1:9/x'; if (s.summary) s.summary = 'http://127.0.0.1:9/y'; }
  const hub = require('../server');
  hub.server.listen(0); await new Promise((r) => hub.server.once('listening', r));
  const H = `http://127.0.0.1:${hub.server.address().port}`;
  let r = await fetch(H + '/owner/telegram/link', { redirect: 'manual' });
  assert.equal(r.headers.get('location'), '/owner', 'needs login');
  r = await fetch(H + '/owner/login', { method: 'POST', body: 'password=a-long-password', headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  assert.match(await (await fetch(H + '/owner', { headers: { cookie } })).text(), /Link Telegram/);
  r = await fetch(H + '/owner/telegram/link', { headers: { cookie }, redirect: 'manual' });
  const loc = r.headers.get('location'); assert.match(loc, /^https:\/\/t\.me\/sirraddo_test_bot\?start=[a-f0-9]{24}$/);
  const code = loc.split('=')[1];
  queue = [
    { update_id: 10, message: { chat: { id: 999 }, text: '/status' } },
    { update_id: 11, message: { chat: { id: 999 }, text: '/start wrongcode12345' } },
    { update_id: 12, message: { chat: { id: 42, first_name: 'Ridwan' }, text: `/start ${code}` } },
  ];
  await hub.tgPollOnce(0);
  assert.equal(said[0].text, 'This is a private bot.');
  assert.match(said[1].text, /expired/);
  assert.equal(said[2].chat_id, 42); assert.match(said[2].text, /Linked/);
  assert.deepEqual(hub.tgStore().chats.map((c) => c.id), [42]);
  queue = [{ update_id: 13, message: { chat: { id: 999 }, text: `/start ${code}` } }];
  await hub.tgPollOnce(0);
  assert.match(said.at(-1).text, /expired/, 'code works once');
  said.length = 0;
  await hub.alertAll('🔴 Zappi NG server is down', 'Failed two checks.', 'x');
  assert.deepEqual(said.map((s) => [s.chat_id, s.text]), [[42, '🔴 Zappi NG server is down\nFailed two checks.']]);
  queue = [{ update_id: 14, message: { chat: { id: 42 }, text: '/status' } }, { update_id: 15, message: { chat: { id: 42 }, text: '/today' } }];
  await hub.tgPollOnce(0);
  assert.match(said[1].text, /SIRRADDO status\n.*Zappi NG/s); assert.match(said[2].text, /^Today so far/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'telegram.json'), 'utf8')).offset, 16);
  hub.server.close(); tgApi.close();
  fs.rmSync(path.join(__dirname, '..', 'data'), { recursive: true, force: true });
});
