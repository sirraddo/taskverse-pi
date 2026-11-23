#!/usr/bin/env node
/*
 * Nightly MongoDB backup for the apps that vps-app.sh runs (TaskVerse, Zappi NG).
 * Installed by `bash vps-app.sh safety` as /opt/apps/.ops/backup.js. Needs nothing extra: it borrows the
 * MongoDB driver that each app already has in its node_modules.
 *
 *   node backup.js                     back up every app now (cron runs this nightly), keep the last 7 days
 *   node backup.js list                show the backups on disk
 *   node backup.js restore DB DATE     copy one saved database into a NEW database called <DB>_restore_<DATE>.
 *                                      It never touches the live database: you look at the copy first, then
 *                                      point the app at it (MONGO_DB_NAME) only if you really need to.
 *
 *   node backup.js offsite-test        check the off-site (Cloudflare R2) settings with a tiny test file
 *   node backup.js upload [DATE]       copy a day's backup to R2 (the nightly run does this by itself)
 *   node backup.js remote              list the days stored in R2
 *   node backup.js download DATE       fetch a day back from R2 (e.g. onto a new server), then use restore
 *
 * Off-site copy: if /opt/apps/.ops/offsite.env exists (written by `bash vps-app.sh offsite`), each night's
 * backup is also uploaded to a private R2 bucket and days older than R2_KEEP_DAYS (default 14) are removed there.
 *
 * Files: /opt/apps/.backups/<DATE>/<db>/<collection>.jsonl.gz  (one MongoDB Extended JSON document per line)
 * Each database is saved once even when several apps share a cluster; <DATE>/apps.json records which app's
 * connection reaches it (used by restore).
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const readline = require("readline");

const crypto = require("crypto");
const APPS = process.env.APPS_DIR || "/opt/apps";
const OUT = path.join(APPS, ".backups");
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS || 7);
const SKIP_DBS = new Set(["admin", "local", "config"]);
const skipDb = (n) => SKIP_DBS.has(n) || n.startsWith("sample_"); // Atlas demo data
const today = () => new Date().toISOString().slice(0, 10);
const log = (...a) => console.log(new Date().toISOString(), ...a);

function readEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return env;
}

/** Every app folder with a Mongo connection string: { name, dir, uri, dbName, mongo } */
function apps() {
  if (!fs.existsSync(APPS)) return [];
  return fs.readdirSync(APPS).filter((n) => !n.startsWith(".")).flatMap((name) => {
    const metaFile = path.join(APPS, name, ".vps-app");
    if (!fs.existsSync(metaFile)) return [];
    const sub = (readEnv(metaFile).SUB || "").trim();
    const dir = path.join(APPS, name, sub);
    const env = readEnv(path.join(dir, ".env"));
    const uri = env.MONGODB_URI || env.MONGO_URI || env.DATABASE_URL;
    if (!uri || !/^mongodb(\+srv)?:\/\//.test(uri)) return [];
    let mongo;
    try { mongo = require(require.resolve("mongoose", { paths: [dir] })).mongo; }
    catch { try { mongo = require(require.resolve("mongodb", { paths: [dir] })); } catch { return []; } }
    return [{ name, dir, uri, dbName: env.MONGO_DB_NAME || "", mongo }];
  });
}

async function dbNames(client, app) {
  try {
    const { databases } = await client.db("admin").admin().listDatabases({ nameOnly: true });
    return databases.map((d) => d.name).filter((n) => !skipDb(n));
  } catch {
    // Users with access to one database only can't list them all; back up the one the app uses.
    return [app.dbName || client.db().databaseName];
  }
}

const clusterOf = (uri) => { try { return new URL(uri).host.toLowerCase(); } catch { return uri; } };

async function backupApp(app, dayDir, done) {
  const { MongoClient, BSON } = app.mongo;
  const client = new MongoClient(app.uri, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  let docs = 0;
  try {
    for (const dbn of await dbNames(client, app)) {
      // Apps on the same cluster see the same databases: save each database once.
      const key = clusterOf(app.uri) + "/" + dbn;
      if (done.has(key)) { log(`${app.name}: ${dbn} already saved with ${done.get(key)}`); continue; }
      done.set(key, app.name);
      const db = client.db(dbn);
      const cols = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((c) => !c.startsWith("system."));
      const dir = path.join(dayDir, dbn);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      for (const col of cols) {
        const file = path.join(dir, `${col}.jsonl.gz`);
        const gz = zlib.createGzip();
        const out = fs.createWriteStream(file + ".part", { mode: 0o600 });
        gz.pipe(out);
        let n = 0;
        for await (const d of db.collection(col).find({}, { batchSize: 500 })) {
          if (!gz.write(BSON.EJSON.stringify(d, { relaxed: false }) + "\n")) await new Promise((r) => gz.once("drain", r));
          n++;
        }
        gz.end();
        await new Promise((r, j) => { out.on("finish", r); out.on("error", j); });
        fs.renameSync(file + ".part", file);
        docs += n;
      }
      log(`${app.name}: ${dbn} (${cols.length} collections)`);
    }
  } finally { await client.close(); }
  return docs;
}

function prune() {
  if (!fs.existsSync(OUT)) return;
  const days = fs.readdirSync(OUT).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  for (const d of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) {
    fs.rmSync(path.join(OUT, d), { recursive: true, force: true });
    log(`removed old backup ${d}`);
  }
}

async function runBackup() {
  const list = apps();
  if (!list.length) { log("No apps with a MongoDB connection found in", APPS); return; }
  const dayDir = path.join(OUT, today());
  fs.mkdirSync(dayDir, { recursive: true, mode: 0o700 });
  let failed = 0;
  const done = new Map();
  for (const app of list) {
    try { const n = await backupApp(app, dayDir, done); log(`${app.name}: OK, ${n} documents`); }
    catch (e) { failed++; log(`${app.name}: FAILED ${e.message}`); }
  }
  fs.writeFileSync(path.join(dayDir, "apps.json"), JSON.stringify(Object.fromEntries([...done].map(([k, a]) => [k.split("/").pop(), a])), null, 2));
  fs.writeFileSync(path.join(dayDir, failed ? "FAILED" : "OK"), new Date().toISOString() + "\n");
  prune();
  if (failed) process.exitCode = 1;
  else if (offsiteCfg()) {
    try { await uploadDay(today()); }
    catch (e) { log(`off-site: FAILED ${e.message}`); fs.writeFileSync(path.join(dayDir, "OFFSITE_FAILED"), e.message + "\n"); process.exitCode = 1; }
  }
}


/* ---------------- off-site copy (Cloudflare R2, S3-compatible) ---------------- */
const OFFSITE_ENV = path.join(APPS, ".ops", "offsite.env");
const offsiteCfg = () => {
  if (!fs.existsSync(OFFSITE_ENV)) return null;
  const e = readEnv(OFFSITE_ENV);
  if (!e.R2_ACCOUNT_ID || !e.R2_ACCESS_KEY_ID || !e.R2_SECRET_ACCESS_KEY || !e.R2_BUCKET) return null;
  // R2_ENDPOINT is only for testing against another S3-compatible server.
  const ep = e.R2_ENDPOINT ? new URL(e.R2_ENDPOINT) : null;
  return { proto: ep ? ep.protocol.replace(":", "") : "https", host: ep ? ep.host : `${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, bucket: e.R2_BUCKET, ak: e.R2_ACCESS_KEY_ID, sk: e.R2_SECRET_ACCESS_KEY, keep: Number(e.R2_KEEP_DAYS || 14) };
};

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const hmac = (k, v) => crypto.createHmac("sha256", k).update(v).digest();
const enc = (v) => encodeURIComponent(v).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
// AWS Signature V4 (checked against AWS's published test vectors).
function sign({ method, host, urlPath, query = {}, body = "", ak, sk }) {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ""), day = amzDate.slice(0, 8);
  const payloadHash = sha(body);
  const h = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const names = Object.keys(h).sort();
  const canonQuery = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join("&");
  const canon = [method, urlPath.split("/").map(enc).join("/"), canonQuery, names.map((n) => `${n}:${h[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/auto/s3/aws4_request`;
  const sts = ["AWS4-HMAC-SHA256", amzDate, scope, sha(canon)].join("\n");
  const sig = crypto.createHmac("sha256", hmac(hmac(hmac(hmac("AWS4" + sk, day), "auto"), "s3"), "aws4_request")).update(sts).digest("hex");
  return { headers: { ...h, authorization: `AWS4-HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${names.join(";")}, Signature=${sig}` }, canonQuery };
}

async function r2(cfg, method, key, { body, query } = {}) {
  const urlPath = `/${cfg.bucket}${key ? "/" + key : "/"}`;
  const { headers, canonQuery } = sign({ method, host: cfg.host, urlPath, query, body: body || "", ak: cfg.ak, sk: cfg.sk });
  const url = `${cfg.proto}://${cfg.host}${urlPath.split("/").map(enc).join("/")}${canonQuery ? "?" + canonQuery : ""}`;
  const res = await fetch(url, { method, headers, body: body && method !== "GET" ? body : undefined });
  if (!res.ok && !(method === "DELETE" && res.status === 404)) {
    const t = (await res.text()).slice(0, 300);
    const code = (t.match(/<Code>([^<]+)/) || [])[1] || res.status;
    throw new Error(`R2 ${method} ${key || "(bucket)"} failed: ${code}${code === "SignatureDoesNotMatch" || code === "InvalidAccessKeyId" ? " (check the access key and secret)" : code === "NoSuchBucket" ? " (check the bucket name)" : ""}`);
  }
  return res;
}

async function r2List(cfg, prefix, delimiter) {
  const keys = [], prefixes = [];
  let token = null;
  do {
    const query = { "list-type": "2", prefix: prefix || "", ...(delimiter ? { delimiter } : {}), ...(token ? { "continuation-token": token } : {}) };
    const xml = await (await r2(cfg, "GET", "", { query })).text();
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1].replace(/&amp;/g, "&"));
    for (const m of xml.matchAll(/<Prefix>([^<]+)<\/Prefix>\s*<\/CommonPrefixes>/g)) prefixes.push(m[1]);
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (xml.match(/<NextContinuationToken>([^<]+)/) || [])[1] : null;
  } while (token);
  return { keys, prefixes };
}

function filesUnder(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? filesUnder(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))]);
}

