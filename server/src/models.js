import mongoose from 'mongoose';

const { Schema } = mongoose;

/* ── User ─────────────────────────────────────────────────────────
* Created/updated only after server-side verification of the Pi
* access token against GET /v2/me. Never trust client-sent fields.
*/
const userSchema = new Schema(
{
piUid: { type: String, required: true, unique: true, index: true },
username: { type: String, required: true, index: true },
// Earned balance held in escrow inside the app wallet, in π.
// Stored as integer micro-pi (1e-6 π) to avoid float drift.
balanceMicroPi: { type: Number, default: 0 },
// Set server-side only. The Platform API does not expose a public KYC
// flag, so derive it from trustworthy signals — e.g. flip to true the
// first time the user COMPLETES a mainnet payment (only KYC'd accounts
// can transact on mainnet). Never accept this from the client.
isKycVerified: { type: Boolean, default: false },
// Reputation counters used by the auto-approve engine
approvedCount: { type: Number, default: 0 },
rejectedCount: { type: Number, default: 0 },
isBanned: { type: Boolean, default: false },
lastLoginAt: Date,
},
{ timestamps: true }
);

/* ── Task (campaign) ──────────────────────────────────────────────
* A task is only visible in the feed once its funding payment has
* completed on-chain (status: 'live').
*/
const taskSchema = new Schema(
{
title: { type: String, required: true, maxlength: 120 },
description: { type: String, maxlength: 2000, default: '' },
  link: { type: String, maxlength: 500, default: '' },
rewardMicroPi: { type: Number, required: true, min: 10_000 }, // ≥ 0.01 π
slots: { type: Number, required: true, min: 1, max: 1000 },
slotsFilled: { type: Number, default: 0 },
poster: { type: Schema.Types.ObjectId, ref: 'User', required: true },
// Escrow accounting (all micro-pi)
grossDepositMicroPi: { type: Number, required: true }, // what poster paid
platformFeeMicroPi: { type: Number, required: true }, // 5% retained
escrowRemainingMicroPi: { type: Number, required: true },
status: {
type: String,
enum: ['awaiting_funding', 'live', 'paused', 'exhausted', 'cancelled'],
default: 'awaiting_funding',
index: true,
},
fundingPaymentId: String, // Pi paymentId that funded this campaign
},
{ timestamps: true }
);

/* ── Submission ──────────────────────────────────────────────────*/
const submissionSchema = new Schema(
{
task: { type: Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
worker: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
proofText: { type: String, maxlength: 4000, default: '' },
proofFileUrl: String, // populated by your file-upload provider (e.g. S3/Cloudinary)
status: {
type: String,
// escrow_exhausted: task ran out of funds before this submission was paid
enum: ['pending', 'auto_approved', 'approved', 'rejected', 'disputed', 'escrow_exhausted'],
default: 'pending',
index: true,
},
autoReview: {
evaluated: { type: Boolean, default: false },
verdict: String, // 'auto_approve' | 'auto_reject' | 'manual'
reasons: [String], // human-readable rule trail for audits
},
rewardMicroPi: { type: Number, required: true },
payout: { type: Schema.Types.ObjectId, ref: 'Payment' },
},
{ timestamps: true }
);
// One submission per worker per task
submissionSchema.index({ task: 1, worker: 1 }, { unique: true });
// Support leaderboard time-range queries efficiently
submissionSchema.index({ status: 1, updatedAt: 1 });

/* ── Dispute ─────────────────────────────────────────────────────*/
const disputeSchema = new Schema(
{
submission: { type: Schema.Types.ObjectId, ref: 'Submission', required: true, unique: true },
openedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
workerStatement: { type: String, maxlength: 2000, default: '' },
status: { type: String, enum: ['open', 'overturned', 'upheld'], default: 'open', index: true },
resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
resolutionNote: String,
},
{ timestamps: true }
);

/* ── Payment ─────────────────────────────────────────────────────
* Mirror of every Pi Platform payment (both directions) for audit.
*/
const paymentSchema = new Schema(
{
piPaymentId: { type: String, required: true, unique: true },
direction: { type: String, enum: ['U2A', 'A2U'], required: true },
purpose: { type: String, enum: ['task_funding', 'worker_payout', 'withdrawal'], required: true },
user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
task: { type: Schema.Types.ObjectId, ref: 'Task' },
amountMicroPi: { type: Number, required: true },
txid: String,
status: {
type: String,
enum: ['created', 'approved', 'completed', 'cancelled', 'failed'],
default: 'created',
index: true,
},
},
{ timestamps: true }
);

/* ── PlatformLedger ──────────────────────────────────────────────
* Append-only record of the 5% fee retained on each funded task.
* Sum of this collection = your platform revenue inside the app wallet.
*/
const platformLedgerSchema = new Schema(
{
task: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
feeMicroPi: { type: Number, required: true },
sourcePaymentId: { type: String, required: true },
},
{ timestamps: true }
);

export const microPi = (pi) => Math.round(Number(pi) * 1_000_000);
export const toPi = (micro) => micro / 1_000_000;

export const User = mongoose.model('User', userSchema);
export const Task = mongoose.model('Task', taskSchema);
export const Submission = mongoose.model('Submission', submissionSchema);
export const Dispute = mongoose.model('Dispute', disputeSchema);
export const Payment = mongoose.model('Payment', paymentSchema);
export const PlatformLedger = mongoose.model('PlatformLedger', platformLedgerSchema);
