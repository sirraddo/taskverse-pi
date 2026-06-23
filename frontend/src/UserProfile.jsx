import React, { useState } from 'react';
import { submitDisputeStatement, setMyCountry } from './piClient';

// Common countries (ISO alpha-2). Keep in sync with CreateTask.
const PROFILE_COUNTRIES = [
  { code: '', name: 'Not set' },
  { code: 'NG', name: 'Nigeria' }, { code: 'GH', name: 'Ghana' },
  { code: 'KE', name: 'Kenya' }, { code: 'ZA', name: 'South Africa' },
  { code: 'CM', name: 'Cameroon' }, { code: 'UG', name: 'Uganda' },
  { code: 'TZ', name: 'Tanzania' }, { code: 'IN', name: 'India' },
  { code: 'PK', name: 'Pakistan' }, { code: 'PH', name: 'Philippines' },
  { code: 'ID', name: 'Indonesia' }, { code: 'VN', name: 'Vietnam' },
  { code: 'BD', name: 'Bangladesh' }, { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' }, { code: 'BR', name: 'Brazil' },
];

const STATUS_COLORS = {
approved: { bg: '#f0fff4', text: '#276749', label: '✅ Paid' },
auto_approved: { bg: '#f0fff4', text: '#276749', label: '✅ Auto-paid' },
pending: { bg: '#fffbeb', text: '#744210', label: '⏳ Pending' },
disputed: { bg: '#fff5f5', text: '#742a2a', label: '⚠️ Disputed' },
rejected: { bg: '#f7fafc', text: '#718096', label: '✕ Rejected' },
escrow_exhausted: { bg: '#f7fafc', text: '#718096', label: '✕ Escrow gone' },
};

function getRank(count) {
if (count >= 50) return { label: 'Elite Pioneer', icon: '🏆', color: '#d69e2e' };
if (count >= 25) return { label: 'Pro Earner', icon: '💎', color: '#6b46c1' };
if (count >= 10) return { label: 'Active Pioneer', icon: '🚀', color: '#2b6cb0' };
if (count >= 5) return { label: 'Contributor', icon: '⚡', color: '#2d6a4f' };
if (count >= 1) return { label: 'First Tasker', icon: '🌱', color: '#48bb78' };
return { label: 'Newcomer', icon: '👋', color: '#a0aec0' };
}

const ACHIEVEMENTS = [
{ key: 'first', threshold: 1, icon: '🌱', label: 'First Task', color: '#68d391' },
{ key: 'five', threshold: 5, icon: '⚡', label: 'On a Roll', color: '#9f7aea' },
{ key: 'ten', threshold: 10, icon: '🚀', label: 'Pioneer', color: '#63b3ed' },
{ key: 'twentyfive', threshold: 25, icon: '💎', label: 'Pro Earner', color: '#f6ad55' },
{ key: 'fifty', threshold: 50, icon: '🏆', label: 'Elite', color: '#fc8181' },
];

function DisputeCard({ dispute, onStatementSent }) {
const [text, setText] = useState(dispute.workerStatement || '');
const [sending, setSending] = useState(false);
const [sent, setSent] = useState(dispute.hasStatement);
const [err, setErr] = useState(null);

const submit = async () => {
if (!text.trim()) return setErr('Please explain your case.');
setSending(true); setErr(null);
try {
await submitDisputeStatement(dispute.id, text.trim());
setSent(true);
onStatementSent?.();
} catch (e) {
setErr(e.message || 'Failed to submit');
} finally { setSending(false); }
};

return (
<div style={{ backgroundColor: '#fff5f5', border: '1.5px solid #fed7d7', borderRadius: '12px', padding: '14px', marginBottom: '10px' }}>
<div style={{ fontWeight: '700', color: '#742a2a', fontSize: '0.85rem', marginBottom: '4px' }}>
⚠️ Disputed — {dispute.taskTitle}
</div>
{dispute.proofText && (
<div style={{ fontSize: '0.76rem', color: '#718096', backgroundColor: '#f7fafc', padding: '8px 10px', borderRadius: '8px', marginBottom: '8px', lineHeight: 1.4 }}>
Your proof: {dispute.proofText.slice(0, 120)}{dispute.proofText.length > 120 ? '…' : ''}
</div>
)}
{sent ? (
<div style={{ color: '#276749', fontWeight: '600', fontSize: '0.82rem', backgroundColor: '#f0fff4', padding: '8px 10px', borderRadius: '8px' }}>
✓ Appeal submitted — the admin will review your statement.
</div>
) : (
<div>
<label style={{ fontSize: '0.68rem', fontWeight: '700', color: '#718096', display: 'block', marginBottom: '4px', letterSpacing: '0.04em' }}>YOUR APPEAL STATEMENT</label>
<textarea
value={text}
onChange={e => { setText(e.target.value); setErr(null); }}
placeholder="Explain why this should be approved… (links, context, evidence)"
rows={3}
maxLength={2000}
style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '8px', border: '1.5px solid #e2e8f0', fontSize: '0.82rem', resize: 'vertical', fontFamily: 'sans-serif', outline: 'none' }}
/>
{err && <div style={{ color: '#c53030', fontSize: '0.75rem', marginTop: '3px' }}>{err}</div>}
<button onClick={submit} disabled={sending}
style={{ marginTop: '7px', backgroundColor: sending ? '#a0aec0' : '#744210', color: 'white', border: 'none', padding: '7px 14px', borderRadius: '8px', fontWeight: '700', fontSize: '0.8rem', cursor: sending ? 'not-allowed' : 'pointer' }}>
{sending ? 'Sending…' : '⚖️ Submit Appeal'}
</button>
</div>
)}
</div>
);
}