async function uploadDay(day) {
  const cfg = offsiteCfg();
  if (!cfg) throw new Error("Off-site copy is not set up. Run: bash vps-app.sh offsite");
  day = day || today();
  const dir = path.join(OUT, day);
  if (!fs.existsSync(path.join(dir, "OK"))) throw new Error(`The ${day} backup is not complete (no OK marker); not uploading it.`);
  const files = filesUnder(dir).filter((f) => f !== "OK" && f !== "OFFSITE_FAILED").concat(["OK"]); // OK last: a day without it is unfinished
  let bytes = 0;
  for (const f of files) {
    const body = fs.readFileSync(path.join(dir, f));
    await r2(cfg, "PUT", `${day}/${f.split(path.sep).join("/")}`, { body });
    bytes += body.length;
  }
  log(`off-site: uploaded ${day} (${files.length} files, ${(bytes / 1048576).toFixed(1)} MB)`);
  fs.rmSync(path.join(dir, "OFFSITE_FAILED"), { force: true });
  const { prefixes } = await r2List(cfg, "", "/");
  const days = prefixes.map((p) => p.replace(/\/$/, "")).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  for (const old of days.slice(0, Math.max(0, days.length - cfg.keep))) {
    const { keys } = await r2List(cfg, old + "/");
    for (const k of keys) await r2(cfg, "DELETE", k);
    log(`off-site: removed old copy ${old}`);
  }
}

