import React, { useState, useRef, useEffect } from 'react';
import { submitDisputeStatement, setMyCountry, uploadAvatar, deleteAvatar, resizeImageToDataUrl, isPushSupported, getPushSubscription, enablePushNotifications, disablePushNotifications, fetchMyReferral, submitReferralCode } from './piClient';

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
if (count >= 25) return { label: 'Pro Earner', icon: '💎', color: '#047857' };
if (count >= 10) return { label: 'Active Pioneer', icon: '🚀', color: '#2b6cb0' };
if (count >= 5) return { label: 'Contributor', icon: '⚡', color: '#2d6a4f' };
if (count >= 1) return { label: 'First Tasker', icon: '🌱', color: '#48bb78' };
return { label: 'Newcomer', icon: '👋', color: '#a0aec0' };
}

const ACHIEVEMENTS = [
{ key: 'first', threshold: 1, icon: '🌱', label: 'First Task', color: '#68d391' },
{ key: 'five', threshold: 5, icon: '⚡', label: 'On a Roll', color: '#10b981' },
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
<div style={{ fontSize: '0.76rem', color: 'var(--text-faint)', backgroundColor: 'var(--surface-alt)', padding: '8px 10px', borderRadius: '8px', marginBottom: '8px', lineHeight: 1.4 }}>
Your proof: {dispute.proofText.slice(0, 120)}{dispute.proofText.length > 120 ? '…' : ''}
</div>
)}
{sent ? (
<div style={{ color: '#276749', fontWeight: '600', fontSize: '0.82rem', backgroundColor: '#f0fff4', padding: '8px 10px', borderRadius: '8px' }}>
✓ Appeal submitted — the admin will review your statement.
</div>
) : (
<div>
<label style={{ fontSize: '0.68rem', fontWeight: '700', color: '#9b6b6b', display: 'block', marginBottom: '4px', letterSpacing: '0.04em' }}>YOUR APPEAL STATEMENT</label>
<textarea
value={text}
onChange={e => { setText(e.target.value); setErr(null); }}
placeholder="Explain why this should be approved… (links, context, evidence)"
rows={3}
maxLength={2000}
style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '8px', border: '1.5px solid var(--border)', fontSize: '0.82rem', resize: 'vertical', fontFamily: 'sans-serif', outline: 'none', backgroundColor: 'var(--surface)', color: 'var(--text-secondary)' }}
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

/**
 * Referral code is just the referrer's username — nothing to generate,
 * store, or dedupe. Since the whole app requires Pi Browser to load at
 * all, a "magic link" can't reliably carry a referral through the gap of
 * someone installing Pi Browser first — so this is manual code entry,
 * the version that actually works for everyone rather than just people
 * who already have Pi Browser open when they tap a link.
 */
