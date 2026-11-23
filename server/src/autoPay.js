import { Submission, Payment, User, FeatureFlag, Referral } from './models.js';
import { Task } from './models.js';
import * as pi from './piPlatform.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Finish or release payouts whose outcome was unclear ──────────
 * createA2UPayment parks a payout as 'check' when a payment was created but the
 * send/complete step failed (e.g. a timeout). It might have reached the worker.
 * This looks each one up — on Pi, then on the blockchain by memo — and:
 *   - sent      → completes it on Pi (if needed) and records it as paid (no new send)
 *   - not sent  → cancels it on Pi once it is too old to still land, and frees
 *                 the submissions so the normal payout runs can pay them
 * Never sends Pi. Safe to run any time (scheduler, cron, admin button). */
let appAddress = null;
async function appWalletAddress() {
  if (appAddress || !process.env.PI_WALLET_SEED) return appAddress;
  try { const m = await import('stellar-sdk'); const Keypair = m.Keypair || m.default?.Keypair; appAddress = Keypair.fromSecret(process.env.PI_WALLET_SEED).publicKey(); } catch (_) { /* fall back to Pi's record */ }
  return appAddress;
}

async function findOnChain(fromAddress, paymentId) {
  fromAddress = fromAddress || await appWalletAddress();
  if (!fromAddress) throw new Error('cannot tell the app wallet address to check the blockchain');
  const HORIZON = (process.env.PI_HORIZON_URL || 'https://api.testnet.minepi.com').replace(/\/$/, '');
  const r = await fetch(`${HORIZON}/accounts/${fromAddress}/transactions?order=desc&limit=100`);
  if (!r.ok) return null;
  const data = await r.json();
  const hit = (data?._embedded?.records || []).find((t) => t.memo === paymentId && t.successful !== false);
  return hit ? hit.hash : null;
}

async function recordPaid(keys, paymentId, txid) {
  const subIds = keys.filter((k) => k.startsWith('sub:')).map((k) => k.slice(4));
  const refIds = keys.filter((k) => k.startsWith('ref:')).map((k) => k.slice(4));
  if (subIds.length) {
    const subs = await Submission.find({ _id: { $in: subIds }, payout: { $exists: false } }).lean();
    if (subs.length) {
      const total = subs.reduce((a, s) => a + (s.rewardMicroPi || 0), 0);
      const payment = await Payment.findOneAndUpdate(
        { piPaymentId: paymentId },
        { $setOnInsert: { piPaymentId: paymentId, direction: 'A2U', purpose: 'worker_payout', user: subs[0].worker, task: subs[0].task, submissions: subs.map((s) => s._id), amountMicroPi: total }, $set: { txid, status: 'completed' } },
        { upsert: true, new: true },
      );
      await Submission.updateMany({ _id: { $in: subs.map((s) => s._id) } }, { $set: { payout: payment._id }, $unset: { payoutSkipped: 1 } });
      const perWorker = {};
      for (const s of subs) perWorker[s.worker] = (perWorker[s.worker] || 0) + (s.rewardMicroPi || 0);
      for (const [w, micro] of Object.entries(perWorker)) {
        await User.updateOne({ _id: w }, [{ $set: { balanceMicroPi: { $max: [0, { $subtract: ['$balanceMicroPi', micro] }] } } }]);
      }
    }
  }
  for (const id of refIds) {
    const ref = await Referral.findById(id);
    if (!ref || ref.status === 'paid') continue;
    await Payment.findOneAndUpdate(
      { piPaymentId: paymentId },
      { $setOnInsert: { piPaymentId: paymentId, direction: 'A2U', purpose: 'referral_bonus', user: ref.referrer, amountMicroPi: ref.rewardMicroPi }, $set: { txid, status: 'completed' } },
      { upsert: true, new: true },
    );
    await User.updateOne({ _id: ref.referrer }, [{ $set: { balanceMicroPi: { $max: [0, { $subtract: ['$balanceMicroPi', ref.rewardMicroPi || 0] }] } } }]);
    ref.status = 'paid'; ref.paidAt = new Date(); ref.failureReason = undefined;
    await ref.save();
  }
}

