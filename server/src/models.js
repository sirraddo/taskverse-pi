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
// Self-declared country (ISO-3166 alpha-2, uppercase, e.g. 'NG'). Used for
// country-targeted tasks. Self-declared in Phase 1 — for stricter enforcement
// (IP / Pi-KYC cross-check) this can be augmented later.
country: { type: String, default: '' },
// Profile picture, stored as a base64 data URL (image/jpeg or image/webp).
// Deliberately kept tiny: the client resizes to <=256x256 and compresses
// before upload, and the server hard-caps the size. Stored inline in Mongo
// so no external image host / API keys are needed on the free tier.
// `select: false` so it is NOT loaded on every user query (keeps list
// endpoints light) — fetch explicitly when the avatar is actually needed.
avatar: { type: String, default: '', select: false },
// Set by an admin when they remove an inappropriate avatar. Blocks the user
// from re-uploading until cleared, so a bad actor can't just re-upload.
avatarBlocked: { type: Boolean, default: false },
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
// Country targeting. Empty array = global (any pioneer, anywhere — the default).
// When non-empty, only workers whose profile country is in this list may see,
// start, or submit the task. Stored as uppercase ISO-3166 alpha-2 codes (e.g. 'NG').
allowedCountries: { type: [String], default: [] },
// ── Proof policy (per task) ──
// requireScreenshot: submission is rejected outright unless an image is attached.
// Use for tasks where a screenshot is the only meaningful proof.
requireScreenshot: { type: Boolean, default: false },
// requireManualReview: submissions on this task NEVER auto-approve — they always
// land in the admin queue for a human decision. This is the real defence against
// irrelevant/random screenshots, because no automated check can tell whether an
// image actually shows the required action; only a human can.
requireManualReview: { type: Boolean, default: false },
// Auto-archived (hidden from dashboards) after a retention period when in a
// terminal state. Data is retained — this only affects default list queries.
archived: { type: Boolean, default: false, index: true },
archivedAt: Date,
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
// Set when an A2U send cannot reach the recipient (e.g. Pi 404 — unresolvable
// uid / non-authenticated or duplicate account). Excludes the sub from the
// unpaid-payout queue so it isn't retried forever. Audit-only; no funds moved.
payoutSkipped: {
reason: String,
httpStatus: Number,
at: Date,
},
// Phase-2 geo audit (PASSIVE — recorded at submit time, never blocks).
// declaredCountry = the worker's profile country at submit time.
// ipCountry = country inferred from their IP via geo-IP lookup.
// countryMismatch = true when both are known and disagree (possible spoof).
// Used to gather evidence on whether self-declared country is being faked,
// before deciding whether to turn on hard IP enforcement.
geoAudit: {
declaredCountry: String,
ipCountry: String,
countryMismatch: Boolean,
ip: String,
at: Date,
},
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
// For consolidated payouts: the submissions this single payment covers.
// A normal single-task payout has one entry; a lump-sum has many. Used as the
// record of truth for idempotency (never re-pay a submission already covered).
submissions: [{ type: Schema.Types.ObjectId, ref: 'Submission', index: true }],
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

/* ── Announcements ───────────────────────────────────────────────
   Admin-posted messages shown to users in the app. Lets the operator
   communicate (payout delays, maintenance, new features) without a code deploy.
   Only ONE announcement is active at a time — `active:true`. Publishing a new
   one deactivates the rest, so there's never a confusing stack of banners. */
const announcementSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 80 },
    body: { type: String, required: true, trim: true, maxlength: 600 },
    // Visual treatment. 'info' = neutral, 'warning' = attention, 'success' = good news.
    level: { type: String, enum: ['info', 'warning', 'success'], default: 'info' },
    active: { type: Boolean, default: true, index: true },
    // Optional call-to-action.
    linkUrl: { type: String, default: '' },
    linkLabel: { type: String, default: '', maxlength: 40 },
    // Users can dismiss it; we remember who so it doesn't nag.
    dismissedBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

/* ── Banners ──────────────────────────────────────────────────────
   Admin-posted promo banners shown in a carousel on the home feed —
   used to cross-promote the operator's own apps (e.g. Zappi NG). Unlike
   Announcements, several can be active at once; `order` controls the
   display sequence. Image is stored inline as base64 (same pattern as
   User.avatar) so there's no external image host / API key to manage. */
const bannerSchema = new Schema(
  {
    // Admin-facing label only — never shown to users.
    title: { type: String, required: true, trim: true, maxlength: 80 },
    // data:image/(jpeg|png|webp);base64,... — validated + size-capped at the route.
    image: { type: String, required: true },
    linkUrl: { type: String, required: true, trim: true },
    linkLabel: { type: String, default: '', trim: true, maxlength: 40 },
    active: { type: Boolean, default: true, index: true },
    // Lower sorts first. Ties break by newest-first.
    order: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export const User = mongoose.model('User', userSchema);
export const Task = mongoose.model('Task', taskSchema);
export const Submission = mongoose.model('Submission', submissionSchema);
export const Dispute = mongoose.model('Dispute', disputeSchema);
export const Payment = mongoose.model('Payment', paymentSchema);
export const PlatformLedger = mongoose.model('PlatformLedger', platformLedgerSchema);
export const Announcement = mongoose.model('Announcement', announcementSchema);
export const Banner = mongoose.model('Banner', bannerSchema);
