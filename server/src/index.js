import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import * as StellarSdk from 'stellar-sdk';

import {
  User, Task, Submission, Dispute, Payment, PlatformLedger, Announcement, Banner, FeatureFlag, PlatformSettings, microPi, toPi,
} from './models.js';
import * as pi from './piPlatform.js';
import { runAutoBatch, startAutoPayScheduler, archiveOldTasks, runConsolidatedBatch, previewConsolidation } from './autoPay.js';
import { evaluateSubmission } from './autoReview.js';

const app = express();
// Render (and most hosts) put the app behind a proxy, so the real client IP
// arrives in X-Forwarded-For. Trust it so req.ip is the user's actual IP.
app.set('trust proxy', true);

// Look up the ISO country for an IP using a free, no-key geo-IP service.
// Best-effort: returns null on any failure so it can NEVER break a request.
// Skips private/loopback IPs. Used only for passive geo auditing.
async function lookupIpCountry(ip) {
  try {
    if (!ip) return null;
    const clean = String(ip).replace('::ffff:', '').trim();
    if (!clean || clean === '::1' || clean.startsWith('127.') || clean.startsWith('10.') ||
        clean.startsWith('192.168.') || clean.startsWith('172.')) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500); // never hang a request
    const r = await fetch(`http://ip-api.com/json/${clean}?fields=status,countryCode`, { signal: ctrl.signal });
    clearTimeout(timer);
    const j = await r.json();
    return j?.status === 'success' && j.countryCode ? String(j.countryCode).toUpperCase() : null;
  } catch (_) { return null; }
}

const FEE_RATE = Number(process.env.PLATFORM_FEE_RATE || 0.05);

// Original hardcoded defaults, preserved exactly — used for any field the
// admin hasn't overridden via Admin → Settings. A completely empty
// PlatformSettings doc reproduces the app's behavior before this feature
// existed, byte for byte.
const SETTINGS_DEFAULTS = {
  feeRate: FEE_RATE,
  minRewardMicroPi: 10_000,   // 0.01 π
  maxRewardMicroPi: null,     // no cap
  minSlots: 1,
  maxSlots: null,             // no cap
  autoApproveRejectionRateThreshold: 0.35,
  autoApproveMinDecisions: 5,
};

async function getPlatformSettings() {
  const row = await PlatformSettings.findById('global').lean();
  const out = { ...SETTINGS_DEFAULTS };
  if (row) {
    for (const k of Object.keys(SETTINGS_DEFAULTS)) {
      if (row[k] !== null && row[k] !== undefined) out[k] = row[k];
    }
  }
  return out;
}

// Hosts we accept proof screenshots from. The app uploads to ImgBB and sends
// back the resulting URL; anything else is rejected so workers can't pass off a
// random image from elsewhere on the internet as their proof.
// Override/extend with PROOF_IMAGE_HOSTS="imgbb.com,i.ibb.co,my-host.com".
const PROOF_IMAGE_HOSTS = (process.env.PROOF_IMAGE_HOSTS || 'ibb.co,imgbb.com')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const ADMINS = (process.env.ADMIN_USERNAMES || '').split(',').map((s) => s.trim().toLowerCase());
const isAdmin = (username) => ADMINS.includes((username || '').toLowerCase());

// Normalize a country code to uppercase ISO alpha-2 (e.g. ' ng ' -> 'NG').
// Returns '' for anything that isn't a 2-letter code.
const normCountry = (c) => {
  const v = String(c || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : '';
};
// Normalize a list of allowed countries (dedup, drop invalids).
const normCountryList = (arr) => {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.map(normCountry).filter(Boolean))];
};

app.use(helmet());
// Support comma-separated origins (e.g. "https://a.vercel.app,https://b.vercel.app")
const _allowedOrigins = (process.env.CLIENT_ORIGIN || '')
  .split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);                       // curl / same-origin
    if (_allowedOrigins.length === 0) return cb(null, true); // no env = dev mode, allow all
    if (_allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('CORS: ' + origin + ' not in allowed list'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    req.session = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

function requireAdmin(req, res, next) {
    if (!isAdmin(req.session.username)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/* ── Feature flags ──────────────────────────────────────────────
   Emergency brake for specific actions, plus a global 'maintenance'
   switch that overrides everything else at once.
   Fail-open by design, but the safe default differs per flag:
   - posting / submissions / payouts: no row yet = ALLOWED (enabled=true).
     A flag nobody has created can never silently break the app.
   - maintenance: no row yet = NOT active. Since "enabled" here means
     "the maintenance switch is ON", defaulting a missing row to true
     would put a freshly-deployed app into maintenance mode with nobody
     having touched anything — so this one defaults to false instead. */
const KNOWN_FEATURES = [
  { key: 'posting', label: 'Task posting', description: 'Users creating new tasks (POST /api/tasks).' },
  { key: 'submissions', label: 'Task submissions', description: 'Workers submitting proof for a task.' },
  { key: 'payouts', label: 'A2U payouts', description: 'Approve-and-pay + the background auto-pay scheduler.' },
  { key: 'maintenance', label: 'Maintenance mode', description: 'When ON, blocks the whole app for non-admins.' },
];

async function isMaintenanceActive() {
  const m = await FeatureFlag.findOne({ key: 'maintenance' }).lean();
  return m ? m.enabled === true : false; // no row = not in maintenance
}

async function isFeatureEnabled(key) {
  if (await isMaintenanceActive()) return false; // overrides posting/submissions/payouts
  const f = await FeatureFlag.findOne({ key }).lean();
  return f ? f.enabled !== false : true; // no row = allowed
}

function requireFeature(key, label) {
  return async (req, res, next) => {
    try {
      if (!(await isFeatureEnabled(key))) {
        return res.status(503).json({ error: `${label || key} is temporarily disabled by the admin. Please try again shortly.` });
      }
      next();
    } catch (err) { next(err); }
  };
}

async function currentUser(req) {
  const user = await User.findById(req.session.userId);
  if (!user || user.isBanned) throw Object.assign(new Error('Account unavailable'), { status: 403 });
  return user;
}

/* ── Auth ── */
app.post('/api/auth/verify', async (req, res, next) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) return res.status(400).json({ error: 'accessToken required' });
    const me = await pi.verifyAccessToken(accessToken);
    const user = await User.findOneAndUpdate(
      { piUid: me.uid },
      { username: me.username, lastLoginAt: new Date() },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    const sessionToken = jwt.sign(
      { userId: user._id.toString(), piUid: user.piUid, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      sessionToken,
      user: {
        username: user.username,
        balance: toPi(user.balanceMicroPi),
        approvedCount: user.approvedCount,
        isKycVerified: user.isKycVerified,
                isAdmin: isAdmin(user.username),
      },
    });
  } catch (err) {
    if (err.response?.status === 401) return res.status(401).json({ error: 'Pi token invalid' });
    next(err);
  }
});

/* ── Tasks ── */
app.post('/api/tasks', requireAuth, requireFeature('posting', 'Task posting'), async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const { title, description = '', rewardPi, slots } = req.body;
    const rewardMicro = microPi(rewardPi);
    const slotCount = parseInt(slots, 10);
    const settings = await getPlatformSettings();
    if (!title?.trim() || !(rewardMicro >= settings.minRewardMicroPi) || !(slotCount >= settings.minSlots)) {
      return res.status(400).json({
        error: `Valid title, reward (>=${toPi(settings.minRewardMicroPi)}pi) and slots (>=${settings.minSlots}) required`,
      });
    }
    if (settings.maxRewardMicroPi && rewardMicro > settings.maxRewardMicroPi) {
      return res.status(400).json({ error: `Reward per slot can't exceed ${toPi(settings.maxRewardMicroPi)}pi.` });
    }
    if (settings.maxSlots && slotCount > settings.maxSlots) {
      return res.status(400).json({ error: `Slots can't exceed ${settings.maxSlots}.` });
    }
    const rewardPool = rewardMicro * slotCount;
    const fee = Math.round(rewardPool * settings.feeRate);
    const gross = rewardPool + fee;
    const task = await Task.create({
      title: title.trim(), description, rewardMicroPi: rewardMicro, slots: slotCount,
      link: /^https?:\/\//i.test(String(req.body.link || '').trim()) ? String(req.body.link || '').trim().slice(0, 500) : '',
      poster: user._id, grossDepositMicroPi: gross, platformFeeMicroPi: fee,
      escrowRemainingMicroPi: rewardPool, status: 'awaiting_funding',
      allowedCountries: normCountryList(req.body.allowedCountries),
      requireScreenshot: Boolean(req.body.requireScreenshot),
      requireManualReview: Boolean(req.body.requireManualReview),
    });
    res.status(201).json({
      taskId: task._id, amountToPay: toPi(gross),
      breakdown: { rewardPool: toPi(rewardPool), platformFee: toPi(fee), feeRate: settings.feeRate },
    });
  } catch (err) { next(err); }
});

app.get('/api/tasks', requireAuth, async (req, res, next) => {
  try {
    const me = await currentUser(req);
    const myCountry = normCountry(me?.country);
    // A task is visible if it's global (no allowedCountries) OR the user's
    // declared country is in its allowed list. Done in the query for efficiency.
    const tasks = await Task.find({
      status: 'live',
      poster: { $ne: req.session.userId },
      $or: [
        { allowedCountries: { $size: 0 } },
        ...(myCountry ? [{ allowedCountries: myCountry }] : []),
      ],
    })
      .sort({ createdAt: -1 }).limit(100).lean();
    const doneSet = new Set(
      (await Submission.find(
        { worker: req.session.userId, task: { $in: tasks.map(t => t._id) } }, 'task'
      ).lean()).map(s => s.task.toString())
    );
    res.json(tasks.map((t) => ({
      id: t._id, title: t.title, description: t.description,
      link: t.link,
      reward: toPi(t.rewardMicroPi), slotsLeft: t.slots - t.slotsFilled,
      slotsFilled: t.slotsFilled, slots: t.slots,
      allowedCountries: t.allowedCountries || [],
      requireScreenshot: !!t.requireScreenshot,
      requireManualReview: !!t.requireManualReview,
      userDone: doneSet.has(t._id.toString()),
    })));
  } catch (err) { next(err); }
});

