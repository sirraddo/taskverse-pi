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
        isKycVerified: user.isKycVerified,
        isAdmin: ADMINS.includes(user.username),
      },
    });
  } catch (err) {
    if (err.response?.status === 401) return res.status(401).json({ error: 'Pi token invalid' });
    next(err);
  }
});

/* ── Tasks ── */
app.post('/api/tasks', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const { title, description = '', rewardPi, slots } = req.body;
    const rewardMicro = microPi(rewardPi);
    const slotCount = parseInt(slots, 10);
    if (!title?.trim() || !(rewardMicro >= 10_000) || !(slotCount >= 1)) {
      return res.status(400).json({ error: 'Valid title, reward (>=0.01pi) and slots required' });
    }
    const rewardPool = rewardMicro * slotCount;
    const fee = Math.round(rewardPool * FEE_RATE);
    const gross = rewardPool + fee;
    const task = await Task.create({
      title: title.trim(), description, rewardMicroPi: rewardMicro, slots: slotCount,
      poster: user._id, grossDepositMicroPi: gross, platformFeeMicroPi: fee,
      escrowRemainingMicroPi: rewardPool, status: 'awaiting_funding',
    });
    res.status(201).json({
      taskId: task._id, amountToPay: toPi(gross),
      breakdown: { rewardPool: toPi(rewardPool), platformFee: toPi(fee), feeRate: FEE_RATE },
    });
  } catch (err) { next(err); }
});

app.get('/api/tasks', requireAuth, async (req, res, next) => {
  try {
    const tasks = await Task.find({ status: 'live', poster: { $ne: req.session.userId } })
      .sort({ createdAt: -1 }).limit(100).lean();
    const doneSet = new Set(
      (await Submission.find(
        { worker: req.session.userId, task: { $in: tasks.map(t => t._id) } }, 'task'
      ).lean()).map(s => s.task.toString())
    );
    res.json(tasks.map((t) => ({
      id: t._id, title: t.title, description: t.description,
      reward: toPi(t.rewardMicroPi), slotsLeft: t.slots - t.slotsFilled,
      slotsFilled: t.slotsFilled, slots: t.slots,
      userDone: doneSet.has(t._id.toString()),
    })));
  } catch (err) { next(err); }
});

