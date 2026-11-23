// Owner dashboard (owner-hub on the VPS): today's key numbers.
// GET /api/owner/summary with header x-owner-key = OWNER_KEY. Off (404) unless OWNER_KEY is set (24+ chars).
import crypto from 'node:crypto';
import { User, Task, Submission, PlatformLedger, SupportTicket, TaskReport } from './models.js';
import * as pi from './piPlatform.js';

const LAGOS = 3_600_000;
const startOfLagosToday = () => { const ymd = new Date(Date.now() + LAGOS).toISOString().slice(0, 10); return new Date(new Date(`${ymd}T00:00:00.000Z`).getTime() - LAGOS); };

export function ownerKeyOk(req) {
  const want = process.env.OWNER_KEY || '';
  const got = String(req.headers['x-owner-key'] || '');
  if (want.length < 24 || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export async function buildOwnerSummary() {
  const since = startOfLagosToday();
  const unpaid = { status: { $in: ['approved', 'auto_approved'] }, payout: { $exists: false }, 'payoutSkipped.at': { $exists: false } };
  const [users, newUsers, live, reviewQueue, approvedToday, pending, feesToday, tickets, reports, stuck] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ createdAt: { $gte: since } }),
    Task.countDocuments({ status: 'live' }),
    Submission.countDocuments({ status: 'pending' }),
    Submission.countDocuments({ status: { $in: ['approved', 'auto_approved'] }, updatedAt: { $gte: since } }),
    Submission.aggregate([{ $match: unpaid }, { $group: { _id: null, n: { $sum: 1 }, micro: { $sum: '$rewardMicroPi' } } }]),
    PlatformLedger.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: null, micro: { $sum: '$feeMicroPi' } } }]),
    SupportTicket.countDocuments({ status: 'open' }),
    TaskReport.countDocuments({ status: 'open' }),
    pi.listCheckClaims().then((c) => c.length).catch(() => 0),
  ]);
  const owed = pending[0] || { n: 0, micro: 0 };
  const attention = [
    reviewQueue && `${reviewQueue} submission(s) waiting for review`,
    owed.n && `${owed.n} approved task(s) not yet paid out (π${(owed.micro / 1e6).toFixed(2)})`,
    stuck && `${stuck} payout(s) with an unclear result (Admin → Check stuck payouts)`,
    tickets && `${tickets} open support ticket(s)`,
    reports && `${reports} task report(s) to look at`,
  ].filter(Boolean);
  return {
    app: 'TaskVerse', at: new Date().toISOString(),
    users: { total: users, newToday: newUsers },
    today: { approved: approvedToday, feesPi: Math.round((feesToday[0]?.micro || 0) / 1e4) / 100, liveTasks: live },
    payouts: { pending: owed.n, pendingPi: owed.micro / 1e6, autoPay: (process.env.AUTO_PAY || '').toLowerCase() === 'on' },
    attention,
  };
}