export async function settleStuckPayouts({ minAgeMs = 4 * 60_000 } = {}) {
  const out = { finished: 0, released: 0, waiting: 0, results: [] };
  const claims = await pi.listCheckClaims();
  const byPayment = new Map();
  for (const c of claims) {
    const k = c.paymentId || 'none';
    if (!byPayment.has(k)) byPayment.set(k, []);
    byPayment.get(k).push(c);
  }
  for (const [paymentId, group] of byPayment) {
    const keys = group.map((c) => c._id);
    try {
      if (paymentId === 'none') { await pi.releaseClaims(keys); out.released++; continue; }
      let rec = null;
      try { rec = await pi.getPayment(paymentId); }
      catch (e) { if (e.response?.status !== 404) throw e; }
      let txid = rec?.transaction?.txid || group.find((c) => c.txid)?.txid || null;
      // Look on the blockchain even if Pi shows it cancelled: a cancel does not stop a
      // transaction that was already sent (or still landing).
      if (!txid && rec) txid = await findOnChain(rec.from_address, paymentId);
      if (txid) {
        if (rec && !rec.status?.developer_completed) { try { await pi.completePayment(paymentId, txid); } catch (_) { /* already completed */ } }
        await recordPaid(keys, paymentId, txid);
        await pi.markClaims(keys, { state: 'paid', paidAt: new Date(), txid });
        out.finished++; out.results.push({ paymentId, action: 'recorded as paid', txid, keys });
        continue;
      }
      const since = Math.min(...group.map((c) => new Date(c.checkSince || c.at).getTime()));
      if (rec && Date.now() - since < minAgeMs) { out.waiting++; out.results.push({ paymentId, action: 'waiting (may still land)', keys }); continue; }
      if (rec && !rec.status?.cancelled) await pi.cancelPayment(paymentId);
      await pi.releaseClaims(keys);
      out.released++; out.results.push({ paymentId, action: 'not sent: cancelled and freed for a new payout', keys });
    } catch (e) {
      out.waiting++; out.results.push({ paymentId, action: 'could not check yet', error: e.message, keys });
    }
  }
  return out;
}

// Same rule as the HTTP routes in index.js (duplicated here rather than
// imported, since index.js imports THIS module — importing back would be
// circular). 'maintenance' row with enabled:true means maintenance mode IS
// active (no row = not active); 'payouts' row with enabled:false means
// payouts are paused (no row = allowed). Either one pauses the scheduler.
async function payoutsCurrentlyEnabled() {
  const [maint, payouts] = await Promise.all([
    FeatureFlag.findOne({ key: 'maintenance' }).lean(),
    FeatureFlag.findOne({ key: 'payouts' }).lean(),
  ]);
  if (maint?.enabled === true) return false; // maintenance mode active
  return payouts ? payouts.enabled !== false : true;
}

// Idempotency: has any completed payment already covered this submission?
async function alreadyCovered(subId) {
  const p = await Payment.findOne({ status: 'completed', submissions: subId }).lean();
  return !!p;
}

