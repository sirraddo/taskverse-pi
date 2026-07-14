import { useState, useEffect, useCallback } from 'react';
import { fetchMyTickets, createTicket, fetchMyTicket, replyToTicket } from './piClient';

const STATUS_BADGE = {
  open: { label: 'Open', bg: '#fefcbf', color: '#744210' },
  answered: { label: 'Replied', bg: '#c6f6d5', color: '#276749' },
  closed: { label: 'Closed', bg: '#edf2f7', color: '#718096' },
};

const CATEGORIES = [
  { value: 'payment', label: '💳 Payment' },
  { value: 'task', label: '📌 Task' },
  { value: 'account', label: '👤 Account' },
  { value: 'other', label: '💬 Other' },
];

function NewTicketForm({ onCreated, onCancel }) {
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('other');
  const [refId, setRefId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const inputStyle = {
    width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: '10px',
    border: '1.5px solid #e2e8f0', fontSize: '0.86rem', color: '#2d3748',
    backgroundColor: 'white', outline: 'none', marginBottom: '10px', fontFamily: 'inherit',
  };

  const submit = async () => {
    setError(null);
    if (!subject.trim() || !message.trim()) { setError('Subject and message are required.'); return; }
    setBusy(true);
    try {
      await createTicket({ subject: subject.trim(), category, refId: refId.trim(), message: message.trim() });
      onCreated();
    } catch (e) {
      setError(e.message || 'Could not send message');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120}
        placeholder="What's this about?" style={inputStyle} />
      <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
        {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      <input value={refId} onChange={(e) => setRefId(e.target.value)} maxLength={40}
        placeholder="Payment reference (optional, e.g. TXV-4K7QXPM)" style={{ ...inputStyle, fontFamily: 'monospace' }} />
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={3000} rows={5}
        placeholder="Describe the issue…" style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.45 }} />
      {error && (
        <div style={{ color: '#c53030', backgroundColor: '#fff5f5', padding: '9px 11px', borderRadius: '8px', fontSize: '0.8rem', marginBottom: '10px' }}>
          ⚠️ {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={onCancel} style={{ flex: 1, padding: '11px', borderRadius: '10px', border: '1.5px solid #e2e8f0', backgroundColor: 'white', color: '#4a5568', fontWeight: '700', cursor: 'pointer', fontSize: '0.85rem' }}>
          Cancel
        </button>
        <button onClick={submit} disabled={busy || !subject.trim() || !message.trim()}
          style={{
            flex: 2, padding: '11px', borderRadius: '10px', border: 'none',
            backgroundColor: (busy || !subject.trim() || !message.trim()) ? '#a0aec0' : '#047857',
            color: 'white', fontWeight: '700', cursor: 'pointer', fontSize: '0.85rem',
          }}>
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

function TicketThread({ ticketId, onBack }) {
  const [ticket, setTicket] = useState(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try { setTicket(await fetchMyTicket(ticketId)); }
    catch (e) { setError(e.message || 'Could not load ticket'); }
  }, [ticketId]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (!reply.trim()) return;
    setSending(true);
    setError(null);
    try {
      await replyToTicket(ticketId, reply.trim());
      setReply('');
      await load();
    } catch (e) {
      setError(e.message || 'Could not send reply');
    } finally { setSending(false); }
  };

  if (!ticket) return <div style={{ fontSize: '0.82rem', color: '#a0aec0' }}>Loading…</div>;

  const badge = STATUS_BADGE[ticket.status];

  return (
    <div>
      <button onClick={onBack} style={{ background: 'white', border: '1px solid #d1d5db', padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', color: '#374151', fontWeight: '600', marginBottom: '14px' }}>
        ← All tickets
      </button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
        <h3 style={{ margin: 0, fontSize: '0.98rem', color: '#1a202c' }}>{ticket.subject}</h3>
        <span style={{ backgroundColor: badge.bg, color: badge.color, padding: '2px 9px', borderRadius: '10px', fontSize: '0.68rem', fontWeight: '700', flexShrink: 0, marginLeft: '8px' }}>
          {badge.label}
        </span>
      </div>
      {ticket.refId && (
        <div style={{ fontSize: '0.7rem', color: '#a0aec0', fontFamily: 'monospace', marginBottom: '12px' }}>Ref: {ticket.refId}</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', marginBottom: '14px' }}>
        {ticket.messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.from === 'admin' ? 'flex-start' : 'flex-end',
            maxWidth: '82%',
            backgroundColor: m.from === 'admin' ? '#f0fff4' : '#edf2f7',
            border: `1px solid ${m.from === 'admin' ? '#c6f6d5' : '#e2e8f0'}`,
            borderRadius: '12px', padding: '9px 12px',
          }}>
            <div style={{ fontSize: '0.66rem', fontWeight: '700', color: m.from === 'admin' ? '#276749' : '#718096', marginBottom: '3px' }}>
              {m.from === 'admin' ? 'Support' : 'You'} · {new Date(m.createdAt).toLocaleString()}
            </div>
            <div style={{ fontSize: '0.85rem', color: '#2d3748', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{m.body}</div>
          </div>
        ))}
      </div>

      {ticket.status === 'closed' && (
        <div style={{ fontSize: '0.78rem', color: '#a0aec0', fontStyle: 'italic', marginBottom: '8px' }}>
          This ticket is closed. Reply below to reopen it.
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px' }}>
        <input value={reply} onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          placeholder={ticket.status === 'closed' ? 'Reopen with a reply…' : 'Type a reply…'} maxLength={3000}
          style={{ flex: 1, padding: '10px 12px', borderRadius: '10px', border: '1.5px solid #e2e8f0', fontSize: '0.85rem', color: '#2d3748', backgroundColor: 'white' }} />
        <button onClick={send} disabled={sending || !reply.trim()}
          style={{ padding: '10px 16px', borderRadius: '10px', border: 'none', backgroundColor: (sending || !reply.trim()) ? '#a0aec0' : '#047857', color: 'white', fontWeight: '700', cursor: 'pointer', fontSize: '0.85rem', flexShrink: 0 }}>
          {sending ? '…' : 'Send'}
        </button>
      </div>
      {error && (
        <div style={{ color: '#c53030', backgroundColor: '#fff5f5', padding: '9px 11px', borderRadius: '8px', fontSize: '0.8rem', marginTop: '10px' }}>
          ⚠️ {error}
        </div>
      )}
    </div>
  );
}

export default function SupportInbox({ onBack }) {
  const [tickets, setTickets] = useState(null);
  const [view, setView] = useState('list'); // list | new | ticketId
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try { const r = await fetchMyTickets(); setTickets(r.tickets || []); }
    catch (e) { setError(e.message || 'Could not load tickets'); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '500px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
        <button onClick={onBack} style={{ background: 'white', border: '1px solid #d1d5db', padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem', color: '#374151', fontWeight: '500', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>← Back</button>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>🎧 Support</h2>
      </div>

      {typeof view === 'string' && view.startsWith('ticket:') ? (
        <TicketThread ticketId={view.slice(7)} onBack={() => { setView('list'); load(); }} />
      ) : view === 'new' ? (
        <div style={{ backgroundColor: 'white', borderRadius: '14px', padding: '16px', boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}>
          <NewTicketForm onCreated={() => { setView('list'); load(); }} onCancel={() => setView('list')} />
        </div>
      ) : (
        <>
          <button onClick={() => setView('new')}
            style={{ width: '100%', padding: '12px', borderRadius: '10px', border: 'none', backgroundColor: '#047857', color: 'white', fontWeight: '700', fontSize: '0.88rem', cursor: 'pointer', marginBottom: '16px' }}>
            ✉️ New message
          </button>

          {error && <div style={{ color: '#c53030', fontSize: '0.82rem', marginBottom: '10px' }}>⚠️ {error}</div>}

          {tickets === null ? (
            <div style={{ fontSize: '0.82rem', color: '#a0aec0' }}>Loading…</div>
          ) : tickets.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#a0aec0' }}>
              <div style={{ fontSize: '2.4rem', marginBottom: '8px' }}>🎧</div>
              <p>No messages yet. Reach out any time.</p>
            </div>
          ) : tickets.map((t) => {
            const badge = STATUS_BADGE[t.status];
            return (
              <div key={t.id} onClick={() => setView(`ticket:${t.id}`)}
                style={{ backgroundColor: 'white', borderRadius: '12px', padding: '13px 14px', marginBottom: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: '700', color: '#2d3748', fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {t.subject}
                      {t.hasUnreadForUser && <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#e53e3e', flexShrink: 0 }} />}
                    </div>
                    <div style={{ fontSize: '0.76rem', color: '#a0aec0', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.lastMessage}
                    </div>
                  </div>
                  <span style={{ backgroundColor: badge.bg, color: badge.color, padding: '2px 9px', borderRadius: '10px', fontSize: '0.66rem', fontWeight: '700', flexShrink: 0, marginLeft: '8px' }}>
                    {badge.label}
                  </span>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