/* ── Admin: balance audit (READ-ONLY dry-run) ── */
app.get('/api/admin/balance-audit', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const approved = await Submission.aggregate([{ $match: { status: { $in: ['approved', 'auto_approved'] } } }, { $group: { _id: '$worker', micro: { $sum: '$rewardMicroPi' } } }]);
    const paid = await Payment.aggregate([{ $match: { direction: 'A2U', purpose: 'worker_payout', status: 'completed' } }, { $group: { _id: '$user', micro: { $sum: '$amountMicroPi' }, count: { $sum: 1 } } }]);
    const aMap = new Map(approved.map((x) => [String(x._id), x.micro]));
    const pMap = new Map(paid.map((x) => [String(x._id), x]));
    const ids = [...new Set([...aMap.keys(), ...pMap.keys()])];
    const targets = await User.find({ _id: { $in: ids } }).select('piUid username balanceMicroPi').lean();
    const rows = targets.map((u) => {
      const approvedMicro = aMap.get(String(u._id)) || 0;
      const p = pMap.get(String(u._id)) || { micro: 0, count: 0 };
      const correctMicro = approvedMicro - p.micro;
      return { piUid: u.piUid, username: u.username, storedPi: toPi(u.balanceMicroPi), approvedPi: toPi(approvedMicro), paidOutPi: toPi(p.micro), payoutCount: p.count, correctPi: toPi(correctMicro), deltaPi: toPi(u.balanceMicroPi - correctMicro) };
    }).filter((r) => r.deltaPi !== 0).sort((a, b) => b.deltaPi - a.deltaPi);
    res.json({ dryRun: true, affectedWorkers: rows.length, totalDeltaPi: rows.reduce((s, r) => s + r.deltaPi, 0), rows });
  } catch (err) { next(err); }
});

/* ── Admin: APPLY the balance correction (writes) ──
   Sets each worker's in-app balance to (approved − paidOnChain), the same value
   the read-only /balance-audit reports. Recomputes fresh server-side; never
   trusts client input. Floors at 0. Only touches workers with a non-zero delta.
   Phantom accounts (approved > paid) keep their owed balance untouched. */
app.post('/api/admin/balance-fix', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const approved = await Submission.aggregate([{ $match: { status: { $in: ['approved', 'auto_approved'] } } }, { $group: { _id: '$worker', micro: { $sum: '$rewardMicroPi' } } }]);
    const paid = await Payment.aggregate([{ $match: { direction: 'A2U', purpose: 'worker_payout', status: 'completed' } }, { $group: { _id: '$user', micro: { $sum: '$amountMicroPi' }, count: { $sum: 1 } } }]);
    const aMap = new Map(approved.map((x) => [String(x._id), x.micro]));
    const pMap = new Map(paid.map((x) => [String(x._id), x.micro]));
    const ids = [...new Set([...aMap.keys(), ...pMap.keys()])];
    const targets = await User.find({ _id: { $in: ids } }).select('piUid username balanceMicroPi').lean();

    const applied = [];
    for (const u of targets) {
      const approvedMicro = aMap.get(String(u._id)) || 0;
      const paidMicro = pMap.get(String(u._id)) || 0;
      const correctMicro = Math.max(0, approvedMicro - paidMicro);
      if (correctMicro === u.balanceMicroPi) continue; // already correct
      // Optional scope: only fix a specific worker if piUid provided.
      if (req.body?.piUid && u.piUid !== req.body.piUid) continue;
      await User.updateOne({ _id: u._id }, { $set: { balanceMicroPi: correctMicro } });
      applied.push({ username: u.username, piUid: u.piUid, fromPi: toPi(u.balanceMicroPi), toPi: toPi(correctMicro) });
    }
    res.json({ ok: true, applied: applied.length, changes: applied });
  } catch (err) { next(err); }
});

/* ── Admin: geo-audit review (READ-ONLY) ──
   Surfaces submissions where the worker's declared country and IP-derived
   country disagree — evidence of possible country spoofing. Passive data only;
   nothing was blocked. Use this to decide whether to enable hard IP enforcement. */
app.get('/api/admin/geo-audit', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const withGeo = await Submission.find({ 'geoAudit.at': { $exists: true } })
      .populate('worker', 'username country')
      .populate('task', 'title allowedCountries')
      .sort({ 'geoAudit.at': -1 })
      .limit(500)
      .lean();

    const all = withGeo.map(s => ({
      submissionId: s._id,
      worker: s.worker?.username || '(unknown)',
      task: s.task?.title || null,
      taskRestricted: Array.isArray(s.task?.allowedCountries) && s.task.allowedCountries.length > 0,
      declaredCountry: s.geoAudit?.declaredCountry || null,
      ipCountry: s.geoAudit?.ipCountry || null,
      mismatch: !!s.geoAudit?.countryMismatch,
      at: s.geoAudit?.at || null,
    }));
    const mismatches = all.filter(x => x.mismatch);
    // Mismatches on country-restricted tasks are the ones that actually matter.
    const restrictedMismatches = mismatches.filter(x => x.taskRestricted);

    res.json({
      totalAudited: all.length,
      mismatchCount: mismatches.length,
      restrictedMismatchCount: restrictedMismatches.length,
      restrictedMismatches,
      recentMismatches: mismatches.slice(0, 50),
    });
  } catch (err) { next(err); }
});

/* ── Support: worker payment lookup ──────────────────────────────
* READ-ONLY. For "worker says I didn't get paid" support cases.
* Cross-references three sources for a worker's payouts:
*   1. MongoDB (our record: status, txid, amount)
*   2. Pi Platform API (Pi's view of each payment) — pi.getPayment
*   3. Horizon (on-chain truth) — by txid
* Also surfaces approved submissions that have no linked payout
* (the "approved but never paid" case). Writes nothing.
*/
app.get('/api/admin/worker-payment-lookup', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Provide ?q=<username|piUid>' });

    const user = await User.findOne({ $or: [{ username: q }, { piUid: q }] })
      .select('piUid username balanceMicroPi approvedCount rejectedCount isBanned').lean();
    if (!user) return res.status(404).json({ error: 'No worker matches that username or piUid' });

    const payouts = await Payment.find({ user: user._id, direction: 'A2U', purpose: 'worker_payout' })
      .sort({ createdAt: -1 }).lean();

    // Approved/auto-approved submissions and whether each has a linked payout
    const submissions = await Submission.find({
      worker: user._id, status: { $in: ['approved', 'auto_approved'] },
    }).select('rewardMicroPi payout status updatedAt task').sort({ updatedAt: -1 }).lean();
    const approvedNoPayout = submissions.filter((s) => !s.payout);

    // Enrich each payout with Pi Platform + Horizon truth, then classify.
    const rows = [];
    for (const p of payouts) {
      let piStatus = null, chain = null, note = null;
      try { const pp = await pi.getPayment(p.piPaymentId); piStatus = pp && pp.status ? pp.status : null; }
      catch (e) { note = `pi_api_error: ${e.message}`; }
      if (p.txid) {
        try { const tx = await pi.getHorizonTransaction(p.txid); chain = tx ? (tx.successful ? 'confirmed' : 'failed') : 'not_found'; }
        catch (e) { note = (note ? note + '; ' : '') + `horizon_error: ${e.message}`; }
      } else {
        chain = 'no_txid';
      }
      // Verdict: agreement across the three sources
      let verdict;
      if (p.status === 'completed' && chain === 'confirmed') verdict = 'paid_confirmed';
      else if (p.status === 'completed' && chain === 'not_found') verdict = 'db_says_paid_but_not_on_chain';
      else if (p.status === 'completed' && chain === 'no_txid') verdict = 'db_says_paid_but_no_txid';
      else if (p.status === 'cancelled' || p.status === 'failed') verdict = `not_paid_${p.status}`;
      else verdict = `pending_${p.status}`;
      rows.push({
        piPaymentId: p.piPaymentId,
        amountPi: toPi(p.amountMicroPi),
        dbStatus: p.status,
        piApiStatus: piStatus,
        chain,
        txid: p.txid || null,
        verdict,
        note,
        createdAt: p.createdAt,
      });
    }

    res.json({
      worker: {
        username: user.username, piUid: user.piUid,
        storedBalancePi: toPi(user.balanceMicroPi),
        approvedCount: user.approvedCount, rejectedCount: user.rejectedCount,
        isBanned: user.isBanned,
      },
      payoutCount: rows.length,
      payouts: rows,
      approvedSubmissionsWithoutPayout: approvedNoPayout.length,
      totalApprovedRewardPi: toPi(submissions.reduce((s, x) => s + (x.rewardMicroPi || 0), 0)),
    });
  } catch (err) { next(err); }
});

/* ── Support: payout wallet overview ─────────────────────────────
* READ-ONLY. App payout wallet balance + recent on-chain payments,
* from Horizon. Needs PI_WALLET_PUBLIC_KEY (public address, not the seed).
*/
app.get('/api/admin/wallet-overview', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const envPk = process.env.PI_WALLET_PUBLIC_KEY || null;

    // Source of truth: the public key DERIVED FROM THE SEED actually signs
    // payments. If the PI_WALLET_PUBLIC_KEY env var disagrees, the env var is
    // wrong — so we look up balances against the derived key and surface both.
    let derivedPk = null, deriveError = null;
    try {
      const seed = process.env.PI_WALLET_SEED;
      if (seed) derivedPk = StellarSdk.Keypair.fromSecret(seed).publicKey();
    } catch (e) { deriveError = e.message; }

    const pk = derivedPk || envPk;
    if (!pk) return res.status(503).json({ error: 'No wallet key available (PI_WALLET_SEED / PI_WALLET_PUBLIC_KEY unset)' });

    const account = await pi.getHorizonAccount(pk);
    const keyInfo = { activeKey: pk, derivedFromSeed: derivedPk, envPublicKey: envPk,
      keysMatch: !!(derivedPk && envPk && derivedPk === envPk), deriveError };

    if (!account) return res.json({ ...keyInfo, exists: false, balancePi: 0, recentPayments: [] });
    const recentPayments = await pi.getHorizonPayments(pk, 10);
    res.json({ ...keyInfo, exists: true, balancePi: account.balancePi, recentPayments });
  } catch (err) { next(err); }
});

