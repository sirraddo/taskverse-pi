import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';

import {
  User, Task, Submission, Dispute, Payment, PlatformLedger, microPi, toPi,
} from './models.js';
import * as pi from './piPlatform.js';
import { evaluateSubmission } from './autoReview.js';

const app = express();
const FEE_RATE = Number(process.env.PLATFORM_FEE_RATE || 0.05);
const ADMINS = (process.env.ADMIN_USERNAMES || '').split(',').map((s) => s.trim());

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

/* ── Session middleware (our own JWT, issued after Pi verification) */
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
  if (!ADMINS.includes(req.session.username)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

async function currentUser(req) {
  const user = await User.findById(req.session.userId);
  if (!user || user.isBanned) throw Object.assign(new Error('Account unavailable'), { status: 403 });
  return user;
}

/* ════════════════════════════════════════════════════════════════
   1. AUTH — verify Pi access token server-side, mint our session
   ════════════════════════════════════════════════════════════════ */
app.post('/api/auth/verify', async (req, res, next) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) return res.status(400).json({ error: 'accessToken required' });

    // Trust boundary: ask Pi who this token belongs to.
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
        isKycVerified: user.isKycVerified,
        isAdmin: ADMINS.includes(user.username),
      },
    });
  } catch (err) {
    if (err.response?.status === 401) return res.status(401).json({ error: 'Pi token invalid' });
    next(err);
  }
});

/* ════════════════════════════════════════════════════════════════
   2. TASKS — create (awaiting funding), list live feed
   ════════════════════════════════════════════════════════════════ */
app.post('/api/tasks', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const { title, description = '', rewardPi, slots } = req.body;

    const rewardMicro = microPi(rewardPi);
    const slotCount = parseInt(slots, 10);
    if (!title?.trim() || !(rewardMicro >= 10_000) || !(slotCount >= 1)) {
      return res.status(400).json({ error: 'Valid title, reward (≥0.01π) and slots required' });
    }

    // Escrow math — the poster pays rewards + 5% platform fee on top.
    const rewardPool = rewardMicro * slotCount;
    const fee = Math.round(rewardPool * FEE_RATE);
    const gross = rewardPool + fee;

    const task = await Task.create({
      title: title.trim(),
      description,
      rewardMicroPi: rewardMicro,
      slots: slotCount,
      poster: user._id,
      grossDepositMicroPi: gross,
      platformFeeMicroPi: fee,
      escrowRemainingMicroPi: rewardPool,
      status: 'awaiting_funding',
    });

    // Client now opens Pi.createPayment for `amountToPay`.
    res.status(201).json({
      taskId: task._id,
      amountToPay: toPi(gross),
      breakdown: { rewardPool: toPi(rewardPool), platformFee: toPi(fee), feeRate: FEE_RATE },
    });
  } catch (err) { next(err); }
});

app.get('/api/tasks', requireAuth, async (req, res, next) => {
  try {
    const tasks = await Task.find({ status: 'live' }).sort({ createdAt: -1 }).limit(100).lean();
    res.json(tasks.map((t) => ({
      id: t._id, title: t.title, description: t.description,
      reward: toPi(t.rewardMicroPi), slotsLeft: t.slots - t.slotsFilled,
    })));
  } catch (err) { next(err); }
});

/* ════════════════════════════════════════════════════════════════
   3. PAYMENTS — U2A lifecycle (task funding) + incomplete recovery
   ════════════════════════════════════════════════════════════════ */