/* ── Payments ── */
app.post('/api/payments/approve', requireAuth, async (req, res, next) => {
  try {
    const { paymentId } = req.body;
    const user = await currentUser(req);
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

app.post('/api/payments/complete', requireAuth, async (req, res, next) => {
  try {
    const { paymentId, txid } = req.body;
    const user = await currentUser(req);
    const payment = await Payment.findOne({ piPaymentId: paymentId, user: user._id });
    if (!payment) return res.status(404).json({ error: 'Unknown payment' });
    if (payment.status === 'completed') return res.json({ ok: true, idempotent: true });
    await pi.completePayment(paymentId, txid);
    payment.status = 'completed'; payment.txid = txid; await payment.save();
    const task = await Task.findByIdAndUpdate(payment.task,
      { status: 'live', fundingPaymentId: paymentId }, { new: true });
    await PlatformLedger.create({ task: task._id, feeMicroPi: task.platformFeeMicroPi, sourcePaymentId: paymentId });
    if (!user.isKycVerified) { user.isKycVerified = true; await user.save(); }
    res.json({ ok: true, taskStatus: 'live' });
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
app.post('/api/tasks/:id/submissions', requireAuth, async (req, res, next) => {
  try {
    const worker = await currentUser(req);
    const { proofText = '', proofFileUrl = null } = req.body;
    const task = await Task.findOne({ _id: req.params.id, status: 'live' });
    if (!task) return res.status(404).json({ error: 'Task not available' });
    if (task.poster.equals(worker._id)) return res.status(400).json({ error: 'Cannot work your own task' });
    if (task.slotsFilled >= task.slots) return res.status(400).json({ error: 'Task is full' });
    const [isDuplicateImage, isRecycledImage] = proofFileUrl
      ? await Promise.all([
          Submission.exists({ task: task._id, proofFileUrl }),
          Submission.exists({ worker: worker._id, proofFileUrl }),
        ])
      : [false, false];
    const { verdict, reasons } = evaluateSubmission({
      proofText, proofFileUrl,
      isDuplicateImage: Boolean(isDuplicateImage),
      isRecycledImage: Boolean(isRecycledImage),
      worker, rewardMicroPi: task.rewardMicroPi,
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
      piPaymentId: a2u.identifier, direction: 'A2U', purpose: 'worker_payout',
      user: worker._id, task: task._id, amountMicroPi: sub.rewardMicroPi, status: 'created',
    });
    sub.payout = payment._id;
    const record = await pi.getPayment(a2u.identifier);
    if (record?.transaction?.txid) {
      await pi.completeA2UPayment(a2u.identifier, record.transaction.txid);
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
    if (!title?.trim() || !(rewardMicro >= 10_000) || !(slotCount >= 1)) {
      return res.status(400).json({ error: 'Valid title, reward (≥0.01π) and slots required' });
    }
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
    const [history, postedTasks, openDisputes] = await Promise.all([
      Submission.find({ worker: user._id })
        .populate('task', 'title').sort({ createdAt: -1 }).limit(50).lean(),
      Task.find({ poster: user._id }).sort({ createdAt: -1 }).limit(50).lean(),
      Dispute.find({ openedBy: user._id, status: 'open' })
        .populate({ path: 'submission', populate: { path: 'task', select: 'title' } })
        .sort({ createdAt: -1 }).lean(),
    ]);
    res.json({
      username: user.username,
      isAdmin: ADMINS.includes(user.username),
      isKycVerified: user.isKycVerified,
      balance: toPi(user.balanceMicroPi),
      approvedCount: user.approvedCount,
      history: history.map((h) => ({
        title: h.task?.title, reward: toPi(h.rewardMicroPi), status: h.status, date: h.createdAt,
      })),
      postedTasks: postedTasks.map((t) => ({
        id: t._id, title: t.title, slots: t.slots, slotsFilled: t.slotsFilled,
        status: t.status, reward: toPi(t.rewardMicroPi), createdAt: t.createdAt,
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
    const details = [];

    for (const task of staleTasks) {
      // Try to cancel the associated Pi payment if one exists
      const pmt = await Payment.findOne({ task: task._id, direction: 'U2A', status: { $in: ['approved', 'created'] } });
      if (pmt) {
        try {
          await pi.cancelPayment(pmt.piPaymentId);
          await Payment.findByIdAndUpdate(pmt._id, { status: 'cancelled' });
        } catch (piErr) {
          // Pi may have already cancelled it — proceed to mark task anyway
          console.warn('pi.cancelPayment failed (may already be cancelled):', piErr.message);
        }
      }
      await Task.findByIdAndUpdate(task._id, { status: 'cancelled' });
      cancelled++;
      details.push({ taskId: task._id, title: task.title, age: Math.round((Date.now() - new Date(task.createdAt)) / 3600_000) + 'h' });
    }

    res.json({ ok: true, scanned: staleTasks.length, cancelled, details });
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
          await pi.completeA2UPayment(payment.piPaymentId, record.transaction.txid);
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
        .populate('task', 'title rewardMicroPi').lean();
      const totalEarned = submissions
        .filter(s => ['auto_approved','approved'].includes(s.status))
        .reduce((sum, s) => sum + (s.rewardMicroPi || 0), 0) / 1e6;
      res.json({ submissions, totalEarned });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.listen(PORT, () => console.log('TaskVerse Pi server listening on :' + PORT));
}).catch((e) => {
  console.error('MongoDB connection failed:', e.message);
  process.exit(1);
});
