import React, { useState, useMemo, useEffect } from 'react';
import { createTask, payForTaskFunding, fetchSettings } from './piClient';

// Display-only defaults — used until the real settings load (or if that
// fetch fails), so the form behaves exactly as it always did in the
// meantime. The server recalculates authoritatively regardless.
const DEFAULT_SETTINGS = { feeRate: 0.05, minRewardPi: 0.01, maxRewardPi: null, minSlots: 1, maxSlots: null };

// Common countries for targeting. Code = ISO alpha-2 (what the server stores).
const COUNTRIES = [
  { code: 'NG', name: 'Nigeria' }, { code: 'GH', name: 'Ghana' },
  { code: 'KE', name: 'Kenya' }, { code: 'ZA', name: 'South Africa' },
  { code: 'CM', name: 'Cameroon' }, { code: 'UG', name: 'Uganda' },
  { code: 'TZ', name: 'Tanzania' }, { code: 'IN', name: 'India' },
  { code: 'PK', name: 'Pakistan' }, { code: 'PH', name: 'Philippines' },
  { code: 'ID', name: 'Indonesia' }, { code: 'VN', name: 'Vietnam' },
  { code: 'BD', name: 'Bangladesh' }, { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' }, { code: 'BR', name: 'Brazil' },
];

const inputStyle = {
width: '100%', padding: '10px 12px', boxSizing: 'border-box', borderRadius: '10px',
border: '1.5px solid var(--border)', fontSize: '0.88rem', color: 'var(--text-secondary)',
backgroundColor: 'var(--surface)', outline: 'none', marginBottom: '10px',
};

/**
* PRODUCTION VERSION — posting a task now:
* 1. Creates the task server-side (status: awaiting_funding)
* 2. Shows the poster a transparent breakdown: reward pool + 5% fee
* 3. Opens the real Pi payment for the gross amount
* 4. Task goes live only after on-chain completion
*/
export default function CreateTask({ onPublished, onBack }) {
const [title, setTitle] = useState('');
const [description, setDescription] = useState('');
  const [link, setLink] = useState('');
const [reward, setReward] = useState('');
const [slots, setSlots] = useState('1');
const [allowedCountries, setAllowedCountries] = useState([]); // [] = global
const [requireScreenshot, setRequireScreenshot] = useState(false);
const [requireManualReview, setRequireManualReview] = useState(false);
const [phase, setPhase] = useState('form'); // form | paying | done
const [error, setError] = useState(null);
const [settings, setSettings] = useState(DEFAULT_SETTINGS);
const [receiptRefId, setReceiptRefId] = useState(null);

useEffect(() => {
  fetchSettings().then((s) => s && setSettings(s)).catch(() => {});
}, []);

const breakdown = useMemo(() => {
const r = parseFloat(reward) || 0;
const s = parseInt(slots, 10) || 0;
const pool = r * s;
const fee = pool * settings.feeRate;
return { pool, fee, total: pool + fee };
}, [reward, slots, settings.feeRate]);

const handleSubmit = async (e) => {
e.preventDefault();
setError(null);
setPhase('paying');
try {
// 1. Server creates the campaign and returns the exact amount due
const { taskId, amountToPay } = await createTask({
title,
description,
  link,
rewardPi: parseFloat(reward),
slots: parseInt(slots, 10),
allowedCountries,
requireScreenshot,
requireManualReview,
});
// 2. Real Pi wallet payment (rewards + platform fee → app wallet)
const completed = await payForTaskFunding({ taskId, amountToPay, title });
setReceiptRefId(completed?.refId || null);
setPhase('done');
onPublished?.(); // parent refetches the feed
} catch (err) {
setError(err.message || 'Funding failed');
setPhase('form');
}
};

return (
<div style={{ padding: '20px', fontFamily: 'sans-serif', backgroundColor: 'var(--surface)', borderRadius: '12px' }}>

{/* Header */}
<div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
<button onClick={onBack} style={{ background: 'var(--surface)', border: '1px solid var(--border-strong)', padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-muted)', fontWeight: '500', boxShadow: '0 1px 3px var(--shadow-color)' }}>← Back</button>
<h3 style={{ margin: 0, fontWeight: '700', fontSize: '1rem', color: 'var(--text)' }}>Post a Micro-Gig</h3>
</div>

{phase === 'done' ? (
<div style={{ textAlign: 'center', padding: '32px 20px' }}>
<div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>🚀</div>
<p style={{ color: '#10b981', fontWeight: '700', fontSize: '1rem', margin: 0 }}>Payment confirmed — your gig is live!</p>
<p style={{ color: 'var(--text-faint)', fontSize: '0.82rem', marginTop: '6px' }}>Workers can find and start it right away.</p>
{receiptRefId && (
<div style={{ marginTop: '16px', display: 'inline-block', backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: '10px', padding: '10px 16px' }}>
<div style={{ fontSize: '0.68rem', color: 'var(--text-faintest)', fontWeight: '700', letterSpacing: '0.03em' }}>PAYMENT REFERENCE</div>
<div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: '800', fontFamily: 'monospace', marginTop: '3px' }}>{receiptRefId}</div>
<div style={{ fontSize: '0.68rem', color: 'var(--text-faintest)', marginTop: '3px' }}>Save this — quote it if you ever need support with this payment.</div>
</div>
)}
</div>
) : (
<div>
<input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
placeholder="Task title (e.g. Follow our Telegram channel)" required maxLength={120}
style={inputStyle} />

<textarea value={description} onChange={(e) => setDescription(e.target.value)}
placeholder="Task description — tell workers exactly what to do and how to prove it…" maxLength={2000} rows={3}
style={{ ...inputStyle, resize: 'vertical', fontFamily: 'sans-serif', lineHeight: 1.45 }} />
  <input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link for workers to visit (optional)" maxLength={500} style={inputStyle} />

<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '0' }}>
<div>
<label style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-faint)', display: 'block', marginBottom: '4px' }}>REWARD PER WORKER</label>
<input type="number" step="0.01" min={settings.minRewardPi} max={settings.maxRewardPi || undefined} value={reward} onChange={(e) => setReward(e.target.value)}
placeholder={`${settings.minRewardPi} π`} required style={inputStyle} />
</div>
<div>
<label style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-faint)', display: 'block', marginBottom: '4px' }}>WORKER SLOTS</label>
<input type="number" min={settings.minSlots} max={settings.maxSlots || 1000} value={slots} onChange={(e) => setSlots(e.target.value)}
placeholder="10" required style={inputStyle} />
</div>
</div>

