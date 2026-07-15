import { useState, useEffect, useCallback } from 'react';
import { fetchAdminAuditLog } from './piClient';

const PAGE_SIZE = 25;

// Icons for the more common action prefixes — purely cosmetic, falls back
// to a generic dot for anything not listed.
const ACTION_ICON = {
  'submission.approve': '✅', 'submission.reject': '❌', 'dispute.resolve': '⚖️',
  'user.ban': '⛔', 'user.unban': '✅', 'avatar.remove': '🖼️', 'avatar.unblock': '🖼️',
  'flag.create': '🚩', 'flag.toggle': '🚩', 'flag.delete': '🚩',
  'settings.update': '⚙️', 'announcement.create': '📢', 'announcement.toggle': '📢', 'announcement.delete': '📢',
  'banner.create': '🖼️', 'banner.update': '🖼️', 'banner.delete': '🖼️',
  'support.reply': '🎧', 'support.status_change': '🎧',
  'task.create_sponsored': '📌', 'balance.fix': '🔧',
};

function iconFor(action) {
  return ACTION_ICON[action] || (action.startsWith('payouts.') ? '💸' : action.startsWith('tasks.') ? '📌' : '•');
}

function labelFor(action) {
  return action.replace(/\./g, ' → ').replace(/_/g, ' ');
}

export default function AdminAuditLog({ notify }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [adminFilter, setAdminFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p, filters) => {
    setLoading(true);
    try {
      const r = await fetchAdminAuditLog({ page: p, limit: PAGE_SIZE, ...filters });
      setRows(r.entries || []);
      setTotal(r.total || 0);
    } catch (e) {
      notify?.('⚠️ ' + (e.message || 'Could not load audit log'));
    } finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { load(1, { admin: adminFilter, action: actionFilter }); }, [load]); // eslint-disable-line

  const applyFilters = (next) => {
    const merged = { admin: adminFilter, action: actionFilter, ...next };
    setPage(1);
    load(1, merged);
  };

  const goToPage = (p) => { setPage(p); load(p, { admin: adminFilter, action: actionFilter }); };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const inputStyle = {
    padding: '8px 11px', borderRadius: '9px', border: '1.5px solid var(--border)', fontSize: '0.8rem',
    color: 'var(--text-secondary)', backgroundColor: 'var(--surface)', outline: 'none', flex: 1, minWidth: '120px',
  };

  return (
    <div style={{ backgroundColor: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: '12px', padding: '14px', marginBottom: '14px' }}>
      <div style={{ fontWeight: '800', color: '#065F46', fontSize: '0.9rem', marginBottom: '3px' }}>
        📜 Audit Log
      </div>
      <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', margin: '0 0 12px' }}>
        Who did what — every admin approval, ban, flag change, and settings edit, in case more than one of you ever needs it.
      </p>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
        <input value={adminFilter} onChange={(e) => setAdminFilter(e.target.value)}
          onBlur={() => applyFilters({ admin: adminFilter })}
          onKeyDown={(e) => { if (e.key === 'Enter') applyFilters({ admin: adminFilter }); }}
          placeholder="Filter by admin username…" style={inputStyle} />
        <select value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); applyFilters({ action: e.target.value }); }} style={inputStyle}>
          <option value="">All actions</option>
          <option value="submission.">Submissions</option>
          <option value="dispute.">Disputes</option>
          <option value="user.">Users (ban/unban)</option>
          <option value="avatar.">Avatar moderation</option>
          <option value="flag.">Feature flags</option>
          <option value="settings.">Platform settings</option>
          <option value="announcement.">Announcements</option>
          <option value="banner.">Banners</option>
          <option value="support.">Support</option>
          <option value="payouts.">Payouts</option>
          <option value="tasks.">Task funding</option>
          <option value="task.">Sponsored tasks</option>
          <option value="balance.">Balance fixes</option>
        </select>
      </div>

      {loading ? (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-faintest)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-faintest)' }}>No matching entries.</div>
      ) : (
        <>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-faintest)', marginBottom: '6px' }}>{total} entr{total === 1 ? 'y' : 'ies'}</div>
          {rows.map((r) => (
            <div key={r.id} style={{ border: '1px solid var(--border)', borderRadius: '9px', padding: '9px 10px', marginBottom: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-secondary)' }}>
                    {iconFor(r.action)} {labelFor(r.action)}
                  </div>
                  {r.details && (
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '3px' }}>{r.details}</div>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: '700', color: r.adminUsername === 'cron' ? 'var(--text-faintest)' : '#0369a1' }}>
                    {r.adminUsername === 'cron' ? '🤖 cron' : `@${r.adminUsername}`}
                  </div>
                  <div style={{ fontSize: '0.66rem', color: 'var(--text-faintest)', marginTop: '2px' }}>
                    {new Date(r.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          ))}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '8px', alignItems: 'center' }}>
              <button onClick={() => goToPage(page - 1)} disabled={page <= 1}
                style={{ padding: '5px 10px', borderRadius: '7px', border: '1.5px solid var(--border)', backgroundColor: 'var(--surface)', color: page <= 1 ? 'var(--border-strong)' : 'var(--text-muted)', fontSize: '0.72rem', fontWeight: '700', cursor: page <= 1 ? 'not-allowed' : 'pointer' }}>
                ← Prev
              </button>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-faintest)' }}>{page} / {totalPages}</span>
              <button onClick={() => goToPage(page + 1)} disabled={page >= totalPages}
                style={{ padding: '5px 10px', borderRadius: '7px', border: '1.5px solid var(--border)', backgroundColor: 'var(--surface)', color: page >= totalPages ? 'var(--border-strong)' : 'var(--text-muted)', fontSize: '0.72rem', fontWeight: '700', cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}>
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