/* ── Admin: review submissions auto-skipped as unpayable (e.g. recipient 404) ── */
app.get('/api/admin/unpayable-submissions', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const subs = await Submission.find({ 'payoutSkipped.at': { $exists: true } })
      .populate('worker', 'username piUid')
      .populate('task', 'title')
      .sort({ 'payoutSkipped.at': -1 })
      .lean();

    const items = subs.map(s => ({
      submissionId: s._id,
      worker: s.worker?.username || '(unknown)',
      piUid: s.worker?.piUid || null,
      task: s.task?.title || null,
      pi: (s.rewardMicroPi || 0) / 1e6,
      reason: s.payoutSkipped?.reason || null,
      httpStatus: s.payoutSkipped?.httpStatus || null,
      at: s.payoutSkipped?.at || null,
    }));

    // Group by worker so duplicate/phantom accounts are easy to spot.
    const byWorker = {};
    for (const it of items) {
      const key = `${it.worker}|${it.piUid || ''}`;
      (byWorker[key] = byWorker[key] || { worker: it.worker, piUid: it.piUid, count: 0, totalPi: 0 });
      byWorker[key].count++;
      byWorker[key].totalPi += it.pi;
    }

    res.json({
      total: items.length,
      totalPi: Number(items.reduce((a, b) => a + b.pi, 0).toFixed(6)),
      byWorker: Object.values(byWorker).sort((a, b) => b.count - a.count),
      items,
    });
  } catch (err) { next(err); }
});

/* ── Payments ── */
app.post('/api/payments/approve', requireAuth, async (req, res, next) => {
  try {
    const { paymentId, taskId } = req.body;
    const user = await currentUser(req);
    // Use taskId from client (in closure of payForTaskFunding) — avoids pi.getPayment()
    // which returns 404 on some Pi Platform environments before the payment settles.
    // Security: we still verify poster === authenticated user, so no spoofing risk.
    const task = await Task.findOne({ _id: taskId, poster: user._id, status: 'awaiting_funding' });
    if (!task) return res.status(400).json({ error: 'No matching unfunded task for this payment' });
    await Payment.findOneAndUpdate(
      { piPaymentId: paymentId },
      { direction: 'U2A', purpose: 'task_funding', user: user._id, task: task._id,
        amountMicroPi: task.grossDepositMicroPi, status: 'approved' },
      { upsert: true, setDefaultsOnInsert: true }
    );
    await pi.approvePayment(paymentId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.post('/api/payments/complete', requireAuth, async (req, res, next) => {
  try {
    const { paymentId, txid } = req.body;
    const user = await currentUser(req);
    const payment = await Payment.findOne({ piPaymentId: paymentId, user: user._id });
    if (!payment) return res.status(404).json({ error: 'Unknown payment' });
    if (payment.status === 'completed') {
      if (!payment.refId) await payment.save(); // backfill on the idempotent-retry path too
      return res.json({ ok: true, idempotent: true, refId: payment.refId });
    }
    await pi.completePayment(paymentId, txid);
    payment.status = 'completed'; payment.txid = txid; await payment.save(); // assigns refId if missing
    const task = await Task.findByIdAndUpdate(payment.task,
      { status: 'live', fundingPaymentId: paymentId }, { new: true });
    await PlatformLedger.create({ task: task._id, feeMicroPi: task.platformFeeMicroPi, sourcePaymentId: paymentId });
    if (!user.isKycVerified) { user.isKycVerified = true; await user.save(); }
    res.json({ ok: true, taskStatus: 'live', refId: payment.refId });
  } catch (err) { next(err); }
});

app.post('/api/payments/incomplete', requireAuth, async (req, res, next) => {
  try {
    const { payment } = req.body;
    const paymentId = payment?.identifier;
    const txid = payment?.transaction?.txid;
    if (!paymentId) return res.status(400).json({ error: 'payment.identifier required' });

    if (txid) {
      // Payment went through on-chain — complete it and activate the task
      await pi.completePayment(paymentId, txid);
      const pmtDoc = await Payment.findOneAndUpdate(
        { piPaymentId: paymentId }, { status: 'completed', txid }, { new: true }
      );
      if (pmtDoc?.task && pmtDoc.direction === 'U2A' && pmtDoc.purpose === 'task_funding') {
        const task = await Task.findByIdAndUpdate(pmtDoc.task,
          { status: 'live', fundingPaymentId: paymentId }, { new: true });
        if (task) {
          await PlatformLedger.findOneAndUpdate(
            { task: task._id }, // avoid duplicate ledger entry
            { feeMicroPi: task.platformFeeMicroPi, sourcePaymentId: paymentId, task: task._id },
            { upsert: true, setDefaultsOnInsert: true }
          );
          console.log('Incomplete U2A recovered — task now live:', task._id.toString());
        }
      }
    } else {
      // No on-chain record — Pi cancelled it; cancel our task too
      await pi.cancelPayment(paymentId);
      const pmtDoc = await Payment.findOneAndUpdate(
        { piPaymentId: paymentId }, { status: 'cancelled' }, { new: true }
      );
      if (pmtDoc?.task && pmtDoc.direction === 'U2A' && pmtDoc.purpose === 'task_funding') {
        await Task.findByIdAndUpdate(pmtDoc.task, { status: 'cancelled' });
        console.log('Incomplete U2A cancelled — task marked cancelled:', pmtDoc.task.toString());
      }
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ── Submissions ── */
app.post('/api/tasks/:id/submissions', requireAuth, requireFeature('submissions', 'Task submissions'), async (req, res, next) => {
  try {
    const worker = await currentUser(req);
    const { proofText = '', proofFileUrl: rawProofFileUrl = null } = req.body;

    // ── Close the "paste any URL" loophole ──
    // The client uploads screenshots to our image host and sends back the
    // resulting URL. Previously ANY string was accepted here, so a worker could
    // paste a link to any random image on the internet as their "proof".
    // We now only accept URLs served by the trusted host(s).
    const proofFileUrl = rawProofFileUrl ? String(rawProofFileUrl).trim() : null;
    if (proofFileUrl) {
      let host = '';
      try { host = new URL(proofFileUrl).hostname.toLowerCase(); }
      catch { return res.status(400).json({ error: 'Screenshot must be a valid URL.' }); }
      const ok = PROOF_IMAGE_HOSTS.some((h) => host === h || host.endsWith('.' + h));
      if (!ok) {
        return res.status(400).json({
          error: 'Screenshots must be uploaded through the app — external image links are not accepted.',
        });
      }
    }

    const task = await Task.findOne({ _id: req.params.id, status: 'live' });
    if (!task) return res.status(404).json({ error: 'Task not available' });
    if (task.poster.equals(worker._id)) return res.status(400).json({ error: 'Cannot work your own task' });
    // Country gate: if the task is restricted, the worker's declared country
    // must be in the allowed list. Empty list = global (no restriction).
    if (Array.isArray(task.allowedCountries) && task.allowedCountries.length > 0) {
      const myCountry = normCountry(worker.country);
      if (!myCountry) {
        return res.status(403).json({ error: 'This task is restricted by country. Set your country in your profile to continue.', countryRestricted: true, allowedCountries: task.allowedCountries });
      }
      if (!task.allowedCountries.includes(myCountry)) {
        return res.status(403).json({ error: `This task is only available to users in: ${task.allowedCountries.join(', ')}.`, countryRestricted: true, allowedCountries: task.allowedCountries });
      }
    }
    if (task.slotsFilled >= task.slots) return res.status(400).json({ error: 'Task is full' });
    const [isDuplicateImage, isRecycledImage] = proofFileUrl
      ? await Promise.all([
          Submission.exists({ task: task._id, proofFileUrl }),
          Submission.exists({ worker: worker._id, proofFileUrl }),
        ])
      : [false, false];
    const settings = await getPlatformSettings();
    const { verdict, reasons } = evaluateSubmission({
      proofText, proofFileUrl,
      isDuplicateImage: Boolean(isDuplicateImage),
      isRecycledImage: Boolean(isRecycledImage),
      worker, rewardMicroPi: task.rewardMicroPi,
      requireScreenshot: Boolean(task.requireScreenshot),
      requireManualReview: Boolean(task.requireManualReview),
      rejectionRateThreshold: settings.autoApproveRejectionRateThreshold,
      minDecisionsForRejectionCheck: settings.autoApproveMinDecisions,
    });
    if (verdict === 'auto_reject') {
      return res.status(422).json({ error: 'Submission rejected by quality check', reasons });
    }
    // Passive geo audit — record declared vs IP-derived country. Never blocks:
    // the lookup is best-effort with a short timeout and returns null on failure.
    let geoAudit;
    try {
      const declared = normCountry(worker.country) || null;
      const ipCountry = await lookupIpCountry(req.ip);
      geoAudit = {
        declaredCountry: declared,
        ipCountry: ipCountry || null,
        countryMismatch: !!(declared && ipCountry && declared !== ipCountry),
        ip: req.ip || null,
        at: new Date(),
      };
    } catch (_) { geoAudit = undefined; }

    const submission = await Submission.create({
      task: task._id, worker: worker._id, proofText, proofFileUrl,
      rewardMicroPi: task.rewardMicroPi,
      status: verdict === 'auto_approve' ? 'auto_approved' : 'pending',
      autoReview: { evaluated: true, verdict, reasons },
      ...(geoAudit ? { geoAudit } : {}),
    });
    if (verdict === 'auto_approve') {
      await settleApproval(submission._id);
      return res.status(201).json({ status: 'auto_approved', message: 'Payout queued' });
    }
    res.status(201).json({ status: 'pending', message: 'Sent to review queue' });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Already submitted to this task' });
    next(err);
  }
});

async function settleApproval(submissionId) {
  const sub = await Submission.findById(submissionId).populate('worker task');
  const { task, worker } = sub;
  if (task.escrowRemainingMicroPi < sub.rewardMicroPi) {
    sub.status = 'escrow_exhausted';
    sub.autoReview.reasons.push('Task escrow exhausted — no funds remaining');
    await sub.save();
    await User.findByIdAndUpdate(sub.worker, { $inc: { rejectedCount: 1 } });
    console.warn('Escrow exhausted for task', task._id, '- submission', sub._id, 'rejected');
    return;
  }
  task.escrowRemainingMicroPi -= sub.rewardMicroPi;
  task.slotsFilled += 1;
  if (task.slotsFilled >= task.slots) task.status = 'exhausted';
  await task.save();
  worker.approvedCount += 1;
  worker.balanceMicroPi += sub.rewardMicroPi;
  await worker.save();
  try {
    const a2u = await pi.createA2UPayment({
      uid: worker.piUid,
      amountPi: toPi(sub.rewardMicroPi),
      memo: ('TaskVerse reward: ' + task.title).slice(0, 100),
      metadata: { submissionId: sub._id.toString() },
    });
    const payment = await Payment.create({
      piPaymentId: a2u.identifier, txid: a2u.txid, direction: 'A2U', purpose: 'worker_payout',
      user: worker._id, task: task._id, amountMicroPi: sub.rewardMicroPi, status: 'completed',
    });
    sub.payout = payment._id;
    const record = await pi.getPayment(a2u.identifier);
    if (record?.transaction?.txid) {
      payment.status = 'completed'; payment.txid = record.transaction.txid; await payment.save();
      worker.balanceMicroPi -= sub.rewardMicroPi; await worker.save();
    }
  } catch (e) {
    console.error('A2U payout pending/failed, balance retained in escrow:', e.message);
  }
  await sub.save();
}

/* ── Admin: moderation queue ── */
app.get('/api/admin/queue', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const queue = await Submission.find({ status: 'pending' })
      .populate('worker', 'username isKycVerified approvedCount')
      .populate('task', 'title rewardMicroPi')
      .sort({ createdAt: 1 }).lean();
    res.json(queue);
  } catch (err) { next(err); }
});

app.post('/api/admin/submissions/:id/approve', requireAuth, requireAdmin, requireFeature('payouts', 'Payouts'), async (req, res, next) => {
  try {
    const sub = await Submission.findOneAndUpdate(
      { _id: req.params.id, status: 'pending' }, { status: 'approved' }, { new: true });
    if (!sub) return res.status(404).json({ error: 'Not in pending queue' });
    await settleApproval(sub._id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.post('/api/admin/submissions/:id/reject', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const sub = await Submission.findOneAndUpdate(
      { _id: req.params.id, status: 'pending' }, { status: 'disputed' }, { new: true });
    if (!sub) return res.status(404).json({ error: 'Not in pending queue' });
    await User.findByIdAndUpdate(sub.worker, { $inc: { rejectedCount: 1 } });
    await Dispute.create({ submission: sub._id, openedBy: sub.worker });
    res.json({ ok: true, movedTo: 'disputes' });
  } catch (err) { next(err); }
});

app.get('/api/admin/disputes', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const disputes = await Dispute.find({ status: 'open' })
      .populate({ path: 'submission', populate: ['worker', 'task'] }).lean();
    res.json(disputes);
  } catch (err) { next(err); }
});

app.post('/api/admin/disputes/:id/resolve', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { decision, note = '' } = req.body;
    const dispute = await Dispute.findOne({ _id: req.params.id, status: 'open' });
    if (!dispute) return res.status(404).json({ error: 'Dispute not open' });
    const sub = await Submission.findById(dispute.submission);
    if (decision === 'overturn') {
      sub.status = 'approved'; await sub.save();
      await User.findByIdAndUpdate(sub.worker, { $inc: { rejectedCount: -1 } });
      await settleApproval(sub._id);
      dispute.status = 'overturned';
    } else {
      sub.status = 'rejected'; await sub.save();
      dispute.status = 'upheld';
    }
    dispute.resolvedBy = (await currentUser(req))._id;
    dispute.resolutionNote = note;
    await dispute.save();
    res.json({ ok: true, status: dispute.status });
  } catch (err) { next(err); }
});

app.get('/api/admin/revenue', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [agg] = await PlatformLedger.aggregate([
      { $group: { _id: null, totalFeeMicroPi: { $sum: '$feeMicroPi' }, entries: { $sum: 1 } } },
    ]);
    res.json({ totalFeesPi: toPi(agg?.totalFeeMicroPi || 0), fundedTasks: agg?.entries || 0 });
  } catch (err) { next(err); }
});

/* ── Admin: create a sponsored task (goes live instantly, no Pi payment) ── */
app.post('/api/admin/tasks', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { title, description = '', rewardPi, slots } = req.body;
    const rewardMicro = microPi(rewardPi);
    const slotCount = parseInt(slots, 10);
    const settings = await getPlatformSettings();
    if (!title?.trim() || !(rewardMicro >= settings.minRewardMicroPi) || !(slotCount >= settings.minSlots)) {
      return res.status(400).json({
        error: `Valid title, reward (≥${toPi(settings.minRewardMicroPi)}π) and slots (≥${settings.minSlots}) required`,
      });
    }
    // Note: the max reward/slot caps intentionally don't apply here — those
    // exist to bound public posters' fee exposure, and admin-sponsored
    // campaigns are fee-free by design (see platformFeeMicroPi: 0 below).
    const rewardPool = rewardMicro * slotCount;
    const task = await Task.create({
      title: title.trim(),
      description: description.trim(),
      rewardMicroPi: rewardMicro,
      slots: slotCount,
      poster: req.session.userId,           // admin is the poster
      grossDepositMicroPi: rewardPool,
      platformFeeMicroPi: 0,                // no fee on sponsored tasks
      escrowRemainingMicroPi: rewardPool,
      status: 'live',                       // live immediately
      fundingPaymentId: 'admin_sponsored_' + Date.now(),
      allowedCountries: normCountryList(req.body.allowedCountries),
      requireScreenshot: Boolean(req.body.requireScreenshot),
      requireManualReview: Boolean(req.body.requireManualReview),
    });
    res.status(201).json({
      ok: true,
      taskId: task._id,
      title: task.title,
      slots: slotCount,
      rewardPi: toPi(rewardMicro),
    });
  } catch (err) { next(err); }
});

