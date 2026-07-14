/**
 * autoReview.js - automated moderation for the submission queue.
 *
 * NEW POLICY (auto-approve first):
 *  1. Hard validation  -> auto_reject immediately for gibberish / empty,
 *                         or if the task requires a screenshot and none given
 *  2. Suspicious flags -> manual queue (duplicate image, recycled screenshot,
 *                         high rejection rate, banned worker)
 *  2b. Task-level      -> requireManualReview forces the manual queue even when
 *                         nothing is suspicious (no automated check can tell if a
 *                         screenshot is actually RELEVANT — only a human can)
 *  3. Everything else  -> auto_approve
 *
 * This means legitimate first-time workers, high-value tasks, and
 * file-only proofs all auto-approve as long as no red flags fire.
 *
 * Verdicts:
 *   'auto_reject'  - failed text-quality check (instant, no payout)
 *   'manual'       - flagged as suspicious, needs human review
 *   'auto_approve' - passes all checks, payout queued immediately
 */

/* ── Text-quality rules ──────────────────────────────────────── */

const RULES = [
  {
    name: 'min_length',
    test: (t) => t.trim().length >= 12,
    reason: 'Proof text shorter than 12 characters',
  },
  {
    name: 'has_letters',
    test: (t) => /\p{L}{3,}/u.test(t),
    reason: 'No recognizable words found',
  },
  {
    name: 'no_keyboard_mash',
    test: (t) => !/[bcdfghjklmnpqrstvwxz]{6,}/i.test(t.replace(/\s/g, '')),
    reason: 'Keyboard-mash pattern detected',
  },
  {
    name: 'no_char_flooding',
    test: (t) => !/(.)\1{4,}/.test(t),
    reason: 'Repeated-character flooding detected',
  },
  {
    name: 'no_word_flooding',
    test: (t) => !/\b(\w+)(?:\s+\1\b){3,}/i.test(t),
    reason: 'Repeated-word flooding detected',
  },
  {
    name: 'vowel_ratio',
    test: (t) => {
      const letters = (t.match(/\p{L}/gu) || []).length;
      if (letters < 12) return true;
      const vowels = (t.match(/[aeiouaeiouaeiouaeouy]/giu) || []).length;
      return vowels / letters > 0.15;
    },
    reason: 'Vowel ratio inconsistent with natural language',
  },
  {
    name: 'no_url_only_spam',
    test: (t) => !/^\s*(https?:\/\/\S+\s*)+$/i.test(t),
    reason: 'Submission is only bare links with no description',
  },
];

export function validateProofText(proofText = '') {
  const failures = RULES.filter((r) => !r.test(proofText)).map((r) => r.reason);
  return { passed: failures.length === 0, failures };
}

/* ── Policy decision ─────────────────────────────────────────── */

/**
 * @param {object} args
 * @param {string}  args.proofText
 * @param {string|null} args.proofFileUrl
 * @param {boolean} args.isDuplicateImage  - same URL already used on THIS task
 * @param {boolean} args.isRecycledImage   - this worker reused a URL from a past task
 * @param {object}  args.worker            - Mongoose User doc
 * @param {number}  args.rewardMicroPi
 */
export function evaluateSubmission({
  proofText,
  proofFileUrl,
  isDuplicateImage = false,
  isRecycledImage  = false,
  worker,
  rewardMicroPi,
  requireScreenshot = false,
  requireManualReview = false,
  // Admin-tunable via Admin → Settings (Platform Settings). Defaults match
  // the original hardcoded policy exactly, so callers that don't pass these
  // behave identically to before this became configurable.
  rejectionRateThreshold = 0.35,
  minDecisionsForRejectionCheck = 5,
}) {
  const reasons = [];
  const flags   = [];

  /* STEP 1 — Hard text validation (instant reject for gibberish) */
  const hasText = proofText && proofText.trim().length > 0;
  const hasFile = Boolean(proofFileUrl);

  if (!hasText && !hasFile) {
    return { verdict: 'auto_reject', reasons: ['Empty submission — provide text or a screenshot'] };
  }

  /* STEP 1b — Task requires a screenshot: reject outright if none attached. */
  if (requireScreenshot && !hasFile) {
    return {
      verdict: 'auto_reject',
      reasons: ['This task requires a screenshot as proof — none was attached'],
    };
  }

  if (hasText) {
    const { passed, failures } = validateProofText(proofText);
    if (!passed) return { verdict: 'auto_reject', reasons: failures };
    reasons.push('Text validation passed');
  }

  if (hasFile) reasons.push('Screenshot attached');

  /* STEP 2 — Suspicious-signal checks (flag -> manual queue) */

  if (isDuplicateImage) {
    flags.push('DUPLICATE IMAGE: same screenshot already submitted for this task by another worker');
  }

  if (isRecycledImage) {
    flags.push('RECYCLED IMAGE: this screenshot was used in a previous task submission');
  }

  if (worker.isBanned) {
    flags.push('Worker account is currently banned or flagged');
  }

  const total = worker.approvedCount + worker.rejectedCount;
  const rejectionRate = total === 0 ? 0 : worker.rejectedCount / total;
  if (rejectionRate >= rejectionRateThreshold && total >= minDecisionsForRejectionCheck) {
    flags.push('High rejection rate (' + (rejectionRate * 100).toFixed(0) + '%) — ' + total + ' total decisions');
  }

  // Very short text with no screenshot on a new account — low-effort check
  if (hasText && !hasFile && proofText.trim().length < 20 && worker.approvedCount === 0) {
    flags.push('Very short proof text from a new worker with no screenshot — may be low-effort');
  }

  if (flags.length > 0) {
    return { verdict: 'manual', reasons: [...reasons, ...flags, 'Flagged for human review'] };
  }

  /* STEP 2b — Task is set to ALWAYS require a human decision.
     No automated check can verify that a screenshot actually shows the
     required action (a worker could attach any unrelated image), so for
     tasks where proof quality matters the poster can force manual review. */
  if (requireManualReview) {
    return {
      verdict: 'manual',
      reasons: [...reasons, 'Task is set to manual review — admin must approve every submission'],
    };
  }

  /* STEP 3 — Auto-approve everything that passes */
  reasons.push(
    'No suspicious signals detected',
    'Auto-approved — payout queued'
  );
  return { verdict: 'auto_approve', reasons };
}
