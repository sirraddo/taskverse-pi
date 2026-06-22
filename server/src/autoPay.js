import { Submission, Payment } from './models.js';
import { Task } from './models.js';
import * as pi from './piPlatform.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

        // 404 at createPayment = unresolvable recipient → mark unpayable, skip.
        if (e.step === 'createPayment' && e.httpStatus === 404) {
          try {
            sub.payoutSkipped = { reason: 'recipient unresolvable (Pi 404 at createPayment)', httpStatus: 404, at: new Date() };
            await sub.save();
            summary.skippedUnpayable++;
            summary.results.push({ id: sub._id, worker: sub.worker?.username, skipped: true });
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

// Lightweight scheduler. Runs a small batch every `intervalMs` while the
// process is awake. On free-tier hosting the process sleeps when idle, so this
// is best-effort; an external cron hitting /api/admin/auto-reconcile gives
// reliable coverage. Guards against overlapping ticks and self-pauses after a
// cooldown stop.
let _timer = null;
let _running = false;
let _pausedUntil = 0;

export function startAutoPayScheduler({ intervalMs = 90_000, batch = 2 } = {}) {
  if (_timer) return; // already started
  const tick = async () => {
    if (_running) return;
    if (Date.now() < _pausedUntil) return;
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