// Pay ONE worker's pending submissions. If they have multiple pending, this
// sends a single consolidated A2U for the summed amount and links all covered
// submissions to that one Payment. If they have one, it's a normal single send.
// Returns { ok, paymentId, pi, covered, skipped, error, step, httpStatus }.
// Moves funds — caller is responsible for rate-limit pacing / one-at-a-time.
export async function payWorkerConsolidated(workerId, { memo = 'TaskVerse task rewards', includeSkipped = false } = {}) {
  const worker = await User.findById(workerId).lean();
  if (!worker) return { ok: false, error: 'worker not found' };
  if (!worker.piUid) return { ok: false, error: 'no piUid', worker: worker.username };

  // Gather this worker's still-unpaid submissions. By default skip those marked
  // unpayable; includeSkipped retries them (e.g. a wallet that has since activated).
  const subQuery = {
    worker: workerId,
    status: { $in: ['approved', 'auto_approved'] },
    payout: { $exists: false },
  };
  if (!includeSkipped) subQuery['payoutSkipped.at'] = { $exists: false };
  const subs = await Submission.find(subQuery).populate('task');

  if (subs.length === 0) return { ok: true, covered: 0, pi: 0, worker: worker.username, note: 'nothing pending' };

  // Idempotency guard: drop any sub already covered by a completed payment.
  const payable = [];
  for (const s of subs) {
    if (!(await alreadyCovered(s._id))) payable.push(s);
  }
  if (payable.length === 0) return { ok: true, covered: 0, pi: 0, worker: worker.username, note: 'all already covered' };

  const totalMicro = payable.reduce((a, s) => a + (s.rewardMicroPi || 0), 0);
  const totalPi = totalMicro / 1e6;
  const subIds = payable.map((s) => s._id);

  let createdId = null;
  try {
    const a2u = await pi.createA2UPayment({
      uid: worker.piUid,
      amountPi: totalPi,
      memo,
      metadata: { workerId: workerId.toString(), submissionIds: subIds.map(String), consolidated: payable.length > 1 },
    });
    createdId = a2u.identifier;

    const payment = await Payment.create({
      piPaymentId: a2u.identifier,
      txid: a2u.txid,
      direction: 'A2U',
      purpose: 'worker_payout',
      user: worker._id,
      task: payable[0].task?._id, // representative; full set in submissions[]
      submissions: subIds,
      amountMicroPi: totalMicro,
      status: 'completed',
    });

    // Mark every covered submission paid → points at the one payment.
    // Also clear any stale payoutSkipped marker (in case this was a retry).
    await Submission.updateMany({ _id: { $in: subIds } }, { $set: { payout: payment._id }, $unset: { payoutSkipped: 1 } });

    // Decrement the worker's in-app balance by what we just paid out on-chain.
    // The reward was credited to balanceMicroPi at approval; now that the Pi has
    // left the app wallet and reached their Pi wallet, remove it from the in-app
    // balance so the dashboard reflects reality. Floor at 0 as a safety guard.
    await User.updateOne(
      { _id: worker._id },
      [{ $set: { balanceMicroPi: { $max: [0, { $subtract: ['$balanceMicroPi', totalMicro] }] } } }]
    );

    return { ok: true, paymentId: a2u.identifier, pi: totalPi, covered: subIds.length, worker: worker.username, consolidated: payable.length > 1 };
  } catch (e) {
    // Best-effort cleanup of a created-but-incomplete payment (no txid).
    try {
      const inc = await pi.getIncompleteServerPayments();
      const incItems = Array.isArray(inc) ? inc : (inc?.incomplete_server_payments || []);
      const stuck = incItems.find((p) => p.identifier === createdId || p?.metadata?.workerId === workerId.toString());
      if (stuck && !(stuck.transaction && stuck.transaction.txid)) await pi.cancelPaymentVerbose(stuck.identifier);
    } catch (_) { /* best-effort */ }

    // Mark unpayable when the recipient genuinely cannot receive on-chain:
    //  - createPayment 404 → Pi can't resolve the uid
    //  - submitPayment with op_no_destination → recipient wallet not activated
    //    on the blockchain (Stellar rejects the tx; no funds move)
    const errStr = `${e.message || ''} ${e.piBody ? JSON.stringify(e.piBody) : ''}`;
    const noDestination = errStr.includes('op_no_destination');
    let skipped = false;
    let skipReason = null;
    if ((e.step === 'createPayment' && e.httpStatus === 404) ||
        (e.step === 'submitPayment' && noDestination)) {
      skipReason = noDestination
        ? 'recipient wallet not activated on-chain (op_no_destination at submitPayment)'
        : 'recipient unresolvable (Pi 404 at createPayment)';
      try {
        await Submission.updateMany(
          { _id: { $in: subIds } },
          { $set: { payoutSkipped: { reason: skipReason, httpStatus: e.httpStatus ?? 400, at: new Date() } } }
        );
        skipped = true;
      } catch (_) { /* leave queued */ }
    }
    return { ok: false, worker: worker.username, error: e.message, step: e.step ?? null, httpStatus: e.httpStatus ?? null, skipped, skipReason, covered: 0 };
  }
}

