import { useState, useEffect, useRef } from 'react';
import { fetchAiStatus, askTaskVerseAi } from './piClient';

const TIPS = ['Why was my submission rejected?', 'Where is my payout?', 'How do I earn more?', 'Ṣé mo lè ní iranlọ̀wọ́?'];

/** Floating helper for workers. Read-only: explains the app and the user's own submissions/payouts. */
export default function AskTaskVerse() {
  const [on, setOn] = useState(false);
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef(null);

  useEffect(() => { fetchAiStatus().then((s) => setOn(!!s.available)).catch(() => {}); }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy, open]);
  if (!on) return null;

  const send = async (q) => {
    const message = (q ?? text).trim();
    if (!message || busy) return;
    const history = msgs.slice(-6).map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: 'user', text: message }]);
    setText(''); setBusy(true);
    try {
      const r = await askTaskVerseAi(message, history);
      setMsgs((m) => [...m, { role: 'assistant', text: r.reply }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', text: '⚠️ ' + (e.message || 'Could not answer right now.'), err: true }]);
    } finally { setBusy(false); }
  };

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} aria-label="Ask TaskVerse"
          style={{ position: 'fixed', right: 14, bottom: 18, zIndex: 50, border: 'none', borderRadius: 26, padding: '11px 16px', background: 'linear-gradient(135deg,#059669,#047857)', color: 'white', fontWeight: 800, fontSize: '0.85rem', boxShadow: '0 4px 14px rgba(5,150,105,0.45)', cursor: 'pointer' }}>
          🤖 Ask
        </button>
      )}
      {open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 500, height: '78vh', background: 'var(--bg)', borderRadius: '18px 18px 0 0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
              <div><div style={{ fontWeight: 800, color: 'var(--text)', fontSize: '0.95rem' }}>🤖 Ask TaskVerse</div><div style={{ fontSize: '0.66rem', color: 'var(--text-faint)' }}>Answers about tasks, rejections and payouts. English, Pidgin or Yorùbá.</div></div>
              <button onClick={() => setOpen(false)} style={{ border: 'none', background: 'none', fontSize: '1.2rem', cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
              {msgs.length === 0 && (
                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 10 }}>Hi! Ask me anything about TaskVerse Earn or your own submissions and payouts.</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {TIPS.map((t) => <button key={t} onClick={() => send(t)} style={{ border: '1.5px solid var(--border)', background: 'var(--surface)', color: 'var(--text-secondary)', borderRadius: 16, padding: '6px 11px', fontSize: '0.74rem', fontWeight: 600, cursor: 'pointer' }}>{t}</button>)}
                  </div>
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                  <div style={{ maxWidth: '85%', padding: '8px 12px', borderRadius: 14, fontSize: '0.82rem', lineHeight: 1.45, whiteSpace: 'pre-wrap', background: m.role === 'user' ? '#059669' : 'var(--surface)', color: m.role === 'user' ? 'white' : m.err ? '#c53030' : 'var(--text-secondary)', border: m.role === 'user' ? 'none' : '1px solid var(--border)' }}>{m.text}</div>
                </div>
              ))}
              {busy && <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>Thinking…</div>}
              <div ref={end} />
            </div>
            <div style={{ padding: 10, display: 'flex', gap: 6, borderTop: '1px solid var(--border)' }}>
              <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} maxLength={600} placeholder="Type your question…"
                style={{ flex: 1, padding: '10px 12px', borderRadius: 12, border: '1.5px solid var(--border)', background: 'var(--surface)', color: 'var(--text-secondary)', fontSize: '0.85rem' }} />
              <button onClick={() => send()} disabled={busy || !text.trim()} style={{ border: 'none', borderRadius: 12, padding: '0 16px', background: busy || !text.trim() ? '#a0aec0' : '#059669', color: 'white', fontWeight: 800, cursor: 'pointer' }}>Send</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
