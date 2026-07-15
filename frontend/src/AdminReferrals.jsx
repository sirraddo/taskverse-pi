import { useState, useEffect, useCallback } from 'react';
import { fetchAdminReferrals, retryReferralPayout } from './piClient';

const STATUS_BADGE = {
  pending: { label: 'Pending', bg: '#fefcbf', color: '#744210' },
  paid: { label: 'Paid', bg: '#c6f6d5', color: '#276749' },
  failed: { label: 'Failed', bg: '#fed7d7', color: '#c53030' },
};

export default function AdminReferrals({ notify }) {
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState(null);

  const load = useCallback(async (s) => {
    setLoading(true);
    try {
      const r = await fetchAdminReferrals({ status: s });
      setRows(r.referrals || []);
    } catch (e) {
      notify?.('⚠️ ' + (e.message || 'Could not load referrals'));
    } finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { load(status); }, [load, status]);

  const retry = async (r) => {
    setRetryingId(r.id);
    try {
      const res = await retryReferralPayout(r.id);
      notify?.(res.status === 'paid' ? `✅ Paid @${r.referrer} their referral bonus` : '⚠️ Retry attempted, still not paid — check details');
      await load(status);
    } catch (e) {
      notify?.('⚠️ ' + (e.message || 'Retry failed'));
    } finally { setRetryingId(null); }
  };

  const failedCount = rows.filter((r) => r.status === 'failed').length;

  return (
    <div style={{ backgroundColor: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: '12px', padding: '14px', marginBottom: '14px' }}>
      <div style={{ fontWeight: '800', color: '#065F46', fontSize: '0.9rem', marginBottom: '3px' }}>
        🎁 Referrals
      </div>
      <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', margin: '0 0 12px' }}>
        Pays out once the referred user's first submission is approved. Adjust the reward amount in Settings.
      </p>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
        {['', 'pending', 'paid', 'failed'].map((s) => (
          <button key={s || 'all'} onClick={() => setStatus(s)}
            style={{
              padding: '6px 11px', borderRadius: '16px', border: 'none', fontSize: '0.72rem', fontWeight: '700', cursor: 'pointer',
              backgroundColor: status === s ? '#059669' : 'var(--surface)',
              color: status === s ? 'white' : 'var(--text-muted)',
              boxShadow: status === s ? 'none' : '0 1px 3px var(--shadow-color)',
            }}>
            {s ? (STATUS_BADGE[s]?.label || s) : 'All'}{s === 'failed' && failedCount > 0 ? ` (${failedCount})` : ''}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-faintest)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-faintest)' }}>No referrals{status ? ` with status "${status}"` : ' yet'}.</div>
      ) : rows.map((r) => {
        const badge = STATUS_BADGE[r.status];
        return (
          <div key={r.id} style={{ border: '1px solid var(--border)', borderRadius: '9px', padding: '9px 10px', marginBottom: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-secondary)' }}>
                  @{r.referrer} <span style={{ color: 'var(--text-faintest)', fontWeight: '400' }}>referred</span> @{r.referredUser}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-faintest)', marginTop: '2px' }}>
                  {r.rewardPi}π · {new Date(r.createdAt).toLocaleDateString()}
                  {r.status === 'failed' && r.failureReason && <> · {r.failureReason}</>}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <span style={{ backgroundColor: badge.bg, color: badge.color, padding: '2px 8px', borderRadius: '10px', fontSize: '0.64rem', fontWeight: '700' }}>
                  {badge.label}
                </span>
                {r.status === 'failed' && (
                  <button onClick={() => retry(r)} disabled={retryingId === r.id}
                    style={{ display: 'block', marginTop: '6px', padding: '4px 10px', borderRadius: '7px', border: 'none', backgroundColor: '#059669', color: 'white', fontSize: '0.66rem', fontWeight: '700', cursor: retryingId === r.id ? 'not-allowed' : 'pointer' }}>
                    {retryingId === r.id ? '…' : 'Retry'}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
