/**
 * autoReview.js — automated moderation for the submission queue.
 *
 * Pipeline: every submission runs hard validation first (instant reject
 * for gibberish), then policy checks decide auto-approve vs manual queue.
 *
 * Verdicts:
 *   'auto_reject'  — failed text-quality validation
 *   'auto_approve' — small reward + trusted, verified worker
 *   'manual'       — everything else goes to the human admin queue
 */

const MAX_REWARD_MICRO = Math.round(
  Number(process.env.AUTO_APPROVE_MAX_REWARD || 0.25) * 1_000_000
);
const MIN_PRIOR_APPROVALS = Number(process.env.AUTO_APPROVE_MIN_USER_APPROVALS || 3);

/* ── Text-quality rules (Regex pattern validation) ───────────────*/

const RULES = [
  {
    name: 'min_length',
    test: (t) => t.trim().length >= 12,
    reason: 'Proof text shorter than 12 characters',
  },
  {
    name: 'has_letters',
    // Unicode-aware: accepts Latin, Vietnamese diacritics, Spanish, etc.
    test: (t) => /\p{L}{3,}/u.test(t),
    reason: 'No recognizable words found',
  },
  {
    name: 'no_keyboard_mash',
    // 5+ consecutive consonants with no vowels strongly suggests mashing
    test: (t) => !/[bcdfghjklmnpqrstvwxz]{6,}/i.test(t.replace(/\s/g, '')),
    reason: 'Keyboard-mash pattern detected',
  },
  {
    name: 'no_char_flooding',
    // Same character repeated 5+ times ("aaaaa", "!!!!!!")
    test: (t) => !/(.)\1{4,}/.test(t),
    reason: 'Repeated-character flooding detected',
  },
  {
    name: 'no_word_flooding',
    // Same word 4+ times in a row ("done done done done")
    test: (t) => !/\b(\w+)(?:\s+\1\b){3,}/i.test(t),
    reason: 'Repeated-word flooding detected',
  },
  {
    name: 'vowel_ratio',
    // Real language has vowels. Pure consonant soup fails.
    test: (t) => {
      const letters = (t.match(/\p{L}/gu) || []).length;
      if (letters < 12) return true; // handled by min_length
      const vowels = (t.match(/[aeiouáéíóúàèìòùâêîôûăơưyế]/giu) || []).length;
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

/* ── Policy decision ─────────────────────────────────────────────*/

/**
 * @param {object} args
 * @param {string} args.proofText
 * @param {boolean} args.hasProofFile
 * @param {object} args.worker        Mongoose User doc (server-verified)
 * @param {number} args.rewardMicroPi
 */
export function evaluateSubmission({ proofText, hasProofFile, worker, rewardMicroPi }) {
  const reasons = [];

  // 1. Hard validation — instant rejection for gibberish text proof.
  //    (File-only submissions skip text rules but never auto-approve.)
  if (proofText && proofText.trim().length > 0) {
    const { passed, failures } = validateProofText(proofText);
    if (!passed) {
      return { verdict: 'auto_reject', reasons: failures };
    }
    reasons.push('Text validation passed');
  } else if (!hasProofFile) {
    return { verdict: 'auto_reject', reasons: ['Empty submission'] };
  }

  // 2. Auto-approve policy — micro-gigs from trusted, verified workers.
  const rejectionRate =
    worker.approvedCount + worker.rejectedCount === 0
      ? 0
      : worker.rejectedCount / (worker.approvedCount + worker.rejectedCount);

  const eligible =
    rewardMicroPi <= MAX_REWARD_MICRO &&
    worker.isKycVerified === true && // server-verified flag only
    worker.approvedCount >= MIN_PRIOR_APPROVALS &&
    rejectionRate < 0.2 &&
    !worker.isBanned &&
    proofText && proofText.trim().length > 0; // file-only proofs always go to manual review

  if (eligible) {
    reasons.push(
      `Reward ≤ ${MAX_REWARD_MICRO / 1e6}π`,
      'Worker KYC verified (server-side)',
      `Worker has ${worker.approvedCount} prior approvals, rejection rate ${(rejectionRate * 100).toFixed(0)}%`
    );
    return { verdict: 'auto_approve', reasons };
  }

  reasons.push('Did not meet auto-approve policy — routed to manual queue');
  return { verdict: 'manual', reasons };
}
