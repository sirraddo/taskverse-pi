import React, { useState } from 'react';
import CaptchaVerify from './CaptchaVerify';
import { submitProof } from './piClient';

/**
 * PRODUCTION VERSION — proof goes to POST /api/tasks/:id/submissions.
 * Three server outcomes are handled:
 *   201 status:'pending'        → onSubmitted (manual review queue)
 *   201 status:'auto_approved'  → onSubmitted (payout queued)
 *   422 + reasons[]             → onRejected  (regex quality check failed)
 *
 * NOTE on the file input: proofFileUrl expects a URL from your upload
 * provider (S3/Cloudinary — README §6). Until that's wired, only text
 * proof is transmitted; the picker is shown disabled so users aren't
 * misled into thinking a screenshot was attached.
 */
export default function TaskSubmit({ activeTask, onBack, onSubmitted, onRejected }) {
  const [proofText, setProofText] = useState('');
  const [isHuman, setIsHuman] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!proofText.trim()) return setError('Please describe your proof of work.');
    if (!isHuman) return setError('Please complete the security check.');

    setSending(true);
    try {
      const result = await submitProof(activeTask.id, { proofText });
      onSubmitted(result);
    } catch (err) {
      // 422 auto-reject responses carry a `reasons` array via the error body
      const reasons = err.reasons || [err.message];
      setError(reasons.join(' · '));
      onRejected?.(reasons);
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', backgroundColor: 'white', borderRadius: '12px' }}>
      <button onClick={onBack}>← Back</button>
      <h3>{activeTask.title}</h3>
      <p style={{ color: '#4a5568', fontSize: '0.9rem' }}>Reward: {activeTask.reward} π</p>

      <form onSubmit={handleSubmit}>
        <textarea
          rows="4"
          value={proofText}
          onChange={(e) => setProofText(e.target.value)}
          placeholder="Describe exactly what you did (links, details)…"
          maxLength={4000}
          style={{ width: '100%', padding: '10px', boxSizing: 'border-box' }}
        />
        <input type="file" accept="image/*" disabled title="Screenshot uploads coming soon" />
        <p style={{ fontSize: '0.75rem', color: '#a0aec0', margin: '4px 0 0' }}>Screenshot uploads coming soon — include links in your text for now.</p>

        <CaptchaVerify onVerifySuccess={(val) => setIsHuman(val)} />

        {error && (
          <p style={{ color: '#c53030', backgroundColor: '#fff5f5', padding: '10px', borderRadius: '8px', fontSize: '0.85rem' }}>{error}</p>
        )}

        <button
          type="submit"
          disabled={!isHuman || sending}
          style={{ width: '100%', marginTop: '20px', backgroundColor: '#667eea', color: 'white', padding: '12px', border: 'none', borderRadius: '8px', fontWeight: 'bold', opacity: !isHuman || sending ? 0.6 : 1, cursor: 'pointer' }}
        >
          {sending ? 'Submitting…' : 'Submit Work'}
        </button>
      </form>
    </div>
  );
}