/* ── Worker: full profile ── */
app.get('/api/me', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    // avatar is select:false on the schema, so pull it explicitly.
    const withAvatar = await User.findById(user._id).select('+avatar').lean();
    const [history, postedTasks, openDisputes] = await Promise.all([
      Submission.find({ worker: user._id })
        .populate('task', 'title').sort({ createdAt: -1 }).limit(50).lean(),
      Task.find({ poster: user._id, archived: { $ne: true } }).sort({ createdAt: -1 }).limit(50).lean(),
      Dispute.find({ openedBy: user._id, status: 'open' })
        .populate({ path: 'submission', populate: { path: 'task', select: 'title' } })
        .sort({ createdAt: -1 }).lean(),
    ]);
    // Funding receipt reference for each posted task (admin-sponsored tasks
    // have no U2A payment behind them, so they simply won't have one here —
    // that's correct, not a bug).
    const fundingPayments = await Payment.find({
      task: { $in: postedTasks.map((t) => t._id) }, direction: 'U2A', purpose: 'task_funding',
    }).select('task refId').lean();
    const fundingRefByTask = Object.fromEntries(fundingPayments.map((p) => [p.task.toString(), p.refId]));
    res.json({
      username: user.username,
      isAdmin: isAdmin(user.username),
      isKycVerified: user.isKycVerified,
      country: user.country || '',
      avatar: withAvatar?.avatar || '',
      avatarBlocked: !!user.avatarBlocked,
      balance: toPi(user.balanceMicroPi),
      approvedCount: user.approvedCount,
      history: history.map((h) => ({
        title: h.task?.title, reward: toPi(h.rewardMicroPi), status: h.status, date: h.createdAt,
      })),
      postedTasks: postedTasks.map((t) => ({
        id: t._id, title: t.title, slots: t.slots, slotsFilled: t.slotsFilled,
        status: t.status, reward: toPi(t.rewardMicroPi), createdAt: t.createdAt,
        fundingRefId: fundingRefByTask[t._id.toString()] || null,
      })),
      openDisputes: openDisputes.map((d) => ({
        id: d._id,
        taskTitle: d.submission?.task?.title || 'Unknown task',
        proofText: d.submission?.proofText || '',
        hasStatement: Boolean(d.workerStatement),
        workerStatement: d.workerStatement || '',
        createdAt: d.createdAt,
      })),
    });
  } catch (err) { next(err); }
});

/* ── Worker: set declared country (for country-targeted tasks) ── */
app.patch('/api/me/country', requireAuth, async (req, res, next) => {
  try {
    const country = normCountry(req.body.country);
    if (req.body.country && !country) {
      return res.status(400).json({ error: 'Country must be a 2-letter ISO code (e.g. NG).' });
    }
    const user = await currentUser(req);
    user.country = country; // '' clears it
    await user.save();
    res.json({ ok: true, country: user.country });
  } catch (err) { next(err); }
});

/* ── Avatars ─────────────────────────────────────────────────────
   Stored as a base64 data URL on the user doc. The client resizes and
   compresses before sending; the server still validates independently
   (never trust the client). Hard caps below are the real defence. */

// Max stored avatar size. ~120KB of base64 ≈ ~90KB of image bytes — far more
// than a 256x256 JPEG needs, but leaves headroom. Keeps Mongo docs small.
const AVATAR_MAX_CHARS = 120_000;
// Only real raster image types. No SVG: SVG can carry scripts (XSS risk).
const AVATAR_ALLOWED = /^data:image\/(jpeg|png|webp);base64,/;