export default function UserProfile({ user, onBack, onRefresh }) {
const count = user.approvedCount ?? 0;
const rank = getRank(count);
const history = user.history || [];
const openDisputes = user.openDisputes || [];

const totalEarned = history
.filter(h => ['approved', 'auto_approved'].includes(h.status))
.reduce((sum, h) => sum + (Number(h.reward) || 0), 0);

const pendingCount = history.filter(h => h.status === 'pending').length;
const next = ACHIEVEMENTS.find(a => count < a.threshold);

const [country, setCountry] = useState(user.country || '');
const [savingCountry, setSavingCountry] = useState(false);
const [countrySaved, setCountrySaved] = useState(false);
const saveCountry = async (code) => {
  setCountry(code); setSavingCountry(true); setCountrySaved(false);
  try { await setMyCountry(code); setCountrySaved(true); onRefresh?.(); }
  catch (e) { /* keep UI responsive; revert on failure */ setCountry(user.country || ''); }
  finally { setSavingCountry(false); }
};

return (
<div style={{ fontFamily: "'Inter', sans-serif", paddingBottom: '32px' }}>

{/* Back button */}
<div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
<button onClick={onBack} style={{ background: 'none', border: '1.5px solid #e2e8f0', padding: '6px 14px', borderRadius: '20px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: '600', color: '#4a5568' }}>← Back</button>
<span style={{ fontWeight: '700', color: '#2d3748', fontSize: '1rem' }}>My Profile</span>
{openDisputes.length > 0 && (
<span style={{ backgroundColor: '#c53030', color: 'white', borderRadius: '20px', padding: '2px 8px', fontSize: '0.65rem', fontWeight: '800', marginLeft: 'auto' }}>
{openDisputes.length} DISPUTE{openDisputes.length > 1 ? 'S' : ''}
</span>
)}
</div>

{/* Hero card */}
<div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', borderRadius: '18px', padding: '24px 20px', marginBottom: '14px', textAlign: 'center', color: 'white', position: 'relative', overflow: 'hidden', boxShadow: '0 6px 24px rgba(102,126,234,0.4)' }}>
<div style={{ position: 'absolute', top: '-30px', left: '-20px', width: '120px', height: '120px', borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
<div style={{ position: 'absolute', bottom: '-20px', right: '-10px', width: '80px', height: '80px', borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
<div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.8rem', margin: '0 auto 10px', position: 'relative' }}>
{rank.icon}
</div>
<h2 style={{ margin: '0 0 4px', fontSize: '1.2rem', fontWeight: '800' }}>{user.username}</h2>
<div style={{ fontSize: '0.8rem', opacity: 0.9, marginBottom: '6px', fontWeight: '600' }}>
<span style={{ background: 'rgba(255,255,255,0.2)', padding: '2px 10px', borderRadius: '10px' }}>{rank.icon} {rank.label}</span>
</div>
{user.isKycVerified && (
<div style={{ fontSize: '0.72rem', opacity: 0.85 }}>
<span style={{ background: 'rgba(255,255,255,0.15)', padding: '2px 8px', borderRadius: '8px' }}>⚡ KYC Verified</span>
</div>
)}
</div>

{/* Stats grid */}
<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '14px' }}>
{[
{ label: 'Tasks Done', value: count, icon: '✅' },
{ label: 'Total Earned', value: totalEarned.toFixed(2) + ' π', icon: '💰' },
{ label: 'Pending', value: pendingCount, icon: '⏳' },
].map(stat => (
<div key={stat.label} style={{ backgroundColor: 'white', borderRadius: '12px', padding: '12px 8px', textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
<div style={{ fontSize: '1.2rem', marginBottom: '2px' }}>{stat.icon}</div>
<div style={{ fontSize: '1rem', fontWeight: '800', color: '#2d3748', lineHeight: 1 }}>{stat.value}</div>
<div style={{ fontSize: '0.62rem', color: '#a0aec0', fontWeight: '600', marginTop: '2px' }}>{stat.label}</div>
</div>
))}
</div>

{/* Country selector — enables country-targeted tasks */}
<div style={{ backgroundColor: 'white', borderRadius: '14px', padding: '14px', marginBottom: '14px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
<h4 style={{ margin: '0 0 4px', fontSize: '0.85rem', fontWeight: '700', color: '#4a5568' }}>🌍 My Country</h4>
<p style={{ margin: '0 0 8px', fontSize: '0.72rem', color: '#a0aec0' }}>Some tasks are only available in specific countries. Set yours so you can see and complete them.</p>
<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
<select value={country} disabled={savingCountry} onChange={(e) => saveCountry(e.target.value)}
style={{ flex: 1, padding: '9px 10px', borderRadius: '10px', border: '1.5px solid #e2e8f0', fontSize: '0.85rem', color: '#2d3748', backgroundColor: 'white' }}>
{PROFILE_COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
</select>
{savingCountry && <span style={{ fontSize: '0.72rem', color: '#a0aec0' }}>Saving…</span>}
{countrySaved && !savingCountry && <span style={{ fontSize: '0.72rem', color: '#38a169', fontWeight: 700 }}>✓ Saved</span>}
</div>
</div>
<div style={{ backgroundColor: 'white', borderRadius: '14px', padding: '14px', marginBottom: '14px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
<h4 style={{ margin: '0 0 10px', fontSize: '0.85rem', fontWeight: '700', color: '#4a5568' }}>🎖️ Achievements</h4>
<div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
{ACHIEVEMENTS.map(a => {
const unlocked = count >= a.threshold;
return (
<div key={a.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', opacity: unlocked ? 1 : 0.35, transition: 'opacity 0.2s' }}>
<div style={{ width: '44px', height: '44px', borderRadius: '50%', background: unlocked ? (a.color + '22') : '#edf2f7', border: unlocked ? ('2px solid ' + a.color) : '2px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem' }}>
{a.icon}
</div>
<span style={{ fontSize: '0.55rem', color: '#718096', fontWeight: '700', textAlign: 'center', maxWidth: '48px' }}>{a.label}</span>
</div>
);
})}
</div>
{next && (
<div style={{ marginTop: '10px', fontSize: '0.72rem', color: '#a0aec0', textAlign: 'center' }}>
{next.threshold - count} more task{(next.threshold - count) !== 1 ? 's' : ''} to unlock <strong>{next.label}</strong> {next.icon}
</div>
)}
</div>

{/* Escrow balance */}
{Number(user.balance ?? 0) > 0 && (
<div style={{ backgroundColor: '#f0fff4', borderRadius: '12px', padding: '12px 14px', marginBottom: '14px', border: '1.5px solid #c6f6d5', display: 'flex', alignItems: 'center', gap: '10px' }}>
<span style={{ fontSize: '1.4rem' }}>💰</span>
<div>
<div style={{ fontWeight: '700', color: '#276749', fontSize: '0.9rem' }}>{Number(user.balance ?? 0).toFixed(4)} π pending on-chain</div>
<div style={{ fontSize: '0.7rem', color: '#48bb78', marginTop: '1px' }}>Approved rewards settling to your Pi wallet</div>
</div>
</div>
)}

{/* Open disputes / appeals */}
{openDisputes.length > 0 && (
<div style={{ marginBottom: '14px' }}>
<h4 style={{ margin: '0 0 10px', fontSize: '0.85rem', fontWeight: '700', color: '#742a2a' }}>
⚖️ Open Appeals ({openDisputes.length})
</h4>
{openDisputes.map(d => (
<DisputeCard key={d.id} dispute={d} onStatementSent={onRefresh} />
))}
</div>
)}

{/* Submission history */}
<div style={{ backgroundColor: 'white', borderRadius: '14px', padding: '14px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
<h4 style={{ margin: '0 0 12px', fontSize: '0.85rem', fontWeight: '700', color: '#4a5568' }}>📋 Recent Submissions</h4>
{history.length === 0 && (
<div style={{ textAlign: 'center', padding: '24px', color: '#a0aec0' }}>
<div style={{ fontSize: '2rem', marginBottom: '8px' }}>🎯</div>
<p style={{ margin: 0, fontSize: '0.82rem', fontWeight: '600' }}>No submissions yet</p>
<p style={{ margin: '4px 0 0', fontSize: '0.72rem' }}>Pick a task from the feed to get started!</p>
</div>
)}
{history.map((item, index) => {
const st = STATUS_COLORS[item.status] || { bg: '#f7fafc', text: '#718096', label: item.status };
return (
<div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: index < history.length - 1 ? '1px solid #f0f4f8' : 'none', gap: '8px' }}>
<div style={{ flex: 1 }}>
<div style={{ fontSize: '0.82rem', fontWeight: '600', color: '#2d3748', lineHeight: 1.3 }}>{item.title || 'Task removed'}</div>
<div style={{ fontSize: '0.7rem', color: '#a0aec0', marginTop: '1px' }}>{item.date ? new Date(item.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</div>
</div>
<div style={{ textAlign: 'right', flexShrink: 0 }}>
<div style={{ fontWeight: '700', color: ['approved','auto_approved'].includes(item.status) ? '#276749' : '#718096', fontSize: '0.82rem' }}>
{['approved','auto_approved'].includes(item.status) ? '+' : ''}{item.reward} π
</div>
<span style={{ backgroundColor: st.bg, color: st.text, padding: '2px 7px', borderRadius: '10px', fontSize: '0.62rem', fontWeight: '700' }}>{st.label}</span>
</div>
</div>
);
})}
</div>
</div>
);
}