async function offsiteTest() {
  const cfg = offsiteCfg();
  if (!cfg) throw new Error("Off-site settings are missing. Run: bash vps-app.sh offsite");
  const key = `_test/${Date.now()}.txt`, body = "vps-app off-site test " + new Date().toISOString();
  await r2(cfg, "PUT", key, { body });
  const back = await (await r2(cfg, "GET", key)).text();
  await r2(cfg, "DELETE", key);
  if (back !== body) throw new Error("R2 returned different content than was uploaded");
  console.log(`OK: can upload, read and delete in the "${cfg.bucket}" bucket.`);
}

async function remoteList() {
  const cfg = offsiteCfg();
  if (!cfg) throw new Error("Off-site copy is not set up. Run: bash vps-app.sh offsite");
  const { prefixes } = await r2List(cfg, "", "/");
  const days = prefixes.map((p) => p.replace(/\/$/, "")).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  console.log(days.length ? days.join("\n") : "No days stored in R2 yet.");
}

async function download(day) {
  const cfg = offsiteCfg();
  if (!cfg) throw new Error("Off-site settings are missing. Run: bash vps-app.sh offsite");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) throw new Error("Usage: node backup.js download YYYY-MM-DD   (see: node backup.js remote)");
  const { keys } = await r2List(cfg, day + "/");
  if (!keys.length) throw new Error(`No copy of ${day} in R2`);
  for (const k of keys) {
    const dest = path.join(OUT, ...k.split("/"));
    if (!dest.startsWith(OUT + path.sep)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
    fs.writeFileSync(dest, Buffer.from(await (await r2(cfg, "GET", k)).arrayBuffer()), { mode: 0o600 });
  }
  console.log(`Downloaded ${keys.length} files of ${day}. Now: bash vps-app.sh restore DATABASE ${day}`);
}