app.put('/api/me/avatar', requireAuth, async (req, res, next) => {
  try {
    const { avatar } = req.body || {};
    if (typeof avatar !== 'string' || !avatar) {
      return res.status(400).json({ error: 'avatar (data URL) required' });
    }
    if (!AVATAR_ALLOWED.test(avatar)) {
      return res.status(415).json({ error: 'Avatar must be a JPEG, PNG or WebP image.' });
    }
    if (avatar.length > AVATAR_MAX_CHARS) {
      return res.status(413).json({ error: 'Image too large. Please choose a smaller picture.' });
    }
    // Validate the base64 payload actually decodes — rejects malformed junk.
    const b64 = avatar.slice(avatar.indexOf(',') + 1);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
      return res.status(400).json({ error: 'Malformed image data.' });
    }

    const user = await currentUser(req);
    if (user.avatarBlocked) {
      return res.status(403).json({ error: 'Avatar uploads are disabled on your account. Contact support.' });
    }
    user.avatar = avatar;
    await user.save();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Remove own avatar.
app.delete('/api/me/avatar', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    user.avatar = '';
    await user.save();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Fetch a user's avatar by piUid (avatar is select:false, so fetch explicitly).
// Public to signed-in users so avatars can show on the leaderboard/queue.
app.get('/api/avatar/:piUid', requireAuth, async (req, res, next) => {
  try {
    const u = await User.findOne({ piUid: req.params.piUid }).select('+avatar').lean();
    res.json({ avatar: (u && !u.avatarBlocked && u.avatar) ? u.avatar : '' });
  } catch (err) { next(err); }
});

/* ── Announcements ───────────────────────────────────────────────
   Lets the operator talk to users (payout delays, maintenance, new features)
   without needing a code deploy. */

// Worker: the current announcement, if any and if not already dismissed.
app.get('/api/announcement', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const a = await Announcement.findOne({ active: true }).sort({ createdAt: -1 }).lean();
    if (!a) return res.json({ announcement: null });
    const dismissed = (a.dismissedBy || []).some((id) => String(id) === String(user._id));
    if (dismissed) return res.json({ announcement: null });
    res.json({
      announcement: {
        id: a._id,
        title: a.title,
        body: a.body,
        level: a.level,
        linkUrl: a.linkUrl || '',
        linkLabel: a.linkLabel || '',
        createdAt: a.createdAt,
      },
    });
  } catch (err) { next(err); }
});

// Worker: dismiss it (per-user, so it doesn't nag).
app.post('/api/announcement/:id/dismiss', requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'bad id' });
    const user = await currentUser(req);
    await Announcement.updateOne(
      { _id: req.params.id },
      { $addToSet: { dismissedBy: user._id } }
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Admin: list recent announcements (so you can see what you've sent).
app.get('/api/admin/announcements', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const list = await Announcement.find()
      .sort({ createdAt: -1 }).limit(20)
      .select('title body level active linkUrl linkLabel createdAt dismissedBy')
      .lean();
    res.json({
      announcements: list.map((a) => ({
        id: a._id,
        title: a.title,
        body: a.body,
        level: a.level,
        active: a.active,
        linkUrl: a.linkUrl || '',
        linkLabel: a.linkLabel || '',
        dismissCount: (a.dismissedBy || []).length,
        createdAt: a.createdAt,
      })),
    });
  } catch (err) { next(err); }
});

// Admin: publish a new announcement. Only one is active at a time, so
// publishing deactivates the others — no confusing stack of banners.
app.post('/api/admin/announcements', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const title = String(req.body?.title || '').trim();
    const body = String(req.body?.body || '').trim();
    const level = ['info', 'warning', 'success'].includes(req.body?.level) ? req.body.level : 'info';
    const linkUrl = String(req.body?.linkUrl || '').trim();
    const linkLabel = String(req.body?.linkLabel || '').trim().slice(0, 40);

    if (!title || !body) return res.status(400).json({ error: 'Title and message are required.' });
    if (title.length > 80) return res.status(400).json({ error: 'Title is too long (max 80).' });
    if (body.length > 600) return res.status(400).json({ error: 'Message is too long (max 600).' });
    // Only allow real web links (this is rendered as a clickable CTA).
    if (linkUrl && !/^https?:\/\//i.test(linkUrl)) {
      return res.status(400).json({ error: 'Link must start with http:// or https://' });
    }

    const admin = await currentUser(req);
    await Announcement.updateMany({ active: true }, { $set: { active: false } });
    const a = await Announcement.create({
      title, body, level, linkUrl, linkLabel, active: true, createdBy: admin._id,
    });
    res.status(201).json({ ok: true, id: a._id });
  } catch (err) { next(err); }
});

// Admin: take the current announcement down (or bring one back).
app.patch('/api/admin/announcements/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'bad id' });
    const active = Boolean(req.body?.active);
    if (active) await Announcement.updateMany({ active: true }, { $set: { active: false } });
    const a = await Announcement.findByIdAndUpdate(
      req.params.id, { $set: { active } }, { new: true }
    );
    if (!a) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, active: a.active });
  } catch (err) { next(err); }
});

app.delete('/api/admin/announcements/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'bad id' });
    await Announcement.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ── Banners ──────────────────────────────────────────────────────
   Promo carousel on the home feed — used to cross-promote the operator's
   own apps (e.g. Zappi NG). Several can be active at once (unlike
   Announcements), ordered by `order`. Image stored inline as base64,
   same pattern as User.avatar, so no external image host is needed. */

// Max stored banner image size. Wider/taller than an avatar (it's a promo
// graphic, not a thumbnail) but still well under the 1mb JSON body limit.
const BANNER_IMAGE_MAX_CHARS = 400_000;
const BANNER_IMAGE_ALLOWED = /^data:image\/(jpeg|png|webp);base64,/;

function validateBannerImage(image) {
  if (typeof image !== 'string' || !image) return 'Banner image is required.';
  if (!BANNER_IMAGE_ALLOWED.test(image)) return 'Image must be a JPEG, PNG or WebP.';
  if (image.length > BANNER_IMAGE_MAX_CHARS) return 'Image too large. Please choose a smaller/more compressed image.';
  const b64 = image.slice(image.indexOf(',') + 1);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return 'Malformed image data.';
  return null;
}

// Worker: active banners for the home carousel, in display order.
app.get('/api/banners', requireAuth, async (req, res, next) => {
  try {
    const list = await Banner.find({ active: true })
      .sort({ order: 1, createdAt: -1 })
      .select('image linkUrl linkLabel')
      .lean();
    res.json({
      banners: list.map((b) => ({
        id: b._id, image: b.image, linkUrl: b.linkUrl, linkLabel: b.linkLabel || '',
      })),
    });
  } catch (err) { next(err); }
});

// Admin: list all banners (active + inactive) for management.
app.get('/api/admin/banners', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const list = await Banner.find().sort({ order: 1, createdAt: -1 }).lean();
    res.json({
      banners: list.map((b) => ({
        id: b._id, title: b.title, image: b.image, linkUrl: b.linkUrl,
        linkLabel: b.linkLabel || '', active: b.active, order: b.order, createdAt: b.createdAt,
      })),
    });
  } catch (err) { next(err); }
});

// Admin: create a banner.
app.post('/api/admin/banners', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const title = String(req.body?.title || '').trim();
    const linkUrl = String(req.body?.linkUrl || '').trim();
    const linkLabel = String(req.body?.linkLabel || '').trim().slice(0, 40);
    const order = Number.isFinite(Number(req.body?.order)) ? Number(req.body.order) : 0;
    const image = req.body?.image;

    if (!title) return res.status(400).json({ error: 'Title is required.' });
    if (title.length > 80) return res.status(400).json({ error: 'Title is too long (max 80).' });
    if (!linkUrl || !/^https?:\/\//i.test(linkUrl)) {
      return res.status(400).json({ error: 'Link must start with http:// or https://' });
    }
    const imgErr = validateBannerImage(image);
    if (imgErr) return res.status(415).json({ error: imgErr });

    const admin = await currentUser(req);
    const b = await Banner.create({
      title, image, linkUrl, linkLabel, order, active: true, createdBy: admin._id,
    });
    res.status(201).json({ ok: true, id: b._id });
  } catch (err) { next(err); }
});

// Admin: update a banner (toggle active, reorder, or edit fields).
app.patch('/api/admin/banners/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'bad id' });
    const updates = {};
    if (req.body?.active !== undefined) updates.active = Boolean(req.body.active);
    if (req.body?.order !== undefined && Number.isFinite(Number(req.body.order))) updates.order = Number(req.body.order);
    if (req.body?.title !== undefined) {
      const title = String(req.body.title).trim();
      if (!title || title.length > 80) return res.status(400).json({ error: 'Title must be 1-80 characters.' });
      updates.title = title;
    }
    if (req.body?.linkUrl !== undefined) {
      const linkUrl = String(req.body.linkUrl).trim();
      if (!linkUrl || !/^https?:\/\//i.test(linkUrl)) {
        return res.status(400).json({ error: 'Link must start with http:// or https://' });
      }
      updates.linkUrl = linkUrl;
    }
    if (req.body?.linkLabel !== undefined) updates.linkLabel = String(req.body.linkLabel).trim().slice(0, 40);
    if (req.body?.image !== undefined) {
      const imgErr = validateBannerImage(req.body.image);
      if (imgErr) return res.status(415).json({ error: imgErr });
      updates.image = req.body.image;
    }

    const b = await Banner.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true });
    if (!b) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.delete('/api/admin/banners/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'bad id' });
    await Banner.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ── Feature flags admin ────────────────────────────────────────
   Emergency brake for posting/submissions/payouts, plus a global
   'maintenance' switch. Mirrors Zappi NG's Flags tab: pick a known
   feature that doesn't have a flag yet, create it, then toggle it. */

// Everyone signed in: current on/off state for every known feature, plus
// whether the app is in maintenance mode. Frontend uses this to grey out
// buttons and show the maintenance splash — always a complete, correct
// picture even before any flag row exists (see isFeatureEnabled above).
app.get('/api/flags', requireAuth, async (req, res, next) => {
  try {
    const maintenance = await isMaintenanceActive();
    const [posting, submissions, payouts] = await Promise.all([
      isFeatureEnabled('posting'), isFeatureEnabled('submissions'), isFeatureEnabled('payouts'),
    ]);
    res.json({ flags: { posting, submissions, payouts, maintenance } });
  } catch (err) { next(err); }
});

// Admin: full list of known features, each with its current flag (or null if
// no flag has been created for it yet — i.e. it's using the default).
app.get('/api/admin/flags', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const rows = await FeatureFlag.find().sort({ key: 1 }).lean();
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    res.json({
      features: KNOWN_FEATURES.map((f) => {
        const row = byKey[f.key];
        // Default when no row exists yet: 'maintenance' defaults OFF,
        // everything else defaults ON (allowed) — see isFeatureEnabled above.
        const defaultEnabled = f.key !== 'maintenance';
        return {
          ...f,
          exists: Boolean(row),
          enabled: row ? row.enabled : defaultEnabled,
          updatedAt: row?.updatedAt || null,
        };
      }),
    });
  } catch (err) { next(err); }
});

// Admin: create a flag row for a known feature. Starts in its normal/safe
// state — 'maintenance' starts OFF, everything else starts ON (allowed) —
// so simply creating a row never itself changes behavior; the admin still
// has to flip it.
app.post('/api/admin/flags', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const key = String(req.body?.key || '').trim();
    const known = KNOWN_FEATURES.find((f) => f.key === key);
    if (!known) return res.status(400).json({ error: 'Unknown feature key.' });
    const existing = await FeatureFlag.findOne({ key });
    if (existing) return res.status(409).json({ error: 'That flag already exists.' });
    const admin = await currentUser(req);
    await FeatureFlag.create({ key, enabled: key !== 'maintenance', updatedBy: admin._id });
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// Admin: toggle a flag on/off.
app.patch('/api/admin/flags/:key', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const key = String(req.params.key || '').trim();
    const known = KNOWN_FEATURES.find((f) => f.key === key);
    if (!known) return res.status(400).json({ error: 'Unknown feature key.' });
    const enabled = Boolean(req.body?.enabled);
    const admin = await currentUser(req);
    const flag = await FeatureFlag.findOneAndUpdate(
      { key }, { $set: { enabled, updatedBy: admin._id } }, { new: true, upsert: true }
    );
    res.json({ ok: true, enabled: flag.enabled });
  } catch (err) { next(err); }
});

