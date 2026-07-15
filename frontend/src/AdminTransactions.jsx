import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchAdminTransactions, exportAdminTransactionsCsv } from './piClient';

const PAGE_SIZE = 20;

const STATUS_COLOR = {
  completed: '#16a34a', approved: '#0369a1', created: '#a0aec0',
  cancelled: '#9ca3af', failed: '#c53030',
};

const PURPOSE_LABEL = {
  task_funding: '📌 Task funding', worker_payout: '💸 Worker payout', withdrawal: '🏦 Withdrawal', referral_bonus: '🎁 Referral bonus',
};

function TxRow({ t }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: '9px', padding: '9px 10px', marginBottom: '6px', backgroundColor: 'var(--surface)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.78rem', fontWeight: '800', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
            {t.refId || '—'}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            {PURPOSE_LABEL[t.purpose] || t.purpose} · {t.direction}
            {t.user && <> · @{t.user.username}</>}
            {t.task && <> · {t.task.title}</>}
          </div>
          <div style={{ fontSize: '0.66rem', color: 'var(--text-faintest)', marginTop: '2px' }}>
            {new Date(t.createdAt).toLocaleString()}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: '0.85rem', fontWeight: '800', color: 'var(--text-secondary)' }}>{t.amountPi}π</div>
          <span style={{
            display: 'inline-block', marginTop: '3px', padding: '2px 8px', borderRadius: '10px',
            fontSize: '0.66rem', fontWeight: '700', color: 'white',
            backgroundColor: STATUS_COLOR[t.status] || '#a0aec0',
          }}>
            {t.status}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Admin: every Payment record in one place — task funding, worker payouts,
 * withdrawals, any status. Each has a short refId (e.g. TXV-4K7QXPM) meant
 * to be quoted by a user in a support message; the box at the top does an
 * exact-match lookup on that refId (also accepts a raw piPaymentId/txid).
 */
