import { useState, useEffect, useCallback } from 'react';
import { fetchAdminTickets, fetchAdminTicket, replyToTicketAsAdmin, setTicketStatus } from './piClient';

const STATUS_BADGE = {
  open: { label: 'Open', bg: '#fefcbf', color: '#744210' },
  answered: { label: 'Answered', bg: '#c6f6d5', color: '#276749' },
  closed: { label: 'Closed', bg: '#edf2f7', color: '#718096' },
};

function AdminTicketThread({ ticketId, onBack, onChanged, onUnreadChanged }) {
  const [ticket, setTicket] = useState(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setTicket(await fetchAdminTicket(ticketId));
      onUnreadChanged?.(); // viewing the thread already cleared it server-side
    }
    catch (e) { setError(e.message || 'Could not load ticket'); }
  }, [ticketId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (!reply.trim()) return;
    setSending(true);
    setError(null);
    try {
      await replyToTicketAsAdmin(ticketId, reply.trim());
      setReply('');
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message || 'Could not send reply');
    } finally { setSending(false); }
  };

  const toggleClosed = async () => {
    setBusy(true);
    try {
      await setTicketStatus(ticketId, ticket.status === 'closed' ? 'open' : 'closed');
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message || 'Failed');
    } finally { setBusy(false); }
  };

  if (!ticket) return <div style={{ fontSize: '0.75rem', color: 'var(--text-faintest)' }}>Loading…</div>;
  const badge = STATUS_BADGE[ticket.status];

  return (
    <div>
      <button onClick={onBack}
        style={{ background: 'var(--surface)', border: '1.5px solid var(--border)', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: '700', marginBottom: '12px' }}>
        ← All tickets
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: '0.92rem', color: 'var(--text)' }}>{ticket.subject}</h3>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginTop: '2px' }}>
            @{ticket.user?.username} · {ticket.user?.piUid} · {ticket.category}
          </div>
        </div>
        <span style={{ backgroundColor: badge.bg, color: badge.color, padding: '2px 9px', borderRadius: '10px', fontSize: '0.66rem', fontWeight: '700', flexShrink: 0, marginLeft: '8px' }}>
          {badge.label}
        </span>
      </div>
      {ticket.refId && (
        <div style={{ fontSize: '0.7rem', color: '#0369a1', fontFamily: 'monospace', marginTop: '4px', marginBottom: '10px' }}>
          Ref: {ticket.refId} — check Admin → Transactions for this payment
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', margin: '12px 0' }}>
        {ticket.messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.from === 'admin' ? 'flex-end' : 'flex-start',
            maxWidth: '82%',
            backgroundColor: m.from === 'admin' ? '#f0fff4' : 'var(--surface-alt)',
            border: `1px solid ${m.from === 'admin' ? '#c6f6d5' : 'var(--border)'}`,
            borderRadius: '12px', padding: '9px 12px',
          }}>
            <div style={{ fontSize: '0.64rem', fontWeight: '700', color: m.from === 'admin' ? '#276749' : 'var(--text-faint)', marginBottom: '3px' }}>
              {m.from === 'admin' ? 'You' : `@${ticket.user?.username}`} · {new Date(m.createdAt).toLocaleString()}
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{m.body}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '6px' }}>
        <input value={reply} onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          placeholder="Reply…" maxLength={3000}
          style={{ flex: 1, padding: '9px 11px', borderRadius: '9px', border: '1.5px solid var(--border)', fontSize: '0.82rem', color: 'var(--text-secondary)', backgroundColor: 'var(--surface)' }} />
        <button onClick={send} disabled={sending || !reply.trim()}
          style={{ padding: '9px 14px', borderRadius: '9px', border: 'none', backgroundColor: (sending || !reply.trim()) ? '#a0aec0' : '#059669', color: 'white', fontWeight: '700', cursor: 'pointer', fontSize: '0.8rem', flexShrink: 0 }}>
          {sending ? '…' : 'Reply'}
        </button>
      </div>
      <button onClick={toggleClosed} disabled={busy}
        style={{ marginTop: '8px', padding: '7px 12px', borderRadius: '8px', border: '1.5px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-faint)', fontWeight: '700', fontSize: '0.72rem', cursor: 'pointer' }}>
        {ticket.status === 'closed' ? 'Reopen' : 'Mark closed'}
      </button>

      {error && (
        <div style={{ color: '#c53030', backgroundColor: '#fff5f5', padding: '8px 10px', borderRadius: '8px', fontSize: '0.75rem', marginTop: '10px' }}>
          ⚠️ {error}
        </div>
      )}
    </div>
  );
}