// Admin: delete a flag row (reverts that feature to its default: enabled).
app.delete('/api/admin/flags/:key', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await FeatureFlag.findOneAndDelete({ key: String(req.params.key || '').trim() });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ── Platform settings ────────────────────────────────────────────
   Admin-editable fee rate, reward/slot limits, and auto-approve
   thresholds — previously hardcoded/env-only, now live-tunable. */

// Any signed-in user: display-friendly current values, for CreateTask to
// show an accurate fee estimate and input bounds instead of guessing.
app.get('/api/settings', requireAuth, async (req, res, next) => {
  try {
    const s = await getPlatformSettings();
    res.json({
      feeRate: s.feeRate,
      minRewardPi: toPi(s.minRewardMicroPi),
      maxRewardPi: s.maxRewardMicroPi ? toPi(s.maxRewardMicroPi) : null,
      minSlots: s.minSlots,
      maxSlots: s.maxSlots,
    });
  } catch (err) { next(err); }
});

// Admin: full current values (including auto-approve thresholds, which
// aren't relevant to show a regular user) plus whether each has been
// explicitly overridden or is still using the built-in default.
app.get('/api/admin/settings', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const row = await PlatformSettings.findById('global').lean();
    const s = await getPlatformSettings();
    res.json({
      settings: s,
      overridden: Object.fromEntries(
        Object.keys(SETTINGS_DEFAULTS).map((k) => [k, Boolean(row && row[k] !== null && row[k] !== undefined)])
      ),
    });
  } catch (err) { next(err); }
});

// Admin: update one or more settings. Sending a field as null resets it to
// the built-in default (removes the override) rather than deleting the doc.
app.patch('/api/admin/settings', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const updates = {};

    const setNum = (key, { min, max, integer = false } = {}) => {
      if (!(key in body)) return null;
      if (body[key] === null || body[key] === '') { updates[key] = null; return null; }
      const n = Number(body[key]);
      if (!Number.isFinite(n)) return `${key} must be a number.`;
      if (integer && !Number.isInteger(n)) return `${key} must be a whole number.`;
      if (min !== undefined && n < min) return `${key} must be at least ${min}.`;
      if (max !== undefined && n > max) return `${key} must be at most ${max}.`;
      updates[key] = n;
      return null;
    };

    let error =
      setNum('feeRate', { min: 0, max: 0.5 }) ||
      setNum('minRewardMicroPi', { min: 1 }) ||
      setNum('maxRewardMicroPi', { min: 1 }) ||
      setNum('minSlots', { min: 1, integer: true }) ||
      setNum('maxSlots', { min: 1, integer: true }) ||
      setNum('autoApproveRejectionRateThreshold', { min: 0, max: 1 }) ||
      setNum('autoApproveMinDecisions', { min: 1, integer: true });
    if (error) return res.status(400).json({ error });

    // Cross-field sanity: if both min and max are ending up set, min <= max.
    const merged = { ...(await getPlatformSettings()), ...updates };
    if (merged.maxRewardMicroPi && merged.minRewardMicroPi > merged.maxRewardMicroPi) {
      return res.status(400).json({ error: 'Min reward cannot be greater than max reward.' });
    }
    if (merged.maxSlots && merged.minSlots > merged.maxSlots) {
      return res.status(400).json({ error: 'Min slots cannot be greater than max slots.' });
    }

    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields to update.' });

    const admin = await currentUser(req);
    await PlatformSettings.findByIdAndUpdate(
      'global', { $set: { ...updates, updatedBy: admin._id } }, { upsert: true }
    );
    res.json({ ok: true, settings: await getPlatformSettings() });
  } catch (err) { next(err); }
});

/* ── Admin: transactions ──────────────────────────────────────────
   Every Payment record — task funding (U2A), worker payouts (A2U), and
   withdrawals — in one browsable, filterable place, each with a short
   refId a user can quote in a support message for a direct lookup. */

// Any Payment missing a refId (created via a findOneAndUpdate upsert, which
// bypasses the pre('save') hook in models.js) gets one assigned the first
// time it's viewed here — self-healing, no migration script needed.
async function backfillRefIds(paymentDocs) {
  const missing = paymentDocs.filter((p) => !p.refId);
  if (missing.length === 0) return;
  const full = await Payment.find({ _id: { $in: missing.map((p) => p._id) } });
  for (const doc of full) {
    // eslint-disable-next-line no-await-in-loop
    await doc.save(); // pre('save') assigns refId when missing
  }
  const byId = Object.fromEntries(full.map((d) => [d._id.toString(), d.refId]));
  for (const p of missing) p.refId = byId[p._id.toString()] || p.refId;
}

app.get('/api/admin/transactions', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const mapPayment = (p) => ({
      id: p._id, refId: p.refId, direction: p.direction, purpose: p.purpose, status: p.status,
      amountPi: toPi(p.amountMicroPi), piPaymentId: p.piPaymentId, txid: p.txid || null,
      user: p.user ? { id: p.user._id, username: p.user.username, piUid: p.user.piUid } : null,
      task: p.task ? { id: p.task._id, title: p.task.title } : null,
      createdAt: p.createdAt, updatedAt: p.updatedAt,
    });

    const ref = String(req.query.ref || '').trim().toUpperCase();

    // Exact refId lookup — "the quick and straight look-up" — short-circuits
    // all other filters/pagination since it's a single-record answer.
    if (ref) {
      const normalizedRef = ref.startsWith('TXV-') ? ref : `TXV-${ref}`;
      let payment = await Payment.findOne({ refId: normalizedRef })
        .populate('user', 'username piUid').populate('task', 'title').lean();
      if (!payment) {
        // Also accept a bare piPaymentId or txid, for older/edge-case records.
        payment = await Payment.findOne({ $or: [{ piPaymentId: ref }, { txid: ref }] })
          .populate('user', 'username piUid').populate('task', 'title').lean();
      }
      if (!payment) return res.status(404).json({ error: `No transaction matches "${req.query.ref}".` });
      if (!payment.refId) await backfillRefIds([payment]);
      return res.json({ transactions: [mapPayment(payment)], total: 1, page: 1, limit: 1, hasMore: false });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const filter = {};
    if (req.query.direction && ['U2A', 'A2U'].includes(req.query.direction)) filter.direction = req.query.direction;
    if (req.query.purpose && ['task_funding', 'worker_payout', 'withdrawal'].includes(req.query.purpose)) filter.purpose = req.query.purpose;
    if (req.query.status && ['created', 'approved', 'completed', 'cancelled', 'failed'].includes(req.query.status)) filter.status = req.query.status;

    const userQuery = String(req.query.user || '').trim();
    if (userQuery) {
      const rx = new RegExp(escapeRegex(userQuery), 'i');
      const matchingUsers = await User.find({ $or: [{ username: rx }, { piUid: rx }] }).select('_id').lean();
      filter.user = { $in: matchingUsers.map((u) => u._id) };
    }

    const [rows, total] = await Promise.all([
      Payment.find(filter)
        .populate('user', 'username piUid').populate('task', 'title')
        .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Payment.countDocuments(filter),
    ]);

    await backfillRefIds(rows);

    res.json({
      transactions: rows.map(mapPayment),
      total, page, limit, hasMore: page * limit < total,
    });
  } catch (err) { next(err); }
});

/* ── Admin: user list & search ────────────────────────────────────
   Replaces pasting a raw piUid into a box blindly — browse/search users,
   then act on the row directly (ban, unblock avatar, look up payments). */

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const filter = {};
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ username: rx }, { piUid: rx }];
    }
    if (req.query.banned === 'true') filter.isBanned = true;
    if (req.query.banned === 'false') filter.isBanned = false;

    const [rows, total] = await Promise.all([
      User.find(filter)
        .select('piUid username balanceMicroPi approvedCount rejectedCount isBanned avatarBlocked country lastLoginAt createdAt')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    res.json({
      users: rows.map((u) => ({
        id: u._id, piUid: u.piUid, username: u.username,
        balancePi: toPi(u.balanceMicroPi), approvedCount: u.approvedCount, rejectedCount: u.rejectedCount,
        isBanned: u.isBanned, avatarBlocked: u.avatarBlocked, country: u.country || '',
        lastLoginAt: u.lastLoginAt, createdAt: u.createdAt,
      })),
      total, page, limit, hasMore: page * limit < total,
    });
  } catch (err) { next(err); }
});

// Ban/unban a user by their Mongo _id (from the list above). Banned users
// can't authenticate (see currentUser()) and are blocked from working tasks.
app.patch('/api/admin/users/:id/ban', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'bad id' });
    const banned = Boolean(req.body?.banned);
    const u = await User.findByIdAndUpdate(req.params.id, { $set: { isBanned: banned } }, { new: true })
      .select('username isBanned');
    if (!u) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true, username: u.username, isBanned: u.isBanned });
  } catch (err) { next(err); }
});

/* ── Admin: remove an inappropriate avatar ──
   Clears the image and blocks re-upload until an admin unblocks. This is the
   moderation safety valve for user-uploaded pictures. */
app.post('/api/admin/avatar-remove', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { piUid, unblock } = req.body || {};
    if (!piUid) return res.status(400).json({ error: 'piUid required' });
    const u = await User.findOne({ piUid });
    if (!u) return res.status(404).json({ error: 'User not found' });

    if (unblock) {
      u.avatarBlocked = false;
      await u.save();
      return res.json({ ok: true, username: u.username, avatarBlocked: false });
    }
    u.avatar = '';
    u.avatarBlocked = true;
    await u.save();
    res.json({ ok: true, username: u.username, avatarBlocked: true, message: 'Avatar removed and uploads blocked.' });
  } catch (err) { next(err); }
});

