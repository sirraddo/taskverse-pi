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
 * Files: /opt/apps/.backups/<DATE>/<db>/<collection>.jsonl.gz  (one MongoDB Extended JSON document per line)
 * Each database is saved once even when several apps share a cluster; <DATE>/apps.json records which app's
 * connection reaches it (used by restore).
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const readline = require("readline");

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
    const ok = fs.existsSync(path.join(p, "OK")) ? "OK" : fs.existsSync(path.join(p, "FAILED")) ? "SOME FAILED" : "unfinished";
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
(cmd === "list" ? Promise.resolve(list()) : cmd === "restore" ? restore(a, b) : runBackup())
  .catch((e) => { console.error("STOP:", e.message); process.exitCode = 1; });