function ReferralCard({ user }) {
  const [data, setData] = useState(null);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  const load = () => {
    fetchMyReferral().then(setData).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(user.username);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable — nothing to fall back to */ }
  };

  const submit = async () => {
    if (!code.trim()) return;
    setErr(''); setSubmitting(true);
    try {
      await submitReferralCode(code.trim());
      setCode('');
      load();
    } catch (e) {
      setErr(e.message || 'Could not link that referral code.');
    } finally { setSubmitting(false); }
  };

  if (!data) return null;

  return (
    <div style={{ backgroundColor: 'var(--surface)', borderRadius: '14px', padding: '14px', marginBottom: '14px', boxShadow: '0 2px 8px var(--shadow-color)' }}>
      <h4 style={{ margin: '0 0 4px', fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-muted)' }}>🎁 Referrals</h4>
      <p style={{ margin: '0 0 10px', fontSize: '0.72rem', color: 'var(--text-faintest)' }}>
        Share your code. When someone you referred completes their first approved task, you earn a bonus.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <div style={{ flex: 1, padding: '9px 12px', borderRadius: '10px', backgroundColor: 'var(--surface-alt)', fontFamily: 'monospace', fontWeight: '700', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          {user.username}
        </div>
        <button onClick={copyCode} style={{ padding: '9px 14px', borderRadius: '10px', border: 'none', backgroundColor: '#059669', color: 'white', fontWeight: '700', fontSize: '0.78rem', cursor: 'pointer', flexShrink: 0 }}>
          {copied ? '✓ Copied' : '📋 Copy'}
        </button>
      </div>

      {data.stats.totalReferred > 0 && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
          <div style={{ flex: 1, backgroundColor: 'var(--surface-alt)', borderRadius: '10px', padding: '8px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--text-secondary)' }}>{data.stats.totalReferred}</div>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-faintest)', fontWeight: '600' }}>REFERRED</div>
          </div>
          <div style={{ flex: 1, backgroundColor: 'var(--surface-alt)', borderRadius: '10px', padding: '8px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.1rem', fontWeight: '800', color: '#059669' }}>{data.stats.totalPaidPi}π</div>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-faintest)', fontWeight: '600' }}>EARNED</div>
          </div>
        </div>
      )}

      {data.referrals.length > 0 && (
        <div style={{ marginBottom: '10px' }}>
          {data.referrals.slice(0, 5).map((r, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: '0.76rem', borderBottom: i < Math.min(data.referrals.length, 5) - 1 ? '1px solid var(--border)' : 'none' }}>
              <span style={{ color: 'var(--text-secondary)' }}>@{r.username}</span>
              <span style={{ color: r.status === 'paid' ? '#059669' : r.status === 'failed' ? '#c53030' : 'var(--text-faintest)', fontWeight: '600' }}>
                {r.status === 'paid' ? `+${r.rewardPi}π` : r.status === 'failed' ? 'payment issue' : 'awaiting first task'}
              </span>
            </div>
          ))}
        </div>
      )}

      {data.referredBy ? (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-faintest)' }}>
          You were referred by @{data.referredBy.username}
          {data.referredBy.status === 'pending' && ' — complete your first task to activate their bonus.'}
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input value={code} onChange={(e) => setCode(e.target.value)}
              placeholder="Have a referral code?" maxLength={40}
              style={{ flex: 1, padding: '9px 12px', borderRadius: '10px', border: '1.5px solid var(--border)', fontSize: '0.82rem', color: 'var(--text-secondary)', backgroundColor: 'var(--surface)', outline: 'none' }} />
            <button onClick={submit} disabled={submitting || !code.trim()}
              style={{ padding: '9px 16px', borderRadius: '10px', border: 'none', backgroundColor: (submitting || !code.trim()) ? '#a0aec0' : '#047857', color: 'white', fontWeight: '700', fontSize: '0.78rem', cursor: (submitting || !code.trim()) ? 'not-allowed' : 'pointer', flexShrink: 0 }}>
              {submitting ? '…' : 'Link'}
            </button>
          </div>
          {err && <p style={{ margin: '6px 0 0', fontSize: '0.7rem', color: '#c53030' }}>{err}</p>}
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

/* ── Push notifications ──
   Purely best-effort: if the browser/WebView doesn't support the Push API,
   the toggle just doesn't render rather than showing something that can't
   work. Actual delivery depends on the device — this only controls whether
   a subscription is registered. */
const [pushSupported, setPushSupported] = useState(false);
const [pushEnabled, setPushEnabled] = useState(false);
const [pushBusy, setPushBusy] = useState(false);
const [pushErr, setPushErr] = useState('');

useEffect(() => {
  if (!isPushSupported()) return;
  setPushSupported(true);
  getPushSubscription().then((sub) => setPushEnabled(Boolean(sub)));
}, []);

const togglePush = async () => {
  setPushBusy(true); setPushErr('');
  try {
    if (pushEnabled) { await disablePushNotifications(); setPushEnabled(false); }
    else { await enablePushNotifications(); setPushEnabled(true); }
  } catch (e) {
    setPushErr(e.message || 'Could not update notification settings.');
  } finally { setPushBusy(false); }
};

/* ── Avatar upload ──
   The image is resized + compressed in the browser before it is sent, so we
   never ship a multi-megabyte camera photo to the server. */
const fileRef = useRef(null);
const [avatar, setAvatar] = useState(user.avatar || '');
const [avatarBusy, setAvatarBusy] = useState(false);
const [avatarErr, setAvatarErr] = useState('');

const handleAvatarPick = async (e) => {
  const file = e.target.files?.[0];
  e.target.value = ''; // allow re-picking the same file
  if (!file) return;
  setAvatarErr(''); setAvatarBusy(true);
  try {
    // Guard before we even decode: reject absurdly large files early.
    if (file.size > 12 * 1024 * 1024) throw new Error('That image is too large (max 12MB).');
    const dataUrl = await resizeImageToDataUrl(file, 256, 0.82);
    await uploadAvatar(dataUrl);
    setAvatar(dataUrl);
    onRefresh?.();
  } catch (err) {
    setAvatarErr(err.message || 'Upload failed');
  } finally { setAvatarBusy(false); }
};

const handleAvatarRemove = async () => {
  setAvatarErr(''); setAvatarBusy(true);
  try { await deleteAvatar(); setAvatar(''); onRefresh?.(); }
  catch (err) { setAvatarErr(err.message || 'Could not remove'); }
  finally { setAvatarBusy(false); }
};

return (
<div style={{ fontFamily: "'Inter', sans-serif", paddingBottom: '32px' }}>

{/* Back button */}
<div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
<button onClick={onBack} style={{ background: 'none', border: '1.5px solid var(--border)', padding: '6px 14px', borderRadius: '20px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-muted)' }}>← Back</button>
<span style={{ fontWeight: '700', color: 'var(--text-secondary)', fontSize: '1rem' }}>My Profile</span>
{openDisputes.length > 0 && (
<span style={{ backgroundColor: '#c53030', color: 'white', borderRadius: '20px', padding: '2px 8px', fontSize: '0.65rem', fontWeight: '800', marginLeft: 'auto' }}>
{openDisputes.length} DISPUTE{openDisputes.length > 1 ? 'S' : ''}
</span>
)}
</div>

{/* Hero card */}
<div style={{ background: 'linear-gradient(135deg, #059669 0%, #047857 100%)', borderRadius: '18px', padding: '24px 20px', marginBottom: '14px', textAlign: 'center', color: 'white', position: 'relative', overflow: 'hidden', boxShadow: '0 6px 24px rgba(5,150,105,0.4)' }}>
<div style={{ position: 'absolute', top: '-30px', left: '-20px', width: '120px', height: '120px', borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
<div style={{ position: 'absolute', bottom: '-20px', right: '-10px', width: '80px', height: '80px', borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
{/* Avatar — tap to upload/change. Falls back to the rank icon. */}
<div style={{ position: 'relative', width: '64px', margin: '0 auto 10px' }}>
<div
  onClick={() => !avatarBusy && !user.avatarBlocked && fileRef.current?.click()}
  title={user.avatarBlocked ? 'Avatar uploads disabled on your account' : 'Tap to change picture'}
  style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.8rem', position: 'relative', overflow: 'hidden', cursor: (avatarBusy || user.avatarBlocked) ? 'default' : 'pointer', border: avatar ? '2px solid rgba(255,255,255,0.55)' : 'none' }}>
  {avatar
    ? <img src={avatar} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    : rank.icon}
  {avatarBusy && (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700 }}>…</div>
  )}
</div>
{!user.avatarBlocked && (
  <div
    onClick={() => !avatarBusy && fileRef.current?.click()}
    style={{ position: 'absolute', bottom: 0, right: 0, width: '22px', height: '22px', borderRadius: '50%', background: 'white', color: '#047857', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.68rem', fontWeight: 800, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.25)' }}>
    ✎
  </div>
)}
<input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={handleAvatarPick} />
</div>
{avatarErr && (
  <div style={{ fontSize: '0.7rem', background: 'rgba(0,0,0,0.25)', padding: '4px 8px', borderRadius: '8px', marginBottom: '8px', display: 'inline-block' }}>{avatarErr}</div>
)}
{avatar && !avatarBusy && (
  <div onClick={handleAvatarRemove} style={{ fontSize: '0.68rem', opacity: 0.85, textDecoration: 'underline', cursor: 'pointer', marginBottom: '6px' }}>Remove picture</div>
)}
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
<div key={stat.label} style={{ backgroundColor: 'var(--surface)', borderRadius: '12px', padding: '12px 8px', textAlign: 'center', boxShadow: '0 2px 8px var(--shadow-color)' }}>
<div style={{ fontSize: '1.2rem', marginBottom: '2px' }}>{stat.icon}</div>
<div style={{ fontSize: '1rem', fontWeight: '800', color: 'var(--text-secondary)', lineHeight: 1 }}>{stat.value}</div>
<div style={{ fontSize: '0.62rem', color: 'var(--text-faintest)', fontWeight: '600', marginTop: '2px' }}>{stat.label}</div>
</div>
))}
</div>

{/* Country selector — enables country-targeted tasks */}
<div style={{ backgroundColor: 'var(--surface)', borderRadius: '14px', padding: '14px', marginBottom: '14px', boxShadow: '0 2px 8px var(--shadow-color)' }}>
<h4 style={{ margin: '0 0 4px', fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-muted)' }}>🌍 My Country</h4>
<p style={{ margin: '0 0 8px', fontSize: '0.72rem', color: 'var(--text-faintest)' }}>Some tasks are only available in specific countries. Set yours so you can see and complete them.</p>
<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
<select value={country} disabled={savingCountry} onChange={(e) => saveCountry(e.target.value)}
style={{ flex: 1, padding: '9px 10px', borderRadius: '10px', border: '1.5px solid var(--border)', fontSize: '0.85rem', color: 'var(--text-secondary)', backgroundColor: 'var(--surface)' }}>
{PROFILE_COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
</select>
{savingCountry && <span style={{ fontSize: '0.72rem', color: 'var(--text-faintest)' }}>Saving…</span>}
{countrySaved && !savingCountry && <span style={{ fontSize: '0.72rem', color: '#38a169', fontWeight: 700 }}>✓ Saved</span>}
</div>
</div>

{pushSupported && (
<div style={{ backgroundColor: 'var(--surface)', borderRadius: '14px', padding: '14px', marginBottom: '14px', boxShadow: '0 2px 8px var(--shadow-color)' }}>
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
<div style={{ flex: 1, minWidth: 0, marginRight: '10px' }}>
<h4 style={{ margin: '0 0 4px', fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-muted)' }}>🔔 Notifications</h4>
<p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-faintest)' }}>Get notified when a submission is approved or a support reply comes in.</p>
</div>
<button onClick={togglePush} disabled={pushBusy}
  style={{
    flexShrink: 0, padding: '8px 14px', borderRadius: '20px', border: 'none', fontWeight: '700', fontSize: '0.78rem',
    cursor: pushBusy ? 'not-allowed' : 'pointer',
    backgroundColor: pushBusy ? 'var(--border-strong)' : pushEnabled ? '#059669' : 'var(--surface-alt)',
    color: pushEnabled ? 'white' : 'var(--text-muted)',
  }}>
  {pushBusy ? '…' : pushEnabled ? 'On' : 'Off'}
</button>
</div>
{pushErr && <p style={{ margin: '8px 0 0', fontSize: '0.7rem', color: '#c53030' }}>{pushErr}</p>}
</div>
)}

<ReferralCard user={user} />

<div style={{ backgroundColor: 'var(--surface)', borderRadius: '14px', padding: '14px', marginBottom: '14px', boxShadow: '0 2px 8px var(--shadow-color)' }}>
<h4 style={{ margin: '0 0 10px', fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-muted)' }}>🎖️ Achievements</h4>
<div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
{ACHIEVEMENTS.map(a => {
const unlocked = count >= a.threshold;
return (
<div key={a.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', opacity: unlocked ? 1 : 0.35, transition: 'opacity 0.2s' }}>
<div style={{ width: '44px', height: '44px', borderRadius: '50%', background: unlocked ? (a.color + '22') : 'var(--surface-alt)', border: unlocked ? ('2px solid ' + a.color) : '2px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem' }}>
{a.icon}
</div>
<span style={{ fontSize: '0.55rem', color: 'var(--text-faint)', fontWeight: '700', textAlign: 'center', maxWidth: '48px' }}>{a.label}</span>
</div>
);
})}
</div>
{next && (
<div style={{ marginTop: '10px', fontSize: '0.72rem', color: 'var(--text-faintest)', textAlign: 'center' }}>
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
<div style={{ backgroundColor: 'var(--surface)', borderRadius: '14px', padding: '14px', boxShadow: '0 2px 8px var(--shadow-color)' }}>
<h4 style={{ margin: '0 0 12px', fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-muted)' }}>📋 Recent Submissions</h4>
{history.length === 0 && (
<div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-faintest)' }}>
<div style={{ fontSize: '2rem', marginBottom: '8px' }}>🎯</div>
<p style={{ margin: 0, fontSize: '0.82rem', fontWeight: '600' }}>No submissions yet</p>
<p style={{ margin: '4px 0 0', fontSize: '0.72rem' }}>Pick a task from the feed to get started!</p>
</div>
)}
{history.map((item, index) => {
const st = STATUS_COLORS[item.status] || { bg: '#f7fafc', text: '#718096', label: item.status };
return (
<div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: index < history.length - 1 ? '1px solid var(--border)' : 'none', gap: '8px' }}>
<div style={{ flex: 1 }}>
<div style={{ fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-secondary)', lineHeight: 1.3 }}>{item.title || 'Task removed'}</div>
<div style={{ fontSize: '0.7rem', color: 'var(--text-faintest)', marginTop: '1px' }}>{item.date ? new Date(item.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</div>
</div>
<div style={{ textAlign: 'right', flexShrink: 0 }}>
<div style={{ fontWeight: '700', color: ['approved','auto_approved'].includes(item.status) ? '#276749' : 'var(--text-faint)', fontSize: '0.82rem' }}>
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