/* ── Worker: appeal statement ── */
app.post('/api/me/disputes/:id/statement', requireAuth, async (req, res, next) => {
  try {
    const { statement } = req.body;
    if (!statement?.trim()) return res.status(400).json({ error: 'Statement text required' });
    const dispute = await Dispute.findOneAndUpdate(
      { _id: req.params.id, openedBy: req.session.userId, status: 'open' },
      { workerStatement: statement.trim().slice(0, 2000) },
      { new: true }
    );
    if (!dispute) return res.status(404).json({ error: 'Dispute not found or not open' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ── Admin: cancel tasks stuck in awaiting_funding > N hours ── */
app.post('/api/admin/cancel-stale-funding', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const hoursOld = Math.max(1, parseInt(req.body.hoursOld ?? 24, 10));
    const cutoff = new Date(Date.now() - hoursOld * 3600_000);

    const staleTasks = await Task.find({
      status: 'awaiting_funding',
      createdAt: { $lt: cutoff },
    }).lean();

    let cancelled = 0;
    let recovered = 0;
    let skipped = 0;
    const details = [];

    for (const task of staleTasks) {
      const ageStr = Math.round((Date.now() - new Date(task.createdAt)) / 3600_000) + 'h';
      const pmt = await Payment.findOne({ task: task._id, direction: 'U2A', status: { $in: ['approved', 'created'] } });

      // Before cancelling, check whether Pi shows the payment actually completed on-chain.
      // The frontend onReadyForServerCompletion callback (which calls /payments/complete)
      // can fail to fire (closed tab, dropped connection) even after the wallet confirmed,
      // leaving the task in awaiting_funding while the payment genuinely succeeded.
      if (pmt) {
        let record;
        try {
          record = await pi.getPayment(pmt.piPaymentId);
        } catch (piErr) {
          // Pi API unreachable/errored -- don't guess. Leave task as-is for a later run.
          console.warn('cancel-stale: pi.getPayment failed, skipping task:', task._id.toString(), piErr.message);
          skipped++;
          details.push({ taskId: task._id, title: task.title, age: ageStr, action: 'skipped', reason: piErr.message });
          continue;
        }

        if (record?.transaction?.txid) {
          // Payment completed on-chain -- recover the task instead of cancelling.
          // Mirrors the /payments/incomplete recovery path.
          const txid = record.transaction.txid;
          try {
            if (!record.status?.developer_completed) {
              await pi.completePayment(pmt.piPaymentId, txid);
            }
          } catch (completeErr) {
            console.warn('cancel-stale: completePayment during recovery failed (continuing):', completeErr.message);
          }
          await Payment.findByIdAndUpdate(pmt._id, { status: 'completed', txid });
          const liveTask = await Task.findByIdAndUpdate(task._id,
            { status: 'live', fundingPaymentId: pmt.piPaymentId }, { new: true });
          if (liveTask) {
            await PlatformLedger.findOneAndUpdate(
              { task: liveTask._id }, // avoid duplicate ledger entry
              { feeMicroPi: liveTask.platformFeeMicroPi, sourcePaymentId: pmt.piPaymentId, task: liveTask._id },
              { upsert: true, setDefaultsOnInsert: true }
            );
          }
          recovered++;
          details.push({ taskId: task._id, title: task.title, age: ageStr, action: 'recovered', txid });
          continue;
        }

        // No on-chain transaction -- safe to cancel the Pi payment too.
        try {
          await pi.cancelPayment(pmt.piPaymentId);
          await Payment.findByIdAndUpdate(pmt._id, { status: 'cancelled' });
        } catch (piErr) {
          // Pi may have already cancelled it -- proceed to mark task anyway
          console.warn('pi.cancelPayment failed (may already be cancelled):', piErr.message);
        }
      }

      await Task.findByIdAndUpdate(task._id, { status: 'cancelled' });
      cancelled++;
      details.push({ taskId: task._id, title: task.title, age: ageStr, action: 'cancelled' });
    }

    res.json({ ok: true, scanned: staleTasks.length, cancelled, recovered, skipped, details });
  } catch (err) { next(err); }
});

/* ── Admin: reconcile pending A2U payouts ── */
app.post('/api/admin/reconcile', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const pendingA2U = await Payment.find({ direction: 'A2U', status: 'created' })
      .populate('user', 'piUid balanceMicroPi').lean();

    const results = { scanned: pendingA2U.length, completed: 0, stillPending: 0, failed: 0, errors: [] };

    for (const payment of pendingA2U) {
      try {
        const record = await pi.getPayment(payment.piPaymentId);
        if (record?.transaction?.txid) {
          await Payment.findByIdAndUpdate(payment._id, { status: 'completed', txid: record.transaction.txid });
          // Deduct from worker balance — was credited in settleApproval but Pi just left escrow
          await User.findByIdAndUpdate(payment.user._id, { $inc: { balanceMicroPi: -payment.amountMicroPi } });
          results.completed++;
        } else {
          results.stillPending++;
        }
      } catch (err) {
        results.failed++;
        results.errors.push(payment.piPaymentId + ': ' + err.message);
      }
    }

    res.json({ ok: true, ...results });
  } catch (err) { next(err); }
});

/* ── Admin: reconcile unpaid A2U — fires Testnet A2U for approved subs with no payout ── */
app.post('/api/admin/reconcile-a2u', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { submissionId, limit, dryRun } = req.body || {};

    const baseQuery = {
      status: { $in: ['approved', 'auto_approved'] },
      payout: { $exists: false },
      // Exclude submissions previously marked unpayable (e.g. recipient 404),
      // unless the caller explicitly opts to retry them with {includeSkipped:true}.
      ...(req.body?.includeSkipped ? {} : { 'payoutSkipped.at': { $exists: false } }),
    };

    // Validate submissionId up front: must be a real ObjectId, else reject loudly
    // (rather than silently building a query that matches nothing or everything).
    if (submissionId !== undefined && submissionId !== null && submissionId !== '') {
      if (!mongoose.Types.ObjectId.isValid(submissionId)) {
        return res.status(400).json({ error: `submissionId is not a valid id: ${submissionId}` });
      }
      baseQuery._id = new mongoose.Types.ObjectId(submissionId);
    }
    const hasSubmissionId = baseQuery._id !== undefined;

    let unpaidQuery = Submission.find(baseQuery).populate('worker').populate('task');
    const parsedLimit = Number.isInteger(limit) && limit > 0 ? limit : null;
    if (!hasSubmissionId && parsedLimit) unpaidQuery = unpaidQuery.limit(parsedLimit);
    const unpaid = await unpaidQuery;

    const selection = unpaid.map(s => ({
      id: s._id.toString(), worker: s.worker?.username, piUid: s.worker?.piUid, pi: s.rewardMicroPi / 1e6
    }));

    // DRY-RUN: triggered explicitly via {dryRun:true} OR implicitly when neither
    // submissionId nor limit is given. Runs the FULL selection logic and returns
    // exactly which submissions WOULD be paid. Sends nothing.
    if (dryRun || (!hasSubmissionId && !parsedLimit)) {
      const totalUnpaid = await Submission.countDocuments({
        status: { $in: ['approved', 'auto_approved'] }, payout: { $exists: false }
      });
      return res.json({
        dryRun: true,
        receivedSubmissionId: submissionId ?? null,
        receivedLimit: parsedLimit,
        wouldPayCount: selection.length,
        wouldPay: selection,
        totalUnpaid,
        message: (!hasSubmissionId && !parsedLimit)
          ? 'No submissionId or limit provided — nothing was paid.'
          : 'dryRun=true — nothing was paid. These are the submissions that WOULD be paid.',
      });
    }

    // GUARD: never start a send while Pi already has an incomplete A2U — that is
    // how the previous blocker formed. Bail out and report it instead.
    try {
      const pre = await pi.getIncompleteServerPayments();
      const preItems = Array.isArray(pre) ? pre : (pre?.incomplete_server_payments || []);
      if (preItems.length > 0) {
        return res.status(409).json({
          error: 'Pi already has an incomplete A2U payment — clear it before sending.',
          incompleteIds: preItems.map(p => p.identifier),
        });
      }
    } catch (e) {
      return res.status(502).json({ error: 'Could not verify incomplete-payments state: ' + e.message });
    }

    const results = [];
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    // Throttle config (overridable via body): Pi rate-limits A2U, so we pace
    // sends and back off on 429 instead of failing.
    const delayMs = Number.isInteger(req.body?.delayMs) ? req.body.delayMs : 3000;
    const maxRetries = Number.isInteger(req.body?.maxRetries) ? req.body.maxRetries : 4;
    let hardStop = false;

    for (let idx = 0; idx < unpaid.length; idx++) {
      const sub = unpaid[idx];
      if (hardStop) { results.push({ id: sub._id, skippedDueToStop: true }); continue; }
      if (!sub.worker?.piUid) {
        results.push({ id: sub._id, error: 'no piUid', worker: sub.worker?.username });
        continue;
      }

      let createdId = null;
      let attempt = 0;
      let done = false;

      while (!done) {
        attempt++;
        try {
          const a2u = await pi.createA2UPayment({
            uid: sub.worker.piUid,
            amountPi: sub.rewardMicroPi / 1e6,
            memo: 'TaskVerse task reward',
            metadata: { submissionId: sub._id.toString(), taskId: sub.task?._id?.toString() }
          });
          createdId = a2u.identifier;
          const payment = await Payment.create({
            piPaymentId: a2u.identifier,
            txid: a2u.txid,
            direction: 'A2U',
            purpose: 'worker_payout',
            user: sub.worker._id,
            task: sub.task?._id,
            amountMicroPi: sub.rewardMicroPi,
            status: 'completed',
          });
          sub.payout = payment._id;
          await sub.save();
          // Decrement in-app balance now that this reward is paid on-chain.
          await User.updateOne(
            { _id: sub.worker._id },
            [{ $set: { balanceMicroPi: { $max: [0, { $subtract: ['$balanceMicroPi', sub.rewardMicroPi] }] } } }]
          );
          results.push({ id: sub._id, worker: sub.worker.username, pi: sub.rewardMicroPi / 1e6, paymentId: a2u.identifier, attempts: attempt });
          done = true;
          // pace the next send to stay under Pi's A2U rate limit
          if (idx < unpaid.length - 1) await sleep(delayMs);
        } catch (e) {
          // 429 = Pi rate limit. Back off exponentially and retry the SAME sub.
          // No funds moved (429 happens at createPayment), so retry is safe.
          if (e.httpStatus === 429 && attempt <= maxRetries) {
            const backoff = delayMs * Math.pow(2, attempt); // 6s, 12s, 24s, 48s...
            results.push({ id: sub._id, worker: sub.worker?.username, info: `rate-limited (429), backing off ${backoff}ms (attempt ${attempt}/${maxRetries})` });
            await sleep(backoff);
            continue; // retry same sub
          }

          // CLEANUP: a failed send may have left a created-but-incomplete payment.
          let cleanup = 'none';
          try {
            const inc = await pi.getIncompleteServerPayments();
            const incItems = Array.isArray(inc) ? inc : (inc?.incomplete_server_payments || []);
            const stuck = incItems.find(p =>
              p.identifier === createdId ||
              p?.metadata?.submissionId === sub._id.toString()
            );
            if (stuck && !(stuck.transaction && stuck.transaction.txid)) {
              const c = await pi.cancelPaymentVerbose(stuck.identifier);
              cleanup = c.ok ? `cancelled ${stuck.identifier}` : `cancel-failed ${stuck.identifier}`;
            }
          } catch (ce) { cleanup = 'cleanup-error: ' + ce.message; }

          // Mark unpayable when the recipient genuinely cannot receive on-chain:
          // createPayment 404, or submitPayment op_no_destination (wallet not on-chain).
          const errStr2 = `${e.message || ''} ${e.piBody ? JSON.stringify(e.piBody) : ''}`;
          const noDest2 = errStr2.includes('op_no_destination');
          let skipped = false;
          if ((e.step === 'createPayment' && e.httpStatus === 404) ||
              (e.step === 'submitPayment' && noDest2)) {
            try {
              sub.payoutSkipped = {
                reason: noDest2 ? 'recipient wallet not activated on-chain (op_no_destination)' : 'recipient unresolvable (Pi 404 at createPayment)',
                httpStatus: e.httpStatus ?? 400, at: new Date(),
              };
              await sub.save();
              skipped = true;
            } catch (se) { /* leave in queue if marking fails */ }
          }

          // If we exhausted 429 retries, stop the whole run — Pi needs a longer
          // cooldown. Remaining subs stay queued for a later batch.
          if (e.httpStatus === 429) hardStop = true;

          results.push({
            id: sub._id, worker: sub.worker?.username, error: e.message,
            step: e.step ?? null, httpStatus: e.httpStatus ?? null, piBody: e.piBody ?? null,
            skipped, cleanup, attempts: attempt,
            ...(hardStop ? { stoppedRun: 'rate-limit cooldown — run again later for remaining' } : {}),
          });
          done = true;
        }
      }

      // one-at-a-time verification happens below (unchanged)

      // ONE-AT-A-TIME: Pi only allows a single A2U in flight. After each send,
      // verify the queue is clear before continuing; stop if anything is stuck.
      try {
        const mid = await pi.getIncompleteServerPayments();
        const midItems = Array.isArray(mid) ? mid : (mid?.incomplete_server_payments || []);
        if (midItems.length > 0) {
          results.push({ stopped: true, reason: 'incomplete payment present after send', incompleteIds: midItems.map(p => p.identifier) });
          break;
        }
      } catch (me) {
        results.push({ stopped: true, reason: 'could not verify queue after send: ' + me.message });
        break;
      }
    }

    const paid = results.filter(r => r.paymentId);
    const distinctWorkers = [...new Set(paid.map(r => r.worker))];
    res.json({
      mode: hasSubmissionId ? 'single' : `batch(limit=${parsedLimit})`,
      receivedSubmissionId: submissionId ?? null,
      attempted: unpaid.length,
      succeeded: paid.length,
      failed: results.filter(r => r.error && !r.skipped).length,
      skippedUnpayable: results.filter(r => r.skipped).length,
      rateLimitedRetries: results.filter(r => r.info && r.info.includes('rate-limited')).length,
      stoppedForCooldown: results.some(r => r.stoppedRun) || results.some(r => r.skippedDueToStop),
      distinctWorkersPaid: distinctWorkers.length,
      workers: distinctWorkers,
      results,
    });
  } catch (err) { next(err); }
});