function du(p) {
  let t = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) t += e.isDirectory() ? du(path.join(p, e.name)) : fs.statSync(path.join(p, e.name)).size;
  return t;
}

function list() {
  if (!fs.existsSync(OUT)) return console.log("No backups yet.");
  for (const d of fs.readdirSync(OUT).sort()) {
    const p = path.join(OUT, d);
    const ok = (fs.existsSync(path.join(p, "OK")) ? "OK" : fs.existsSync(path.join(p, "FAILED")) ? "SOME FAILED" : "unfinished") + (fs.existsSync(path.join(p, "OFFSITE_FAILED")) ? " (off-site copy FAILED)" : "");
    const appsIn = fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).join(", "); // databases
    console.log(`${d}  ${(du(p) / 1048576).toFixed(1)} MB  ${ok}  ${appsIn}`);
  }
}

async function restore(dbn, day) {
  if (!dbn || !/^\d{4}-\d{2}-\d{2}$/.test(day || "")) throw new Error("Usage: node backup.js restore DATABASE YYYY-MM-DD   (see: node backup.js list)");
  const src = path.join(OUT, day, dbn);
  if (!fs.existsSync(src)) throw new Error(`No backup of the database "${dbn}" on ${day}. See: bash vps-app.sh status`);
  let owner = null;
  try { owner = JSON.parse(fs.readFileSync(path.join(OUT, day, "apps.json"), "utf8"))[dbn]; } catch { /* older backup */ }
  const app = apps().find((a) => a.name === owner) || apps()[0];
  if (!app) throw new Error("No app with a MongoDB connection found");
  const { MongoClient, BSON } = app.mongo;
  const client = new MongoClient(app.uri, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  try {
    const target = `${dbn}_restore_${day.replace(/-/g, "")}`.slice(0, 63);
    const db = client.db(target);
    if ((await db.listCollections({}, { nameOnly: true }).toArray()).length) throw new Error(`${target} already exists; delete it in Atlas first or restore another day.`);
    for (const f of fs.readdirSync(src).filter((x) => x.endsWith(".jsonl.gz"))) {
      const col = db.collection(f.replace(/\.jsonl\.gz$/, ""));
      const rl = readline.createInterface({ input: fs.createReadStream(path.join(src, f)).pipe(zlib.createGunzip()), crlfDelay: Infinity });
      let batch = [], n = 0;
      for await (const line of rl) {
        if (!line.trim()) continue;
        batch.push(BSON.EJSON.parse(line, { relaxed: false }));
        if (batch.length >= 500) { await col.insertMany(batch, { ordered: false }); n += batch.length; batch = []; }
      }
      if (batch.length) { await col.insertMany(batch, { ordered: false }); n += batch.length; }
      log(`${target}.${col.collectionName}: ${n} documents`);
    }
    console.log(`\nRestored into the NEW database "${target}". The live database "${dbn}" was not touched.`);
  } finally { await client.close(); }
}

const [cmd, a, b] = process.argv.slice(2);
const cmds = { list: () => Promise.resolve(list()), restore: () => restore(a, b), "offsite-test": offsiteTest, upload: () => uploadDay(a), remote: remoteList, download: () => download(a) };
(cmds[cmd] || runBackup)()
  .catch((e) => { console.error("STOP:", e.message); process.exitCode = 1; });
