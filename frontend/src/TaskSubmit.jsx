import React, { useState } from 'react';
import CaptchaVerify from './CaptchaVerify';
import { submitProof, openExternalLink } from './piClient';

/**
* PRODUCTION VERSION — proof goes to POST /api/tasks/:id/submissions.
* Three server outcomes are handled:
*   201 status:'pending'        -> onSubmitted (manual review queue)
*   201 status:'auto_approved'  -> onSubmitted (payout queued)
*   422 + reasons[]             -> onRejected (regex quality check failed)
*
* NOTE on file input: proofFileUrl expects a URL from ImgBB.
* The label wrapper is required for Pi Browser's Android WebView —
* programmatic .click() is blocked there.
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
if (!key) { setProofFileUrl(''); return; }
setUploading(true);
const reader = new FileReader();
reader.onloadend = async () => {
try {
const form = new FormData();
form.append('image', reader.result.split(',')[1]);
const res = await fetch('https://api.imgbb.com/1/upload?key=' + key, { method: 'POST', body: form });
const data = await res.json();
if (data.success) setProofFileUrl(data.data.url);
else throw new Error('Upload failed');
} catch (err) {
setError('Image upload failed — please try again.');
} finally { setUploading(false); }
};
reader.readAsDataURL(file);
};

const handleSubmit = async () => {
setError(null);
if (!proofText.trim()) return setError('Please describe your proof of work.');
if (!isHuman) return setError('Please complete the security check.');
setSending(true);
try {
const result = await submitProof(activeTask.id, {
proofText,
...(proofFileUrl.trim() ? { proofFileUrl: proofFileUrl.trim() } : {}),
});
onSubmitted(result);
} catch (err) {
const reasons = err.reasons || [err.message];
setError(reasons.join(' — '));
onRejected?.(reasons);
} finally {
setSending(false);
}
};

return (
<div style={{ backgroundColor: 'white', borderRadius: '14px', padding: '20px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>

{/* Header */}
<div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
<button onClick={onBack} style={{ background: 'white', border: '1px solid #d1d5db', padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem', color: '#374151', fontWeight: '500', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>← Back</button>
<h3 style={{ margin: 0, fontWeight: '700', fontSize: '0.97rem', color: '#1a202c', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeTask.title}</h3>
</div>

{/* Task reward badge */}
<div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', padding: '10px 12px', backgroundColor: '#f7fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
<span style={{ fontSize: '0.82rem', color: '#4a5568', flex: 1 }}>{activeTask.description || 'Complete the task and submit your proof below.'}</span>
<span style={{ background: 'linear-gradient(135deg,#059669,#047857)', color: 'white', padding: '4px 10px', borderRadius: '8px', fontWeight: '800', fontSize: '0.88rem', flexShrink: 0 }}>{activeTask.reward} π</span>
</div>

{/* Prominent task link — so users can reach it easily while doing the task */}
{activeTask.link && /^https?:\/\//i.test(activeTask.link) && (
<button
onClick={() => openExternalLink(activeTask.link)}
style={{ width: '100%', backgroundColor: '#047857', color: 'white', border: 'none', padding: '12px', borderRadius: '10px', cursor: 'pointer', fontWeight: '800', fontSize: '0.9rem', marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px', boxShadow: '0 3px 10px rgba(4,120,87,0.3)' }}>
🔗 Open Task Link
</button>
)}

{/* Proof text */}
<div style={{ marginBottom: '12px' }}>
<label style={{ fontSize: '0.72rem', fontWeight: '700', color: '#718096', display: 'block', marginBottom: '5px' }}>YOUR PROOF OF WORK</label>
<textarea
rows={4}
value={proofText}
onChange={(e) => setProofText(e.target.value)}
placeholder="Describe exactly what you did (include links, usernames, screenshots)..."
maxLength={4000}
style={{ width: '100%', padding: '10px 12px', boxSizing: 'border-box', borderRadius: '10px', border: '1.5px solid #e2e8f0', fontSize: '0.86rem', color: '#2d3748', resize: 'vertical', fontFamily: 'sans-serif', outline: 'none', lineHeight: 1.5 }}
/>
<div style={{ fontSize: '0.65rem', color: '#a0aec0', textAlign: 'right', marginTop: '3px' }}>{proofText.length}/4000</div>
</div>

{/* Screenshot upload */}
<div style={{ marginBottom: '14px' }}>
<label style={{ fontSize: '0.72rem', fontWeight: '700', color: activeTask.requireScreenshot ? '#c53030' : '#718096', display: 'block', marginBottom: '5px' }}>
{activeTask.requireScreenshot ? 'SCREENSHOT (REQUIRED)' : 'SCREENSHOT (OPTIONAL)'}
</label>
{activeTask.requireScreenshot && (
<div style={{ fontSize: '0.7rem', color: '#c53030', background: '#fff5f5', border: '1px solid #fed7d7', padding: '6px 9px', borderRadius: '8px', marginBottom: '6px' }}>
This task requires a screenshot. Submissions without one are rejected.
</div>
)}
{activeTask.requireManualReview && (
<div style={{ fontSize: '0.7rem', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', padding: '6px 9px', borderRadius: '8px', marginBottom: '6px' }}>
🔍 Reviewed by an admin before payout — make sure your screenshot clearly shows the completed task.
</div>
)}
<label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 12px', backgroundColor: '#f7fafc', borderRadius: '10px', border: '1.5px dashed #cbd5e0', cursor: uploading ? 'wait' : 'pointer', fontSize: '0.82rem', color: '#4a5568' }}>
<span style={{ fontSize: '1.1rem' }}>{uploading ? '⏳' : '📷'}</span>
<span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
{uploading ? 'Uploading…' : (fileName || 'Choose screenshot to upload')}
</span>
<input type="file" accept="image/*" onChange={handleFileChange} disabled={uploading} style={{ display: 'none' }} />
</label>
{/* Screenshots must be uploaded through the app. The manual "paste any image
    URL" box was removed — it let workers pass off any random image from the
    internet as proof. The server now only accepts URLs from our image host. */}
{proofFileUrl.trim() && (
<div style={{ marginTop: '7px' }}>
<img src={proofFileUrl} alt="Your screenshot"
  style={{ maxWidth: '100%', maxHeight: '160px', borderRadius: '8px', border: '1.5px solid #e2e8f0', display: 'block', objectFit: 'contain' }}
  onError={(e) => { e.target.style.display = 'none'; }} />
<div style={{ marginTop: '5px', fontSize: '0.7rem', color: '#059669', fontWeight: '600' }}>✓ Screenshot uploaded</div>
</div>
)}
</div>

<CaptchaVerify onVerifySuccess={(val) => setIsHuman(val)} />

{error && (
<div style={{ color: '#c53030', backgroundColor: '#fff5f5', padding: '10px 12px', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '12px', border: '1px solid #fed7d7' }}>
⚠️ {error}
</div>
)}

<button
onClick={handleSubmit}
disabled={!isHuman || sending}
style={{ width: '100%', marginTop: '6px', backgroundColor: (!isHuman || sending) ? '#a0aec0' : '#059669', color: 'white', border: 'none', padding: '12px', borderRadius: '10px', fontWeight: '700', fontSize: '0.9rem', cursor: (!isHuman || sending) ? 'not-allowed' : 'pointer', transition: 'background 0.2s' }}
>
{sending ? '⏳ Submitting…' : '✓ Submit Work'}
</button>
</div>
);
}