export default function AdminSupport({ notify, onUnreadChanged }) {
  const [status, setStatusFilter] = useState('');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [openTicketId, setOpenTicketId] = useState(null);

  const load = useCallback(async (statusFilter) => {
    setLoading(true);
    try {
      const r = await fetchAdminTickets({ status: statusFilter, limit: 50 });
      setRows(r.tickets || []);
      setTotal(r.total || 0);
    } catch (e) {
      notify?.('⚠️ ' + (e.message || 'Could not load tickets'));
    } finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { load(status); }, [load, status]);

  const openCount = rows.filter((t) => t.status === 'open').length;

  return (
    <div style={{ backgroundColor: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: '12px', padding: '14px', marginBottom: '14px' }}>
      <div style={{ fontWeight: '800', color: '#065F46', fontSize: '0.9rem', marginBottom: '3px' }}>
        🎧 Support
      </div>
      <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', margin: '0 0 12px' }}>
        In-app messages from users. Replying marks a ticket Answered; a user reply puts it back to Open.
      </p>

      {openTicketId ? (
        <AdminTicketThread ticketId={openTicketId} onBack={() => setOpenTicketId(null)} onChanged={() => load(status)} onUnreadChanged={onUnreadChanged} />
      ) : (
        <>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
            {['', 'open', 'answered', 'closed'].map((s) => (
              <button key={s || 'all'} onClick={() => setStatusFilter(s)}
                style={{
                  padding: '6px 11px', borderRadius: '16px', border: 'none', fontSize: '0.72rem', fontWeight: '700', cursor: 'pointer',
                  backgroundColor: status === s ? '#059669' : 'var(--surface)',
                  color: status === s ? 'white' : 'var(--text-muted)',
                  boxShadow: status === s ? 'none' : '0 1px 3px var(--shadow-color)',
                }}>
                {s ? (STATUS_BADGE[s]?.label || s) : 'All'}{s === 'open' && openCount > 0 ? ` (${openCount})` : ''}
              </button>
            ))}
          </div>

          {loading ? (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-faintest)' }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-faintest)' }}>No tickets{status ? ` with status "${status}"` : ''}.</div>
          ) : (
            <>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-faintest)', marginBottom: '6px' }}>{total} ticket{total === 1 ? '' : 's'}</div>
              {rows.map((t) => {
                const badge = STATUS_BADGE[t.status];
                const onFixedBg = t.status === 'open'; // '#fffbeb' below is a fixed literal color, not theme-aware
                return (
                  <div key={t.id} onClick={() => setOpenTicketId(t.id)}
                    style={{ border: '1px solid var(--border)', borderRadius: '9px', padding: '9px 10px', marginBottom: '6px', cursor: 'pointer', backgroundColor: onFixedBg ? '#fffbeb' : 'var(--surface)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: '700', color: onFixedBg ? '#374151' : 'var(--text-secondary)' }}>{t.subject}</div>
                        <div style={{ fontSize: '0.7rem', color: onFixedBg ? '#6b7280' : 'var(--text-faint)', marginTop: '2px' }}>
                          @{t.user?.username || 'unknown'} · {t.category}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: onFixedBg ? '#9ca3af' : 'var(--text-faintest)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.lastMessage}
                        </div>
                      </div>
                      <span style={{ backgroundColor: badge.bg, color: badge.color, padding: '2px 8px', borderRadius: '10px', fontSize: '0.64rem', fontWeight: '700', flexShrink: 0 }}>
                        {badge.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </>
      )}
    </div>
  );
}