{/* Country targeting */}
<div style={{ marginBottom: '10px' }}>
<label style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-faint)', display: 'block', marginBottom: '4px' }}>
🌍 COUNTRY TARGETING <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span>
</label>
<select
  value=""
  onChange={(e) => {
    const code = e.target.value;
    if (code && !allowedCountries.includes(code)) setAllowedCountries([...allowedCountries, code]);
  }}
  style={inputStyle}
>
  <option value="">{allowedCountries.length ? '+ Add another country…' : 'Everyone, worldwide (default)'}</option>
  {COUNTRIES.filter(c => !allowedCountries.includes(c.code)).map(c => (
    <option key={c.code} value={c.code}>{c.name}</option>
  ))}
</select>
{allowedCountries.length > 0 && (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '2px' }}>
    {allowedCountries.map(code => {
      const c = COUNTRIES.find(x => x.code === code);
      return (
        <span key={code} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border-strong)', borderRadius: '999px', padding: '3px 10px', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
          {c ? c.name : code}
          <button type="button" onClick={() => setAllowedCountries(allowedCountries.filter(x => x !== code))}
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontWeight: 700, lineHeight: 1, padding: 0 }}>×</button>
        </span>
      );
    })}
  </div>
)}
<p style={{ fontSize: '0.7rem', color: 'var(--text-faintest)', margin: '5px 0 0' }}>
  {allowedCountries.length
    ? 'Only workers in the selected countries can see and complete this task.'
    : 'Leave empty to let any pioneer worldwide complete this task.'}