/* ── Admin: auto-reconcile — one throttled batch, callable by cron or admin ──
   Drains a small batch of unpaid A2U using the shared rate-limit-aware logic.
   Auth: admin JWT OR a CRON_SECRET (?secret= / x-cron-secret) so an external
   scheduler can call it without a user session. Safe to call repeatedly:
   processes a small batch, skips unpayable, backs off on 429, stops on cooldown. */
app.post('/api/admin/auto-reconcile', async (req, res, next) => {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const provided = req.headers['x-cron-secret'] || req.query.secret;
    const cronOk = cronSecret && provided && provided === cronSecret;

    if (!cronOk) {
      // Fall back to admin-session auth.
      try {
        const auth = req.headers.authorization || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
        if (!token) return res.status(401).json({ error: 'auth required (admin token or cron secret)' });
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        if (!isAdmin(payload.username)) return res.status(403).json({ error: 'admin only' });
      } catch (e) {
        return res.status(401).json({ error: 'invalid auth' });
      }
    }

    const limit = Number.isInteger(req.body?.limit) ? req.body.limit : 3;
    const summary = await runAutoBatch({ limit });
    let archive = null;
    try { archive = await archiveOldTasks({ days: Number(process.env.ARCHIVE_AFTER_DAYS) || 30 }); } catch (_) {}
    res.json({ ok: true, ...summary, archive });
  } catch (err) { next(err); }
});

/* ── Admin: consolidated payout — one lump-sum payment per worker ──
   Far fewer A2U calls than per-task payouts, so it clears a backlog with
   minimal rate-limit exposure. {dryRun:true} previews the grouping (pays
   nothing). Otherwise pays up to {maxWorkers} workers, paced + 429-aware. */
app.post('/api/admin/reconcile-consolidated', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    if (req.body?.dryRun) {
      const preview = await previewConsolidation({ includeSkipped: !!req.body?.includeSkipped });
      return res.json({ dryRun: true, includeSkipped: !!req.body?.includeSkipped, ...preview });
    }
    const maxWorkers = Number.isInteger(req.body?.maxWorkers) ? req.body.maxWorkers : 5;
    const summary = await runConsolidatedBatch({ maxWorkers, includeSkipped: !!req.body?.includeSkipped });
    res.json({ ok: true, includeSkipped: !!req.body?.includeSkipped, ...summary });
  } catch (err) { next(err); }
});

/* ── Admin: deep stats for A2U requirement check ── */
app.get('/api/admin/stats', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [
      totalUsers,
      totalSubmissions,
      submissionsByStatus,
      approvedWorkers,
      a2uPayments,
      u2aPayments,
      totalTasks,
    ] = await Promise.all([
      User.countDocuments(),
      Submission.countDocuments(),
      Submission.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      Submission.aggregate([
        { $match: { status: { $in: ['approved', 'auto_approved'] } } },
        { $group: { _id: '$worker', tasksDone: { $sum: 1 }, totalMicroPi: { $sum: '$rewardMicroPi' } } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
        { $unwind: '$u' },
        { $project: { username: '$u.username', piUid: '$u.piUid', tasksDone: 1, earnedPi: { $divide: ['$totalMicroPi', 1e6] } } },
        { $sort: { tasksDone: -1 } }
      ]),
      Payment.countDocuments({ direction: 'A2U' }),
      Payment.aggregate([
        { $match: { direction: 'U2A' } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      Task.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
    ]);

    res.json({
      users: { total: totalUsers },
      submissions: {
        total: totalSubmissions,
        byStatus: Object.fromEntries(submissionsByStatus.map(s => [s._id, s.count])),
      },
      approvedWorkers: {
        count: approvedWorkers.length,
        workers: approvedWorkers,
        distinctPiUids: [...new Set(approvedWorkers.map(w => w.piUid))].length,
      },
      payments: {
        a2uTotal: a2uPayments,
        u2aByStatus: Object.fromEntries(u2aPayments.map(p => [p._id, p.count])),
      },
      tasks: {
        byStatus: Object.fromEntries(totalTasks.map(t => [t._id, t.count])),
      },
    });
  } catch (err) { next(err); }
});

/* ── Error handler ── */
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal server error' });
});

/* ── MongoDB boot ── */
const PORT = process.env.PORT || 8000;
mongoose.connect(process.env.MONGODB_URI).then(() => {

  app.get('/api/leaderboard', requireAuth, async (req, res) => {
    try {
      const { period = 'week' } = req.query;
      const now = new Date();
      let since = new Date(0);
      if (period === 'week') since = new Date(now - 7 * 86400000);
      if (period === 'month') since = new Date(now - 30 * 86400000);
      const results = await Submission.aggregate([
        { $match: { status: { $in: ['auto_approved','approved'] }, updatedAt: { $gte: since } } },
        { $group: { _id: '$worker', tasksCompleted: { $sum: 1 }, totalMicroPi: { $sum: '$rewardMicroPi' } } },
        { $sort: { totalMicroPi: -1 } },
        { $limit: 20 },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: '$user' },
        { $project: { username: '$user.username', approvedCount: '$user.approvedCount', tasksCompleted: 1, totalEarned: { $divide: ['$totalMicroPi', 1000000] } } },
      ]);
      res.json(results);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/me/history', requireAuth, async (req, res) => {
    try {
      const submissions = await Submission.find({ worker: req.session.userId })
        .sort({ createdAt: -1 }).limit(100)
        .populate('task', 'title rewardMicroPi')
        .populate('payout', 'refId status')
        .lean();
      const totalEarned = submissions
        .filter(s => ['auto_approved','approved'].includes(s.status))
        .reduce((sum, s) => sum + (s.rewardMicroPi || 0), 0) / 1e6;
      res.json({ submissions, totalEarned });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.listen(PORT, () => console.log('TaskVerse Pi server listening on :' + PORT));

  // Auto-pay scheduler: drains a small A2U batch periodically while the process
  // is awake. Opt-in via AUTO_PAY=on so it never runs unexpectedly. On free-tier
  // hosting the process sleeps when idle — pair with an external cron hitting
  // POST /api/admin/auto-reconcile (x-cron-secret) for reliable coverage.
  if ((process.env.AUTO_PAY || '').toLowerCase() === 'on') {
    const intervalMs = Number(process.env.AUTO_PAY_INTERVAL_MS) || 90_000;
    const batch = Number(process.env.AUTO_PAY_BATCH) || 2;
    startAutoPayScheduler({ intervalMs, batch });
  }
}).catch((e) => {
  console.error('MongoDB connection failed:', e.message);
  process.exit(1);
});
