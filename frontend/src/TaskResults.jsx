import { useEffect, useState } from 'react';
import { fetchTaskResults } from './piClient';

// What workers answered on a poster's quiz, survey or written task.
export default function TaskResults({ task, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { fetchTaskResults(task.id).then(setData).catch((e) => setError(e.message || 'Could not load the answers.')); }, [task.id]);

  return (
    <div role="dialog" aria-modal="true" onClick={onClose} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: 'var(--surface)', width: '100%', maxWidth: '500px', maxHeight: '85vh', overflowY: 'auto', borderRadius: '16px 16px 0 0', padding: '18px 18px 26px', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <h3 style={{ margin: 0, fontSize: '0.98rem', color: 'var(--text)' }}>Answers: {task.title}</h3>
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'none', fontSize: '1.3rem', color: 'var(--text-faint)', cursor: 'pointer' }}>×</button>
        </div>
        {error && <p style={{ color: '#c53030', fontSize: '0.84rem' }}>{error}</p>}
        {!data && !error && <p style={{ color: 'var(--text-faint)', fontSize: '0.84rem' }}>Loading…</p>}
        {data && (
          <>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-faint)', margin: '0 0 12px' }}>
              {data.responses} {data.responses === 1 ? 'answer' : 'answers'} counted
              {data.kind === 'quiz' && data.attempts > data.responses ? ` · ${data.attempts - data.responses} failed the quiz` : ''}
            </p>
            {data.questions?.map((q, i) => {
              const total = q.options.reduce((n, o) => n + o.count, 0) || 1;
              return (
                <div key={i} style={{ marginBottom: '14px' }}>
                  <div style={{ fontSize: '0.86rem', fontWeight: '700', color: 'var(--text)', marginBottom: '6px' }}>{i + 1}. {q.q}</div>
                  {q.options.map((o, k) => {
                    const pct = Math.round((o.count / total) * 100);
                    return (
                      <div key={k} style={{ marginBottom: '6px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                          <span>{o.text}{o.right ? ' ✓' : ''}</span><span>{o.count} · {pct}%</span>
                        </div>
                        <div style={{ height: '6px', backgroundColor: 'var(--surface-alt)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: pct + '%', backgroundColor: o.right ? '#047857' : '#059669', opacity: o.right ? 1 : 0.75 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {data.answers?.map((a, i) => (
              <div key={i} style={{ borderTop: '1px solid var(--border)', padding: '8px 0', fontSize: '0.84rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{a.text}</div>
            ))}
            {data.responses === 0 && <p style={{ fontSize: '0.84rem', color: 'var(--text-faint)' }}>No answers yet.</p>}
          </>
        )}
      </div>
    </div>
  );
}