export default function AdminTransactions({ notify }) {
  const [refQuery, setRefQuery] = useState('');
  const [refResult, setRefResult] = useState(null); // null | 'loading' | 'notfound' | transaction object
  const [direction, setDirection] = useState('');
  const [purpose, setPurpose] = useState('');
  const [status, setStatus] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const debounceRef = useRef(null);

  const handleExport = async () => {
    setExporting(true);
    try { await exportAdminTransactionsCsv({ direction, purpose, status, user: userQuery }); }
    catch (e) { notify?.('⚠️ ' + (e.message || 'Export failed')); }
    finally { setExporting(false); }
  };

  const load = useCallback(async (p, filters) => {
    setLoading(true);
    try {
      const r = await fetchAdminTransactions({ page: p, limit: PAGE_SIZE, ...filters });
      setRows(r.transactions || []);
      setTotal(r.total || 0);
    } catch (e) {
      notify?.('⚠️ ' + (e.message || 'Could not load transactions'));
    } finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { load(1, { direction, purpose, status, user: userQuery }); }, [load]); // eslint-disable-line

  const applyFilters = (next) => {
    const merged = { direction, purpose, status, user: userQuery, ...next };
    setPage(1);
    load(1, merged);
  };

  const goToPage = (p) => { setPage(p); load(p, { direction, purpose, status, user: userQuery }); };

  const onUserQueryChange = (v) => {
    setUserQuery(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => applyFilters({ user: v }), 350);
  };

  const doRefLookup = async () => {
    const q = refQuery.trim();
    if (!q) return;
    setRefResult('loading');
    try {
      const r = await fetchAdminTransactions({ ref: q });
      setRefResult(r.transactions?.[0] || 'notfound');
    } catch {
      setRefResult('notfound');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const selectStyle = {
    padding: '7px 9px', borderRadius: '8px', border: '1.5px solid var(--border)', fontSize: '0.76rem',
    color: 'var(--text-muted)', backgroundColor: 'var(--surface)', flex: 1, minWidth: '90px',
  };

  return (
    <div style={{ backgroundColor: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: '12px', padding: '14px', marginBottom: '14px' }}>
      <div style={{ fontWeight: '800', color: '#065F46', fontSize: '0.9rem', marginBottom: '3px' }}>
        💳 Transactions
      </div>
      <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', margin: '0 0 12px' }}>
        Every task-funding and payout transaction, any status. Ask a user for the reference on their receipt for a direct lookup.
      </p>

      {/* Quick refId lookup */}
      <div style={{ backgroundColor: '#f0f9ff', border: '1.5px solid #bae6fd', borderRadius: '10px', padding: '10px', marginBottom: '12px' }}>
        <div style={{ fontSize: '0.72rem', fontWeight: '700', color: '#0369a1', marginBottom: '7px' }}>QUICK LOOKUP BY REFERENCE</div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <input value={refQuery} onChange={(e) => setRefQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doRefLookup(); }}
            placeholder="TXV-4K7QXPM"
            style={{ flex: 1, padding: '8px 10px', borderRadius: '8px', border: '1.5px solid #bae6fd', fontSize: '0.82rem', fontFamily: 'monospace', color: 'var(--text-secondary)', backgroundColor: 'var(--surface)' }} />
          <button onClick={doRefLookup} disabled={!refQuery.trim() || refResult === 'loading'}
            style={{ padding: '8px 14px', borderRadius: '8px', border: 'none', backgroundColor: '#0369a1', color: 'white', fontWeight: '700', fontSize: '0.8rem', cursor: 'pointer', flexShrink: 0 }}>
            {refResult === 'loading' ? '…' : '🔍 Find'}
          </button>
        </div>
        {refResult === 'notfound' && (
          <div style={{ fontSize: '0.72rem', color: '#c53030', marginTop: '8px' }}>No transaction matches that reference.</div>
        )}
        {refResult && refResult !== 'loading' && refResult !== 'notfound' && (
          <div style={{ marginTop: '8px' }}>
            <TxRow t={refResult} />
          </div>
        )}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
        <select value={direction} onChange={(e) => { setDirection(e.target.value); applyFilters({ direction: e.target.value }); }} style={selectStyle}>
          <option value="">All directions</option>
          <option value="U2A">Funding (U2A)</option>
          <option value="A2U">Payout (A2U)</option>
        </select>
        <select value={purpose} onChange={(e) => { setPurpose(e.target.value); applyFilters({ purpose: e.target.value }); }} style={selectStyle}>
          <option value="">All purposes</option>
          <option value="task_funding">Task funding</option>
          <option value="worker_payout">Worker payout</option>
          <option value="withdrawal">Withdrawal</option>
          <option value="referral_bonus">Referral bonus</option>
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); applyFilters({ status: e.target.value }); }} style={selectStyle}>
          <option value="">All statuses</option>
          <option value="created">Created</option>
          <option value="approved">Approved</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="failed">Failed</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
        <input value={userQuery} onChange={(e) => onUserQueryChange(e.target.value)}
          placeholder="Filter by username or piUid…"
          style={{ flex: 1, boxSizing: 'border-box', padding: '9px 12px', borderRadius: '9px', border: '1.5px solid var(--border)', fontSize: '0.82rem', color: 'var(--text-secondary)', backgroundColor: 'var(--surface)', outline: 'none' }} />
        <button onClick={handleExport} disabled={exporting}
          style={{ padding: '9px 12px', borderRadius: '9px', border: '1.5px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-muted)', fontSize: '0.78rem', fontWeight: '700', cursor: exporting ? 'not-allowed' : 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>
          {exporting ? '…' : '⬇️ CSV'}
        </button>
      </div>

      {loading ? (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-faintest)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-faintest)' }}>No transactions match.</div>
      ) : (
        <>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-faintest)', marginBottom: '6px' }}>{total} transaction{total === 1 ? '' : 's'}</div>
          {rows.map((t) => <TxRow key={t.id} t={t} />)}
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