// Auto-archive terminal tasks (cancelled / exhausted) older than `days`. This
// only hides them from default dashboard queries — the records and all linked
// payments/submissions are fully retained for audit. Never touches active tasks.
export async function archiveOldTasks({ days = 30 } = {}) {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const r = await Task.updateMany(
    {
      status: { $in: ['cancelled', 'exhausted'] },
      archived: { $ne: true },
      updatedAt: { $lt: cutoff },
    },
    { $set: { archived: true, archivedAt: new Date() } },
  );
  const n = r.modifiedCount ?? r.nModified ?? 0;
  if (n > 0) console.log(`[archive] archived ${n} old terminal task(s) (>${days}d)`);
  return { archived: n };
}

// Shared, rate-limit-aware A2U batch payout. Used by both the auto-pay
// scheduler and the secured /api/admin/auto-reconcile endpoint. Mirrors the
// safety guards of the interactive reconcile-a2u route:
//   - excludes submissions already marked unpayable (payoutSkipped)
//   - refuses to start if Pi already has an incomplete A2U (blocker)
//   - paces sends; backs off exponentially on 429; stops the run on cooldown
//   - skips recipients that 404 at createPayment (before any funds move)
//   - verifies the queue is clear after each send (one-at-a-time)
export async function runAutoBatch({ limit = 3, delayMs = 3000, maxRetries = 4 } = {}) {
  const summary = { attempted: 0, succeeded: 0, skippedUnpayable: 0, failed: 0, rateLimited: 0, stoppedForCooldown: false, results: [] };

  try { summary.settled = await settleStuckPayouts(); } catch (e) { summary.settleError = e.message; }

  // Blocker check — never stack a second incomplete A2U.
  try {
    const pre = await pi.getIncompleteServerPayments();
    const preItems = Array.isArray(pre) ? pre : (pre?.incomplete_server_payments || []);
    if (preItems.length > 0) {
      summary.blocked = true;
      summary.incompleteIds = preItems.map((p) => p.identifier);
      return summary;
    }
  } catch (e) {
    summary.error = 'could not verify incomplete-payments: ' + e.message;
    return summary;
  }

  const unpaid = await Submission.find({
    status: { $in: ['approved', 'auto_approved'] },
    payout: { $exists: false },
    'payoutSkipped.at': { $exists: false },
  }).populate('worker').populate('task').limit(limit);

  summary.attempted = unpaid.length;
  if (unpaid.length === 0) return summary;

  for (let idx = 0; idx < unpaid.length; idx++) {
    if (summary.stoppedForCooldown) { summary.results.push({ id: unpaid[idx]._id, skippedDueToStop: true }); continue; }
    const sub = unpaid[idx];
    if (!sub.worker?.piUid) {
      summary.failed++;
      summary.results.push({ id: sub._id, error: 'no piUid', worker: sub.worker?.username });
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
          metadata: { submissionId: sub._id.toString(), taskId: sub.task?._id?.toString() },
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
        // Decrement in-app balance now that this reward has been paid on-chain.
        await User.updateOne(
          { _id: sub.worker._id },
          [{ $set: { balanceMicroPi: { $max: [0, { $subtract: ['$balanceMicroPi', sub.rewardMicroPi] }] } } }]
        );
        summary.succeeded++;
        summary.results.push({ id: sub._id, worker: sub.worker.username, pi: sub.rewardMicroPi / 1e6, paymentId: a2u.identifier });
        done = true;
        if (idx < unpaid.length - 1) await sleep(delayMs);
      } catch (e) {
        // 429 = Pi rate limit. Back off and retry the same sub (no funds moved).
        if (e.httpStatus === 429 && attempt <= maxRetries) {
          summary.rateLimited++;
          await sleep(delayMs * Math.pow(2, attempt));
          continue;
        }

        // Cleanup a created-but-incomplete payment so it can't block the queue.
        try {
          const inc = await pi.getIncompleteServerPayments();
          const incItems = Array.isArray(inc) ? inc : (inc?.incomplete_server_payments || []);
          const stuck = incItems.find((p) => p.identifier === createdId || p?.metadata?.submissionId === sub._id.toString());
          if (stuck && !(stuck.transaction && stuck.transaction.txid)) {
            await pi.cancelPaymentVerbose(stuck.identifier);
          }
        } catch (_) { /* best-effort cleanup */ }

        // Mark unpayable when the recipient genuinely cannot receive on-chain:
        // createPayment 404, or submitPayment op_no_destination (wallet not activated).
        const _errStr = `${e.message || ''} ${e.piBody ? JSON.stringify(e.piBody) : ''}`;
        const _noDest = _errStr.includes('op_no_destination');
        if ((e.step === 'createPayment' && e.httpStatus === 404) ||
            (e.step === 'submitPayment' && _noDest)) {
          try {
            const _skipReason = _noDest ? 'recipient wallet not activated on-chain (op_no_destination)' : 'recipient unresolvable (Pi 404 at createPayment)';
            sub.payoutSkipped = {
              reason: _skipReason,
              httpStatus: e.httpStatus ?? 400, at: new Date(),
            };
            await sub.save();
            summary.skippedUnpayable++;
            summary.results.push({ id: sub._id, worker: sub.worker?.username, skipped: true, skipReason: _skipReason });
            done = true;
            continue;
          } catch (_) { /* fall through */ }
        }

        // Exhausted 429 retries → stop the whole run for a cooldown.
        if (e.httpStatus === 429) summary.stoppedForCooldown = true;
        summary.failed++;
        summary.results.push({ id: sub._id, worker: sub.worker?.username, error: e.message, step: e.step ?? null, httpStatus: e.httpStatus ?? null });
        done = true;
      }
    }

    // One-at-a-time: verify the queue is clear before continuing.
    try {
      const mid = await pi.getIncompleteServerPayments();
      const midItems = Array.isArray(mid) ? mid : (mid?.incomplete_server_payments || []);
      if (midItems.length > 0) { summary.stoppedForCooldown = true; summary.results.push({ stopped: true, reason: 'incomplete after send' }); break; }
    } catch (_) { break; }
  }

  return summary;
}

