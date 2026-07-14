import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchAdminUsers, setUserBanned, adminRemoveAvatar, fetchWorkerPaymentLookup,
} from './piClient';

const PAGE_SIZE = 20;

/**
 * Admin: searchable/paginated user list — replaces pasting a raw piUid into
 * a box blindly. Search by username or piUid, then act directly on the row:
 * ban/unban, remove-or-unblock avatar, or expand a read-only payment lookup
 * (same data as the standalone Worker Payment Lookup box, just scoped to
 * this one row so there's no copy-pasting a piUid between two tools).
 */
export default function AdminUsers({ notify }) {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [expanded, setExpanded] = useState(null); // id of row with lookup panel open
  const [lookupData, setLookupData] = useState({}); // id -> result | 'loading' | error string
  const debounceRef = useRef(null);

  const load = useCallback(async (q, p) => {
    setLoading(true);
    try {
      const r = await fetchAdminUsers(q, p, PAGE_SIZE);
      setUsers(r.users || []);
      setTotal(r.total || 0);
    } catch (e) {
      notify?.('⚠️ ' + (e.message || 'Could not load users'));
    } finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { load('', 1); }, [load]);

  const onQueryChange = (v) => {
    setQuery(v);
    setPage(1);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(v.trim(), 1), 350);
  };

  const goToPage = (p) => { setPage(p); load(query.trim(), p); };

  const toggleBan = async (u) => {
    setBusyId(u.id);
    try {
      await setUserBanned(u.id, !u.isBanned);
      notify?.(u.isBanned ? `✅ @${u.username} unbanned` : `⛔ @${u.username} banned`);
      await load(query.trim(), page);
    } catch (e) {
      notify?.('⚠️ ' + (e.message || 'Failed'));
    } finally { setBusyId(null); }
  };

  const toggleAvatarBlock = async (u) => {
    setBusyId(u.id);
    try {
      const r = await adminRemoveAvatar(u.piUid, u.avatarBlocked); // if currently blocked, this call unblocks
      notify?.(u.avatarBlocked ? `✅ @${r.username}: uploads re-enabled.` : `🖼️ @${r.username}: avatar removed and uploads blocked.`);
      await load(query.trim(), page);
    } catch (e) {
      notify?.('⚠️ ' + (e.message || 'Failed'));
    } finally { setBusyId(null); }
  };

  const toggleLookup = async (u) => {
    if (expanded === u.id) { setExpanded(null); return; }
    setExpanded(u.id);
    if (lookupData[u.id] && lookupData[u.id] !== 'error') return; // cached
    setLookupData((d) => ({ ...d, [u.id]: 'loading' }));
    try {
      const r = await fetchWorkerPaymentLookup(u.piUid);
      setLookupData((d) => ({ ...d, [u.id]: r }));
    } catch (e) {
      setLookupData((d) => ({ ...d, [u.id]: 'error' }));
      notify?.('⚠️ ' + (e.message || 'Lookup failed'));
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div style={{ backgroundColor: 'white', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '14px', marginBottom: '14px' }}>
      <div style={{ fontWeight: '800', color: '#065F46', fontSize: '0.9rem', marginBottom: '3px' }}>
        👤 Users
      </div>
      <p style={{ fontSize: '0.72rem', color: '#718096', margin: '0 0 10px' }}>
        Search by username or piUid, then act directly on the row — no more pasting piUids blindly.
      </p>

      <input
        value={query} onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search username or piUid…"
        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: '9px', border: '1.5px solid #e2e8f0', fontSize: '0.85rem', color: '#2d3748', backgroundColor: 'white', outline: 'none', marginBottom: '10px' }}
      />

      {loading ? (
        <div style={{ fontSize: '0.75rem', color: '#a0aec0' }}>Loading…</div>
      ) : users.length === 0 ? (
        <div style={{ fontSize: '0.75rem', color: '#a0aec0' }}>No users match.</div>
      ) : (
        <>
          <div style={{ fontSize: '0.68rem', color: '#a0aec0', marginBottom: '6px' }}>
            {total} user{total === 1 ? '' : 's'}{query.trim() ? ` matching "${query.trim()}"` : ''}
          </div>
          {users.map((u) => (
            <div key={u.id} style={{
              border: '1px solid #edf2f7', borderRadius: '9px', padding: '9px 10px', marginBottom: '6px',
              backgroundColor: u.isBanned ? '#fff5f5' : 'white',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: '700', color: '#2d3748' }}>
                    @{u.username}
                    {u.isBanned && <span style={{ color: '#c53030', marginLeft: '6px', fontSize: '0.68rem', fontWeight: '800' }}>BANNED</span>}
                    {u.avatarBlocked && <span style={{ color: '#d97706', marginLeft: '6px', fontSize: '0.68rem', fontWeight: '800' }}>AVATAR BLOCKED</span>}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: '#a0aec0', marginTop: '2px' }}>
                    {u.piUid} {u.country && `· ${u.country}`} · joined {new Date(u.createdAt).toLocaleDateString()}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#4a5568', marginTop: '3px' }}>
                    Balance <b>{u.balancePi}π</b> · ✅ {u.approvedCount} · ❌ {u.rejectedCount}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '5px', flexShrink: 0, flexWrap: 'wrap' }}>
                  <button onClick={() => toggleLookup(u)}
                    style={{ padding: '5px 9px', borderRadius: '7px', border: '1.5px solid #bae6fd', backgroundColor: 'white', color: '#0369a1', fontSize: '0.68rem', fontWeight: '700', cursor: 'pointer' }}>
                    {expanded === u.id ? 'Hide payments' : '💸 Payments'}
                  </button>
                  <button onClick={() => toggleAvatarBlock(u)} disabled={busyId === u.id}
                    style={{ padding: '5px 9px', borderRadius: '7px', border: '1.5px solid #fed7d7', backgroundColor: 'white', color: '#c53030', fontSize: '0.68rem', fontWeight: '700', cursor: 'pointer' }}>
                    {u.avatarBlocked ? 'Unblock avatar' : 'Remove avatar'}
                  </button>
                  <button onClick={() => toggleBan(u)} disabled={busyId === u.id}
                    style={{
                      padding: '5px 9px', borderRadius: '7px', border: 'none',
                      backgroundColor: u.isBanned ? '#059669' : '#c53030', color: 'white',
                      fontSize: '0.68rem', fontWeight: '700', cursor: 'pointer',
                    }}>
                    {u.isBanned ? 'Unban' : 'Ban'}
                  </button>
                </div>
              </div>

              {expanded === u.id && (
                <div style={{ marginTop: '9px', paddingTop: '9px', borderTop: '1px solid #edf2f7' }}>
                  {lookupData[u.id] === 'loading' ? (
                    <div style={{ fontSize: '0.72rem', color: '#a0aec0' }}>Looking up…</div>
                  ) : lookupData[u.id] === 'error' ? (
                    <div style={{ fontSize: '0.72rem', color: '#c53030' }}>Lookup failed.</div>
                  ) : lookupData[u.id] ? (
                    <>
                      <div style={{ fontSize: '0.72rem', color: '#4a5568', marginBottom: '6px' }}>
                        Approved: {lookupData[u.id].worker.approvedCount} · Total approved reward: {lookupData[u.id].totalApprovedRewardPi}π
                        {lookupData[u.id].approvedSubmissionsWithoutPayout > 0 && (
                          <div style={{ color: '#c53030', marginTop: '4px', fontWeight: '700' }}>
                            ⚠️ {lookupData[u.id].approvedSubmissionsWithoutPayout} approved submission(s) have NO linked payout
                          </div>
                        )}
                      </div>
                      {lookupData[u.id].payoutCount === 0 ? (
                        <div style={{ fontSize: '0.7rem', color: '#a0aec0', fontStyle: 'italic' }}>No A2U worker_payout records for this worker.</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                          {lookupData[u.id].payouts.map((p, i) => {
                            const c = p.verdict === 'paid_confirmed' ? '#16a34a'
                              : p.verdict.startsWith('not_paid') ? '#9ca3af'
                              : p.verdict.startsWith('pending') ? '#d97706'
                              : '#c53030';
                            return (
                              <div key={i} style={{ border: `1px solid ${c}33`, borderLeft: `3px solid ${c}`, borderRadius: '6px', padding: '6px 8px', backgroundColor: '#fafafa' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem' }}>
                                  <span style={{ fontWeight: '700', color: c }}>{p.verdict}</span>
                                  <span style={{ color: '#4a5568' }}>{p.amountPi}π</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  ) : null}
                </div>
              )}
            </div>
          ))}

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '8px', alignItems: 'center' }}>
              <button onClick={() => goToPage(page - 1)} disabled={page <= 1}
                style={{ padding: '5px 10px', borderRadius: '7px', border: '1.5px solid #e2e8f0', backgroundColor: 'white', color: page <= 1 ? '#cbd5e0' : '#4a5568', fontSize: '0.72rem', fontWeight: '700', cursor: page <= 1 ? 'not-allowed' : 'pointer' }}>
                ← Prev
              </button>
              <span style={{ fontSize: '0.72rem', color: '#a0aec0' }}>{page} / {totalPages}</span>
              <button onClick={() => goToPage(page + 1)} disabled={page >= totalPages}
                style={{ padding: '5px 10px', borderRadius: '7px', border: '1.5px solid #e2e8f0', backgroundColor: 'white', color: page >= totalPages ? '#cbd5e0' : '#4a5568', fontSize: '0.72rem', fontWeight: '700', cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}>
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
