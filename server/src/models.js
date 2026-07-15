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
proofFileUrl: String, // self-hosted base64 data URL (resized/compressed client-side) — see TaskSubmit.jsx
// If auto-review flagged this proof image as a duplicate/recycled match,
// which submission it matched — lets the admin queue show both images
// side by side instead of just a text flag with nothing to compare against.
duplicateOfSubmission: { type: Schema.Types.ObjectId, ref: 'Submission', default: null }, // same image, same task
recycledFromSubmission: { type: Schema.Types.ObjectId, ref: 'Submission', default: null }, // same worker, different task
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
// Short, easy-to-quote support reference (e.g. "TXV-4K7QXPM") — separate from
// piPaymentId (Pi's own long identifier) and txid (the on-chain hash), which
// are both awkward for a user to read out or type into a support chat.
// No DB-level unique constraint on purpose: some Payment writes go through
// findOneAndUpdate() upserts that never run the pre('save') hook below, so
// this field is deliberately backfilled lazily wherever it's missing (see
// backfillRefIds() in index.js) rather than being guaranteed at write time.
// A hard unique index would risk a rare collision throwing on a real payment
// save — the generator below already avoids collisions in practice.
refId: { type: String, index: true, sparse: true },
},
{ timestamps: true }
);

// Unambiguous alphabet — no 0/O/1/I/L — so a refId is safe to read aloud or
// type from a screenshot without misreading a character.
const REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function randomRefCode(len = 7) {
  let s = '';
  for (let i = 0; i < len; i++) s += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
  return s;
}

// Covers Payment.create() / .save() call sites. findOneAndUpdate() upserts
// bypass this — those get their refId lazily on first admin read instead.
paymentSchema.pre('save', async function (next) {
  if (this.refId) return next();
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = `TXV-${randomRefCode(7)}`;
      // eslint-disable-next-line no-await-in-loop
      const exists = await this.constructor.exists({ refId: candidate });
      if (!exists) { this.refId = candidate; break; }
    }
    if (!this.refId) {
      // Practically unreachable (would need 5 collisions in a row out of
      // 33^7 possibilities) — guarantees a value either way.
      this.refId = `TXV-${randomRefCode(4)}${Date.now().toString(36).toUpperCase().slice(-4)}`;
    }
  } catch (e) {
    // Never let a refId hiccup block a real payment from saving.
  }
  next();
});

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

/* ── Feature Flags ────────────────────────────────────────────────
   Admin on/off switches for specific user-facing actions (posting,
   submissions, payouts) — the emergency brake described in the
   product notes. A missing flag means enabled (fail-open), so a flag
   nobody has created yet never silently breaks anything. The special
   key 'maintenance' overrides all the others at once, checked first
   in isFeatureEnabled(). */
const featureFlagSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    enabled: { type: Boolean, default: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

/* ── Platform Settings ────────────────────────────────────────────
   Singleton document (fixed _id) holding the knobs that used to be
   hardcoded/env-only: platform fee rate, reward/slot limits for task
   posting, and the auto-review rejection-rate threshold. Any field left
   unset (null) falls back to the original hardcoded default — see
   getPlatformSettings() in index.js — so this doc is safe to leave
   completely empty. */
const platformSettingsSchema = new Schema(
  {
    _id: { type: String, default: 'global' },
    feeRate: { type: Number, default: null },              // fraction, e.g. 0.05 = 5%
    minRewardMicroPi: { type: Number, default: null },
    maxRewardMicroPi: { type: Number, default: null },      // null = no cap
    minSlots: { type: Number, default: null },
    maxSlots: { type: Number, default: null },               // null = no cap
    autoApproveRejectionRateThreshold: { type: Number, default: null }, // fraction, e.g. 0.35
    autoApproveMinDecisions: { type: Number, default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

/* ── Support tickets ──────────────────────────────────────────────
   In-app contact channel — previously users had no way to reach the
   operator except outside the app. A ticket is a small threaded
   conversation: the user opens it with a message, the admin replies from
   the Support tab, either side can keep replying, and the admin closes it
   when resolved. Status auto-flips: admin reply -> 'answered', a user (or
   admin) reply on a closed ticket -> 'open' again. */
const supportMessageSchema = new Schema(
  {
    from: { type: String, enum: ['user', 'admin'], required: true },
    body: { type: String, required: true, trim: true, maxlength: 3000 },
  },
  { timestamps: true }
);

const supportTicketSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    subject: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, enum: ['payment', 'task', 'account', 'other'], default: 'other' },
    // Optional link to a Payment.refId the user is asking about — lets the
    // admin jump straight to Admin -> Transactions for that reference.
    refId: { type: String, default: '' },
    status: { type: String, enum: ['open', 'answered', 'closed'], default: 'open', index: true },
    messages: [supportMessageSchema],
    // Flips true whenever the admin posts a reply, cleared when the user
    // opens the ticket — powers a simple unread badge for the user.
    hasUnreadForUser: { type: Boolean, default: false },
    // Mirror image for the admin side: true on ticket creation and on every
    // user reply, cleared when the admin opens or replies to the ticket —
    // powers the unread badge in the admin Support tab.
    hasUnreadForAdmin: { type: Boolean, default: true },
  },
  { timestamps: true }
);
supportTicketSchema.index({ updatedAt: -1 });

export const User = mongoose.model('User', userSchema);
export const Task = mongoose.model('Task', taskSchema);
export const Submission = mongoose.model('Submission', submissionSchema);
export const Dispute = mongoose.model('Dispute', disputeSchema);
export const Payment = mongoose.model('Payment', paymentSchema);
export const PlatformLedger = mongoose.model('PlatformLedger', platformLedgerSchema);
export const Announcement = mongoose.model('Announcement', announcementSchema);
export const Banner = mongoose.model('Banner', bannerSchema);
export const FeatureFlag = mongoose.model('FeatureFlag', featureFlagSchema);
export const PlatformSettings = mongoose.model('PlatformSettings', platformSettingsSchema);
/* ── Admin audit log ──────────────────────────────────────────────
   "Who did what" for every admin write action — approvals, bans, flag
   flips, settings edits, etc. Since ADMIN_USERNAMES can list more than
   one admin, there was previously no record of which one did what.
   `admin` is null for the one route that can run unattended (the cron
   auto-reconcile job) — `adminUsername` is denormalized so the log stays
   readable even if that user account is ever deleted. */
const adminAuditLogSchema = new Schema(
  {
    admin: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    adminUsername: { type: String, default: 'system' },
    action: { type: String, required: true, index: true },
    targetType: { type: String, default: '' },
    targetId: { type: String, default: '' },
    details: { type: String, default: '', maxlength: 500 },
  },
  { timestamps: true }
);
adminAuditLogSchema.index({ createdAt: -1 });

export const SupportTicket = mongoose.model('SupportTicket', supportTicketSchema);
/* ── Push subscriptions ───────────────────────────────────────────
   Standard Web Push (Service Worker + PushManager) subscriptions, one per
   device a user has enabled notifications on. A user can have several
   (phone + desktop, etc.) — endpoint is the natural unique key per device. */
const pushSubscriptionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
  },
  { timestamps: true }
);

export const AdminAuditLog = mongoose.model('AdminAuditLog', adminAuditLogSchema);
export const PushSubscription = mongoose.model('PushSubscription', pushSubscriptionSchema);
