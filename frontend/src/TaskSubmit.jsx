import React, { useState, useRef } from 'react';
import CaptchaVerify from './CaptchaVerify';
import { submitProof } from './piClient';

/**
 * PRODUCTION VERSION — proof goes to POST /api/tasks/:id/submissions.
 * Three server outcomes are handled:
 *   201 status:'pending'       -> onSubmitted (manual review queue)
 *   201 status:'auto_approved' -> onSubmitted (payout queued)
 *   422 + reasons[]            -> onRejected  (regex quality check failed)
 *
 * NOTE on the file input: proofFileUrl expects a URL from your upload
 * provider (ImgBB). The label wrapper is required for Pi Browser's
 * Android WebView - programmatic .click() is blocked there.
 */
export default function TaskSubmit({ activeTask, onBack, onSubmitted, onRejected }) {
  const [proofText, setProofText] = useState('');
  const [isHuman, setIsHuman] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [proofFileUrl, setProofFileUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState('');

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    const key = import.meta.env.VITE_IMGBB_API_KEY;
    if (!key) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        const form = new FormData();
        form.append('image', reader.result.split(',')[1]);
        const res = await fetch('https://api.imgbb.com/1/upload?key=' + key, { method: 'POST', body: form });
        const data = await res.json();
        if (data.success) setProofFileUrl(data.data.url);
      } catch (err) {
        setError('Upload failed - paste a URL below instead.');
      } finally { setUploading(false); }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!proofText.trim()) return setError('Please describe your proof of work.');
    if (!isHuman) return setError('Please complete the security check.');

    setSending(true);
    try {
      const result = await submitProof(activeTask.id, { proofText, ...(proofFileUrl.trim() ? { proofFileUrl: proofFileUrl.trim() } : {}) });
      onSubmitted(result);
    } catch (err) {
      const reasons = err.reasons || [err.message];
      setError(reasons.join(' - '));
      onRejected?.(reasons);
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', backgroundColor: 'white', borderRadius: '12px' }}>
      <button onClick={onBack}>Back</button>
      <h3>{activeTask.title}</h3>
      <p style={{ color: '#4a5568', fontSize: '0.9rem' }}>Reward: {activeTask.reward} pi</p>

      <form onSubmit={handleSubmit}>
        <textarea
          rows="4"
          value={proofText}
          onChange={(e) => setProofText(e.target.value)}
          placeholder="Describe exactly what you did (links, details)..."
          maxLength={4000}
          style={{ width: '100%', padding: '10px', boxSizing: 'border-box' }}
        />
        <label style={{ display: 'inline-block', padding: '8px 14px', backgroundColor: '#edf2f7', borderRadius: '6px', cursor: uploading ? 'wait' : 'pointer', fontSize: '0.85rem' }}>
          {uploading ? 'Uploading...' : (fileName || 'Choose screenshot')}
          <input type="file" accept="image/*" onChange={handleFileChange} disabled={uploading} style={{ display: 'none' }} />
        </label>
        <input type="url" value={proofFileUrl} onChange={(e) => setProofFileUrl(e.target.value)} placeholder="or paste image URL (e.g. from Imgur)..." style={{ display: 'block', width: '100%', marginTop: '6px', padding: '8px', fontSize: '0.8rem', boxSizing: 'border-box', borderRadius: '6px', border: '1px solid #cbd5e0' }} />

        <CaptchaVerify onVerifySuccess={(val) => setIsHuman(val)} />

        {error && (
          <p style={{ color: '#c53030', backgroundColor: '#fff5f5', padding: '10px', borderRadius: '8px', fontSize: '0.85rem' }}>{error}</p>
        )}

        <button
          type="submit"
          disabled={!isHuman || sending}
          style={{ width: '100%', marginTop: '20px', backgroundColor: '#667eea', color: 'white', padding: '12px', border: 'none', borderRadius: '8px', fontWeight: 'bold', opacity: !isHuman || sending ? 0.6 : 1, cursor: 'pointer' }}
        >
          {sending ? 'Submitting...' : 'Submit Work'}
        </button>
      </form>
    </div>
  );
      }
