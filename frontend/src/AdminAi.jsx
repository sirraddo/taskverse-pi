import { useState, useEffect, useRef } from 'react';
import { fetchAiConfig, saveAiConfig, removeAiKey, aiAdminAsk, aiApplyProposal } from './piClient';

const PROMPTS = [
  'Give me a quick briefing: what needs my attention today?',
  'Any payout problems I should fix?',
  'Which tasks or workers get the most rejections this week?',
  'How many new workers joined this week?',
  'What are my open support tickets?',
  'Where do I change the platform fee?',
  'Show current settings and feature switches',
];
const card = { backgroundColor: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 14 };
const btn = { padding: '8px 12px', borderRadius: 9, border: '1.5px solid var(--border)', background: 'var(--surface)', color: '#059669', fontWeight: 700, fontSize: '0.76rem', cursor: 'pointer' };

export default function AdminAi({ notify, onNavigate }) {
  const [cfg, setCfg] = useState(null);
  const [keyIn, setKeyIn] = useState('');
  const [limit, setLimit] = useState('');
  const [msgs, setMsgs] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef(null);

  const load = () => fetchAiConfig().then((c) => { setCfg(c); setLimit(String(c.dailyLimit)); }).catch((e) => notify?.('⚠️ ' + e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy]);

  const save = (patch, ok) => saveAiConfig(patch).then(() => { notify?.(ok); setKeyIn(''); load(); }).catch((e) => notify?.('⚠️ ' + e.message));

  const ask = async (text) => {
    const question = (text ?? q).trim();
    if (!question || busy) return;
    const history = msgs.slice(-8).map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: 'user', text: question }]); setQ(''); setBusy(true);
    try {
      const r = await aiAdminAsk(question, history);
      setMsgs((m) => [...m, { role: 'assistant', text: r.reply, proposals: r.proposals || [], links: r.links || [] }]);
    } catch (e) { setMsgs((m) => [...m, { role: 'assistant', text: '⚠️ ' + e.message, err: true }]); }
    finally { setBusy(false); }
  };
  const apply = async (mi, pi) => {
    const p = msgs[mi].proposals[pi];
    try {
      const r = await aiApplyProposal(p);
      notify?.('✅ ' + r.message);
      setMsgs((all) => all.map((m, i) => (i === mi ? { ...m, proposals: m.proposals.map((x, j) => (j === pi ? { ...x, done: r.message } : x)) } : m)));
    } catch (e) { notify?.('⚠️ ' + e.message); }
  };

  const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--border)', fontSize: '0.82rem', color: 'var(--text-secondary)' };
  const sw = (label, key, on) => (
    <div style={row}><span>{label}: <b>{on ? 'ON' : 'OFF'}</b></span><button style={btn} onClick={() => save({ [key]: !on }, `${label} ${!on ? 'ON' : 'OFF'}`)}>{on ? 'Switch off' : 'Switch on'}</button></div>
  );

  return (
    <div>
      <div style={card}>
        <div style={{ fontWeight: 800, color: '#065F46', fontSize: '0.9rem', marginBottom: 4 }}>🤖 AI Assistant setup</div>
        <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', margin: '0 0 10px' }}>The AI only reads and suggests. It never approves, rejects, pays or bans by itself. Paste your Anthropic key below (it is stored encrypted and never shown again).</p>
        {cfg && (<>
          <div style={{ fontSize: '0.8rem', marginBottom: 8 }}>AI key: <b style={{ color: cfg.keyPresent ? '#16a34a' : '#dc2626' }}>{cfg.keyPresent ? `set ${cfg.keyHint} (${cfg.keySource === 'admin' ? 'saved here' : 'from Render'}, ${cfg.model})` : 'not set yet'}</b></div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="password" autoComplete="off" value={keyIn} onChange={(e) => setKeyIn(e.target.value)} placeholder={cfg.keyPresent ? 'Paste a new key to replace it' : 'Paste your Anthropic key (sk-ant-…)'}
              style={{ flex: 1, minWidth: 0, padding: 10, borderRadius: 9, border: '1.5px solid var(--border)', background: 'var(--surface)', color: 'var(--text-secondary)', fontSize: '0.8rem' }} />
            <button style={{ ...btn, background: '#059669', color: 'white', border: 'none' }} onClick={() => save({ apiKey: keyIn }, 'AI key saved')} disabled={!keyIn.trim()}>Save</button>
          </div>
          {cfg.keySource === 'admin' && <button onClick={() => removeAiKey().then(() => { notify?.('Key removed'); load(); })} style={{ background: 'none', border: 'none', color: '#dc2626', fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer', padding: 0, margin: '6px 0' }}>Remove saved key</button>}
          <div style={{ marginTop: 8 }}>
            {sw('Worker helper ("Ask" button)', 'customerEnabled', cfg.customerEnabled)}
            {sw('Automatic ticket sorting', 'triageEnabled', cfg.triageEnabled)}
            {sw('AI proof review in the queue', 'reviewEnabled', cfg.reviewEnabled)}
            <div style={row}>
              <span>Questions per worker per day</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <input value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" style={{ width: 60, padding: 8, borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--surface)', color: 'var(--text-secondary)' }} />
                <button style={btn} onClick={() => save({ dailyLimit: Number(limit) }, 'Limit saved')}>Save</button>
              </span>
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-faint)', marginTop: 4 }}>Today: {cfg.usageToday.messages} questions from {cfg.usageToday.workers} workers. 0 turns the helper off. Resets at midnight (Lagos).</div>
          </div>
        </>)}
      </div>

      <div style={card}>
        <div style={{ fontWeight: 800, color: '#065F46', fontSize: '0.9rem', marginBottom: 8 }}>💬 Ask about your business</div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8 }}>
          {PROMPTS.map((p) => <button key={p} onClick={() => ask(p)} style={{ ...btn, whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontWeight: 600 }}>{p}</button>)}
        </div>
        <div style={{ maxHeight: 420, overflowY: 'auto', marginBottom: 8 }}>
          {msgs.map((m, i) => (
            <div key={i} style={{ marginBottom: 8, textAlign: m.role === 'user' ? 'right' : 'left' }}>
              <div style={{ display: 'inline-block', maxWidth: '90%', textAlign: 'left', padding: '8px 12px', borderRadius: 12, fontSize: '0.8rem', lineHeight: 1.45, whiteSpace: 'pre-wrap', background: m.role === 'user' ? '#059669' : 'var(--surface-alt)', color: m.role === 'user' ? 'white' : m.err ? '#c53030' : 'var(--text-secondary)' }}>{m.text}</div>
              {(m.links || []).length > 0 && <div style={{ marginTop: 5, display: 'flex', gap: 6, flexWrap: 'wrap' }}>{m.links.map((l) => <button key={l.id} style={btn} onClick={() => onNavigate?.(l.id)}>📍 Open: {l.label}</button>)}</div>}
              {(m.proposals || []).map((p, j) => (
                <div key={j} style={{ marginTop: 6, border: '1.5px solid #f6ad55', background: '#fffaf0', borderRadius: 10, padding: 10, fontSize: '0.78rem', color: '#744210', textAlign: 'left' }}>
                  <b>Proposed:</b> {p.label}{p.type === 'setting' ? ` → ${p.value}` : ''}<div style={{ margin: '3px 0 6px' }}>{p.reason}</div>
                  {p.done ? <b style={{ color: '#276749' }}>✅ {p.done}</b> : <button style={{ ...btn, background: '#059669', color: 'white', border: 'none' }} onClick={() => apply(i, j)}>Apply</button>}
                </div>
              ))}
            </div>
          ))}
          {busy && <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>Looking at your data…</div>}
          <div ref={end} />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ask(); }} placeholder="Ask anything about TaskVerse…" maxLength={800}
            style={{ flex: 1, minWidth: 0, padding: 10, borderRadius: 9, border: '1.5px solid var(--border)', background: 'var(--surface)', color: 'var(--text-secondary)', fontSize: '0.82rem' }} />
          <button onClick={() => ask()} disabled={busy || !q.trim()} style={{ ...btn, background: busy || !q.trim() ? '#a0aec0' : '#059669', color: 'white', border: 'none' }}>Ask</button>
        </div>
      </div>
    </div>
  );
}