// Consolidated drain: groups ALL unpaid submissions by worker and sends ONE
// payment per worker (lump sum) — far fewer A2U calls, so it clears a backlog
// with minimal rate-limit exposure. Paces workers, backs off on 429, stops on
// cooldown, respects one-at-a-time. `maxWorkers` caps how many workers per run.
export async function runConsolidatedBatch({ maxWorkers = 5, delayMs = 3000, maxRetries = 4, includeSkipped = false } = {}) {
  const summary = { workersAttempted: 0, workersPaid: 0, submissionsPaid: 0, piPaid: 0, skipped: 0, failed: 0, rateLimited: 0, stoppedForCooldown: false, results: [] };

  try { summary.settled = await settleStuckPayouts(); } catch (e) { summary.settleError = e.message; }

  // Blocker check first.
  try {
    const pre = await pi.getIncompleteServerPayments();
    const preItems = Array.isArray(pre) ? pre : (pre?.incomplete_server_payments || []);
    if (preItems.length > 0) { summary.blocked = true; summary.incompleteIds = preItems.map((p) => p.identifier); return summary; }
  } catch (e) { summary.error = 'could not verify incomplete-payments: ' + e.message; return summary; }

  // Distinct workers with at least one unpaid submission. includeSkipped also
  // retries those previously marked unpayable (e.g. a now-activated wallet).
  const workerQuery = {
    status: { $in: ['approved', 'auto_approved'] },
    payout: { $exists: false },
  };
  if (!includeSkipped) workerQuery['payoutSkipped.at'] = { $exists: false };
  const workerIds = await Submission.distinct('worker', workerQuery);
  const slice = workerIds.slice(0, maxWorkers);
  summary.workersAttempted = slice.length;

  for (let i = 0; i < slice.length; i++) {
    if (summary.stoppedForCooldown) { summary.results.push({ worker: String(slice[i]), skippedDueToStop: true }); continue; }

    let attempt = 0, done = false;
    while (!done) {
      attempt++;
      const r = await payWorkerConsolidated(slice[i], { includeSkipped });
      if (r.ok && r.paymentId) {
        summary.workersPaid++; summary.submissionsPaid += r.covered; summary.piPaid += r.pi;
        summary.results.push(r); done = true;
        if (i < slice.length - 1) await sleep(delayMs);
      } else if (r.httpStatus === 429 && attempt <= maxRetries) {
        summary.rateLimited++; await sleep(delayMs * Math.pow(2, attempt)); // retry same worker
      } else {
        if (r.skipped) summary.skipped++; else summary.failed++;
        if (r.httpStatus === 429) summary.stoppedForCooldown = true;
        summary.results.push(r); done = true;
      }
    }

    // one-at-a-time verify.
    try {
      const mid = await pi.getIncompleteServerPayments();
      const midItems = Array.isArray(mid) ? mid : (mid?.incomplete_server_payments || []);
      if (midItems.length > 0) { summary.stoppedForCooldown = true; summary.results.push({ stopped: true, reason: 'incomplete after send' }); break; }
    } catch (_) { break; }
  }

  summary.piPaid = Number(summary.piPaid.toFixed(6));
  return summary;
}