</p>
</div>

{/* Proof policy — protects against low-effort / irrelevant screenshots */}
<div style={{ marginBottom: '14px', backgroundColor: 'var(--surface-alt)', border: '1.5px solid var(--border)', borderRadius: '12px', padding: '12px 14px' }}>
  <div style={{ fontSize: '0.72rem', fontWeight: '800', color: 'var(--text-muted)', marginBottom: '9px', letterSpacing: '0.03em' }}>PROOF POLICY</div>

  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '9px', cursor: 'pointer', marginBottom: '10px' }}>
    <input type="checkbox" checked={requireScreenshot} onChange={(e) => setRequireScreenshot(e.target.checked)}
      style={{ marginTop: '2px', width: '16px', height: '16px', accentColor: '#059669', flexShrink: 0 }} />
    <span>
      <span style={{ fontSize: '0.82rem', fontWeight: '700', color: 'var(--text-secondary)', display: 'block' }}>Screenshot required</span>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>Submissions without an image are rejected automatically.</span>
    </span>
  </label>

  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '9px', cursor: 'pointer' }}>
    <input type="checkbox" checked={requireManualReview} onChange={(e) => setRequireManualReview(e.target.checked)}
      style={{ marginTop: '2px', width: '16px', height: '16px', accentColor: '#059669', flexShrink: 0 }} />
    <span>
      <span style={{ fontSize: '0.82rem', fontWeight: '700', color: 'var(--text-secondary)', display: 'block' }}>Manual review (no auto-approve)</span>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>
        Every submission waits for an admin to check it. Use this when a worker could pass off a random or unrelated screenshot — only a human can tell.
      </span>
    </span>
  </label>
</div>

{breakdown.total > 0 && (
<div style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: '10px', padding: '12px', fontSize: '0.85rem', marginBottom: '14px' }}>
<div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
<span style={{ color: 'var(--text-muted)' }}>Reward pool ({slots} × {reward}π)</span>
<strong style={{ color: 'var(--text-secondary)' }}>{breakdown.pool.toFixed(4)} π</strong>
</div>
<div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', color: 'var(--text-faint)', fontSize: '0.8rem' }}>
<span>Platform hosting fee ({(settings.feeRate * 100).toFixed(1)}%)</span>
<span>{breakdown.fee.toFixed(4)} π</span>
</div>
<div style={{ height: '1px', backgroundColor: 'var(--border)', margin: '6px 0' }} />
<div style={{ display: 'flex', justifyContent: 'space-between' }}>
<span style={{ fontWeight: '700', color: 'var(--text-secondary)' }}>Total deposit</span>
<strong style={{ color: '#047857', fontSize: '1rem' }}>{breakdown.total.toFixed(4)} π</strong>
</div>
</div>
)}

{error && (
<div style={{ color: '#c53030', backgroundColor: '#fff5f5', padding: '10px 12px', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '12px', border: '1px solid #fed7d7' }}>
⚠️ {error}
</div>
)}

<button onClick={handleSubmit} disabled={phase === 'paying' || !title.trim() || !reward || !slots}
style={{ width: '100%', backgroundColor: (phase === 'paying' || !title.trim() || !reward) ? '#a0aec0' : '#047857', color: 'white', border: 'none', padding: '12px', borderRadius: '10px', fontWeight: '700', cursor: (phase === 'paying') ? 'wait' : 'pointer', fontSize: '0.9rem', transition: 'background 0.2s' }}>
{phase === 'paying' ? '⏳ Waiting for Pi Wallet…' : '🚀 Deposit & Publish (' + breakdown.total.toFixed(4) + ' π)'}
</button>
</div>
)}
</div>
);
}