// Called from Pi.createPayment's onReadyForServerApproval callback
app.post('/api/payments/approve', requireAuth, async (req, res, next) => {
  try {
    const { paymentId } = req.body;
    const user = await currentUser(req);

    // Pull canonical record from Pi and validate against our task.
    const record = await pi.getPayment(paymentId);
    const taskId = record?.metadata?.taskId;
    const task = await Task.findOne({ _id: taskId, poster: user._id, status: 'awaiting_funding' });
    if (!task) return res.status(400).json({ error: 'No matching unfunded task for this payment' });

    if (microPi(record.amount) !== task.grossDepositMicroPi) {
      return res.status(400).json({ error: 'Payment amount mismatch' });
    }

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

// Called from onReadyForServerCompletion with the blockchain txid
app.post('/api/payments/complete', requireAuth, async (req, res, next) => {
  try {
    const { paymentId, txid } = req.body;
    const user = await currentUser(req);

    const payment = await Payment.findOne({ piPaymentId: paymentId, user: user._id });
    if (!payment) return res.status(404).json({ error: 'Unknown payment' });
    if (payment.status === 'completed') return res.json({ ok: true, idempotent: true });

    await pi.completePayment(paymentId, txid);

    payment.status = 'completed';
    payment.txid = txid;
    await payment.save();

    // Activate the campaign and book the platform fee.
    const task = await Task.findByIdAndUpdate(payment.task,
      { status: 'live', fundingPaymentId: paymentId }, { new: true });
    await PlatformLedger.create({
      task: task._id, feeMicroPi: task.platformFeeMicroPi, sourcePaymentId: paymentId,
    });

    // Completed mainnet payment ⇒ account is KYC'd (mainnet requires it).
    if (!user.isKycVerified) { user.isKycVerified = true; await user.save(); }

    res.json({ ok: true, taskStatus: 'live' });
  } catch (err) { next(err); }
});

// Called from onIncompletePaymentFound — finish or cancel stuck payments
app.post('/api/payments/incomplete', requireAuth, async (req, res, next) => {
  try {
    const { payment } = req.body; // the PaymentDTO the SDK hands back
    const paymentId = payment?.identifier;
    const txid = payment?.transaction?.txid;
    if (!paymentId) return res.status(400).json({ error: 'payment.identifier required' });

    if (txid) {
      await pi.completePayment(paymentId, txid);
      await Payment.findOneAndUpdate({ piPaymentId: paymentId }, { status: 'completed', txid });
    } else {
      await pi.cancelPayment(paymentId);
      await Payment.findOneAndUpdate({ piPaymentId: paymentId }, { status: 'cancelled' });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ════════════════════════════════════════════════════════════════
   4. SUBMISSIONS — auto-review engine runs on every submission
   ════════════════════════════════════════════════════════════════ */
app.post('/api/tasks/:id/submissions', requireAuth, async (req, res, next) => {
  try {
    const worker = await currentUser(req);
    const { proofText = '', proofFileUrl = null } = req.body;

    const task = await Task.findOne({ _id: req.params.id, status: 'live' });
    if (!task) return res.status(404).json({ error: 'Task not available' });
    if (task.poster.equals(worker._id)) return res.status(400).json({ error: 'Cannot work your own task' });
    if (task.slotsFilled >= task.slots) return res.status(400).json({ error: 'Task is full' });

    // Duplicate-image checks: flag if same URL already used on this task
    // or if this worker has reused the same screenshot from a past task
    const [isDuplicateImage, isRecycledImage] = proofFileUrl
      ? await Promise.all([
          Submission.exists({ task: task._id, proofFileUrl }),
          Submission.exists({ worker: worker._id, proofFileUrl }),
        ])
      : [false, false];

    const { verdict, reasons } = evaluateSubmission({
      proofText,
      proofFileUrl,
      isDuplicateImage: Boolean(isDuplicateImage),
      isRecycledImage:  Boolean(isRecycledImage),
      worker,
      rewardMicroPi: task.rewardMicroPi,
    });

    if (verdict === 'auto_reject') {
      return res.status(422).json({ error: 'Submission rejected by quality check', reasons });
    }

    const submission = await Submission.create({
      task: task._id, worker: worker._id, proofText, proofFileUrl,
      rewardMicroPi: task.rewardMicroPi,
      status: verdict === 'auto_approve' ? 'auto_approved' : 'pending',
      autoReview: { evaluated: true, verdict, reasons },
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

/* ── Shared settlement: credit worker, decrement escrow, A2U payout ──
 * Workers accumulate balance in escrow; payout to chain happens here
 * immediately. If you'd rather batch payouts (saves on-chain fees),
 * move the A2U block into a cron job over positive balances instead.
 */
async function settleApproval(submissionId) {
  const sub = await Submission.findById(submissionId).populate('worker task');
  const { task, worker } = sub;

  if (task.escrowRemainingMicroPi < sub.rewardMicroPi) {
    // Escrow ran out — reject the submission and tell the worker clearly
    sub.status = 'escrow_exhausted';
    sub.autoReview.reasons.push('Task escrow exhausted — no funds remaining');
    await sub.save();
    // Increment rejected count so the worker's stats stay accurate
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

  // On-chain A2U payout from the app wallet
  try {
    const a2u = await pi.createA2UPayment({
      uid: worker.piUid,
      amountPi: toPi(sub.rewardMicroPi),
      memo: `TaskVerse reward: ${task.title}`.slice(0, 100),
      metadata: { submissionId: sub._id.toString() },
    });
    const payment = await Payment.create({
      piPaymentId: a2u.identifier, direction: 'A2U', purpose: 'worker_payout',
      user: worker._id, task: task._id, amountMicroPi: sub.rewardMicroPi, status: 'created',
    });
    sub.payout = payment._id;
    // Pi processes the blockchain tx for A2U; poll/complete with txid.
    const record = await pi.getPayment(a2u.identifier);
    if (record?.transaction?.txid) {
      await pi.completeA2UPayment(a2u.identifier, record.transaction.txid);
      payment.status = 'completed';
      payment.txid = record.transaction.txid;
      await payment.save();
      worker.balanceMicroPi -= sub.rewardMicroPi; // moved on-chain, out of escrow
      await worker.save();
    }
  } catch (e) {
    console.error('A2U payout pending/failed, balance retained in escrow:', e.message);
  }
  await sub.save();
}

/* ════════════════════════════════════════════════════════════════
   5. ADMIN — manual queue, approve/reject, disputes
   ════════════════════════════════════════════════════════════════ */
app.get('/api/admin/queue', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const queue = await Submission.find({ status: 'pending' })
      .populate('worker', 'username isKycVerified approvedCount')
      .populate('task', 'title rewardMicroPi')
      .sort({ createdAt: 1 }).lean();
    res.json(queue);
  } catch (err) { next(err); }
});

app.post('/api/admin/submissions/:id/approve', requireAuth, requireAdmin, async (req, res, next) => {
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
    const { decision, note = '' } = req.body; // 'overturn' | 'uphold'
    const dispute = await Dispute.findOne({ _id: req.params.id, status: 'open' });
    if (!dispute) return res.status(404).json({ error: 'Dispute not open' });

    const sub = await Submission.findById(dispute.submission);
    if (decision === 'overturn') {
      sub.status = 'approved';
      await sub.save();
      await User.findByIdAndUpdate(sub.worker, { $inc: { rejectedCount: -1 } });
      await settleApproval(sub._id);
      dispute.status = 'overturned';
    } else {
      sub.status = 'rejected';
      await sub.save();
      dispute.status = 'upheld';
    }
    dispute.resolvedBy = (await currentUser(req))._id;
    dispute.resolutionNote = note;
    await dispute.save();
    res.json({ ok: true, status: dispute.status });
  } catch (err) { next(err); }
});

/* ── Platform revenue dashboard ─────────────────────────────────*/
app.get('/api/admin/revenue', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [agg] = await PlatformLedger.aggregate([
      { $group: { _id: null, totalFeeMicroPi: { $sum: '$feeMicroPi' }, entries: { $sum: 1 } } },
    ]);
    res.json({ totalFeesPi: toPi(agg?.totalFeeMicroPi || 0), fundedTasks: agg?.entries || 0 });
  } catch (err) { next(err); }
});

/* ── Profile & history ──────────────────────────────────────────*/
app.get('/api/me', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const history = await Submission.find({ worker: user._id })
      .populate('task', 'title').sort({ createdAt: -1 }).limit(50).lean();
    res.json({
      username: user.username,
      isKycVerified: user.isKycVerified,
      balance: toPi(user.balanceMicroPi),
      approvedCount: user.approvedCount,
      history: history.map((h) => ({
        title: h.task?.title, reward: toPi(h.rewardMicroPi), status: h.status, date: h.createdAt,
      })),
    });
  } catch (err) { next(err); }
});

/* ── Error handler & boot ───────────────────────────────────────*/
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal server error' });
/* ════════════════════════════════════════════════════════════════
   6. SEED — one-shot feed populate (protected by SEED_SECRET header)
════════════════════════════════════════════════════════════════ */
app.post('/api/seed', async (req, res, next) => {
  const key = req.headers['x-seed-key'];
  if (!process.env.SEED_SECRET || key !== process.env.SEED_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const existing = await Task.countDocuments({ status: 'live' });
    if (existing > 0) return res.json({ skipped: true, message: `${existing} live tasks already exist.` });
    const SEED_TASKS = [
      { title: 'Follow TaskVerse on Pi Browser', description: 'Open the Pi Browser app store, find TaskVerse Pi and tap Follow/Favorite. Screenshot your followed apps list as proof.', rewardPi: 0.2, slots: 50 },
      { title: 'Share TaskVerse link in a Pi community', description: 'Post https://taskverse-pi.vercel.app in any Pi Network Telegram group, forum, or chat. Screenshot showing your post with the link as proof.', rewardPi: 0.25, slots: 30 },
      { title: 'Write a short review of TaskVerse', description: 'Write at least 3 sentences about your experience using TaskVerse Pi and post it anywhere (Telegram, Twitter/X, forum). Share a screenshot or link as proof.', rewardPi: 0.3, slots: 20 },
      { title: 'Invite a friend to join TaskVerse', description: 'Send the TaskVerse Pi link to a friend and get them to sign up. Screenshot the conversation where you shared the link.', rewardPi: 0.35, slots: 25 },
      { title: 'Translate one TaskVerse UI string to your language', description: 'Find a UI text in the app that is not yet in your language. Post the original English text and your translation in the proof box.', rewardPi: 0.2, slots: 40 },
      { title: 'Report a bug or suggest a feature', description: 'Found something that does not work right, or have an idea to improve the app? Describe it clearly in the proof text. Best reports earn a bonus.', rewardPi: 0.15, slots: 100 },
      { title: 'Like or upvote TaskVerse on PiApps directory', description: 'Find TaskVerse Pi on any Pi app directory or listing site and give it a like/upvote/rating. Screenshot as proof.', rewardPi: 0.1, slots: 100 },
      { title: 'Create a short video showing the TaskVerse app', description: 'Record a 30-60 second screen recording walking through TaskVerse Pi. Upload to YouTube, TikTok, or any platform and paste the link as proof.', rewardPi: 0.5, slots: 10 },
    ];
    const systemId = new mongoose.Types.ObjectId('000000000000000000000000');
    const created = [];
    for (const t of SEED_TASKS) {
      const rewardMicro = microPi(t.rewardPi);
      const rewardPool = rewardMicro * t.slots;
      const fee = Math.round(rewardPool * FEE_RATE);
      const task = await Task.create({
        title: t.title, description: t.description,
        rewardMicroPi: rewardMicro, slots: t.slots, poster: systemId,
        grossDepositMicroPi: rewardPool + fee, platformFeeMicroPi: fee,
        escrowRemainingMicroPi: rewardPool, status: 'live',
      });
      created.push({ id: task._id, title: t.title });
    }
    res.json({ created: created.length, tasks: created });
  } catch (err) { next(err); }
});

});

const PORT = process.env.PORT || 8000;
mongoose.connect(process.env.MONGODB_URI).then(() => {
  // Leaderboard endpoint
app.get('/api/leaderboard', requireAuth, async (req, res) => {
  try {
    const { period = 'week' } = req.query;
    const now = new Date();
    let since = new Date(0);
    if (period === 'week')  since = new Date(now - 7  * 86400000);
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

// Payout history endpoint
app.get('/api/me/history', requireAuth, async (req, res) => {
  try {
    const submissions = await Submission.find({ worker: req.user._id })
      .sort({ createdAt: -1 }).limit(100)
      .populate('task', 'title rewardMicroPi').lean();
    const totalEarned = submissions
      .filter(s => ['auto_approved','approved'].includes(s.status))
      .reduce((sum, s) => sum + (s.rewardMicroPi || 0), 0) / 1e6;
    res.json({ submissions, totalEarned });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`TaskVerse Pi server listening on :${PORT}`));
}).catch((e) => {
  console.error('MongoDB connection failed:', e.message);
  process.exit(1);
});