// Preview consolidation without paying: groups unpaid subs by worker.
export async function previewConsolidation({ includeSkipped = false } = {}) {
  const subQuery = {
    status: { $in: ['approved', 'auto_approved'] },
    payout: { $exists: false },
  };
  if (!includeSkipped) subQuery['payoutSkipped.at'] = { $exists: false };
  const subs = await Submission.find(subQuery).populate('worker', 'username piUid').lean();

  const byWorker = {};
  for (const s of subs) {
    const id = s.worker?._id?.toString() || 'unknown';
    (byWorker[id] = byWorker[id] || { worker: s.worker?.username, piUid: s.worker?.piUid, count: 0, pi: 0 });
    byWorker[id].count++; byWorker[id].pi += (s.rewardMicroPi || 0) / 1e6;
  }
  const workers = Object.values(byWorker).map((w) => ({ ...w, pi: Number(w.pi.toFixed(6)) }));
  return {
    totalSubmissions: subs.length,
    totalWorkers: workers.length,
    totalPi: Number(workers.reduce((a, b) => a + b.pi, 0).toFixed(6)),
    paymentsNeeded: workers.length, // one per worker vs one per submission
    workers: workers.sort((a, b) => b.count - a.count),
  };
}


let _timer = null;
let _running = false;
let _pausedUntil = 0;

export function startAutoPayScheduler({ intervalMs = 90_000, batch = 2 } = {}) {
  if (_timer) return; // already started
  const tick = async () => {
    if (_running) return;
    if (Date.now() < _pausedUntil) return;
    if (!(await payoutsCurrentlyEnabled())) return; // admin has paused payouts or enabled maintenance mode
    _running = true;
    try {
      const r = await runAutoBatch({ limit: batch });
      if (r.succeeded || r.skippedUnpayable) {
        console.log(`[autoPay] tick: ${r.succeeded} paid, ${r.skippedUnpayable} skipped, ${r.failed} failed`);
      }
      // If rate-limited/cooldown, pause for a longer window before next attempt.
      if (r.stoppedForCooldown || r.blocked) {
        _pausedUntil = Date.now() + 10 * 60_000; // 10 min cooldown
        console.log('[autoPay] cooldown — pausing auto-pay for 10 min');
      }
      // Cheap housekeeping: archive old terminal tasks (retention default 30d).
      try { await archiveOldTasks({ days: Number(process.env.ARCHIVE_AFTER_DAYS) || 30 }); }
      catch (ae) { console.error('[archive] error:', ae.message); }
    } catch (e) {
      console.error('[autoPay] tick error:', e.message);
    } finally {
      _running = false;
    }
  };
  _timer = setInterval(tick, intervalMs);
  console.log(`[autoPay] scheduler started (every ${intervalMs}ms, batch ${batch})`);
}
