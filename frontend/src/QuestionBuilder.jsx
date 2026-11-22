// Task type picker + question editor, used when posting a task (and for admin
// sponsored tasks). Quiz / survey / written tasks are done inside TaskVerse,
// so workers never leave Pi Browser.
import { TASK_TYPES, emptyQuestion } from './questionHelpers';

const box = { width: '100%', padding: '9px 11px', boxSizing: 'border-box', borderRadius: '8px', border: '1.5px solid var(--border)', fontSize: '0.84rem', color: 'var(--text-secondary)', backgroundColor: 'var(--surface)', outline: 'none', fontFamily: 'sans-serif' };
const small = { fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-faint)', display: 'block', marginBottom: '4px' };
const chip = (on) => ({ padding: '8px 6px', borderRadius: '10px', border: on ? '2px solid #059669' : '1.5px solid var(--border)', backgroundColor: on ? 'rgba(5,150,105,0.08)' : 'var(--surface)', color: on ? '#047857' : 'var(--text-muted)', fontWeight: '700', fontSize: '0.78rem', cursor: 'pointer', textAlign: 'center' });

export default function QuestionBuilder({ kind, setKind, questions, setQuestions }) {
  const type = TASK_TYPES.find((t) => t.kind === kind) || TASK_TYPES[0];
  const setQ = (i, patch) => setQuestions(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const setOpt = (i, k, v) => setQ(i, { options: questions[i].options.map((o, j) => (j === k ? v : o)) });
  const addOpt = (i) => questions[i].options.length < 6 && setQ(i, { options: [...questions[i].options, ''] });
  const dropOpt = (i, k) => {
    const q = questions[i];
    if (q.options.length <= 2) return;
    const options = q.options.filter((_, j) => j !== k);
    setQ(i, { options, answer: q.answer === k ? 0 : q.answer > k ? q.answer - 1 : q.answer });
  };

  return (
    <div style={{ marginBottom: '12px' }}>
      <label style={small}>TASK TYPE</label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
        {TASK_TYPES.map((t) => (
          <button type="button" key={t.kind} onClick={() => { setKind(t.kind); if ((t.kind === 'quiz' || t.kind === 'survey') && questions.length === 0) setQuestions([emptyQuestion()]); }} style={chip(kind === t.kind)}>
            <div style={{ fontSize: '1.1rem' }}>{t.icon}</div>{t.label}
          </button>
        ))}
      </div>
      <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', margin: '6px 0 0', lineHeight: 1.4 }}>{type.help}</p>

      {(kind === 'quiz' || kind === 'survey') && (
        <div style={{ marginTop: '10px' }}>
          {questions.map((q, i) => (
            <div key={i} style={{ border: '1px solid var(--border)', borderRadius: '10px', padding: '10px', marginBottom: '8px', backgroundColor: 'var(--surface-alt)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={small}>QUESTION {i + 1}</span>
                {questions.length > 1 && <button type="button" onClick={() => setQuestions(questions.filter((_, j) => j !== i))} style={{ border: 'none', background: 'none', color: '#c53030', fontSize: '0.74rem', fontWeight: '700', cursor: 'pointer' }}>Remove</button>}
              </div>
              <input value={q.q} onChange={(e) => setQ(i, { q: e.target.value })} maxLength={300} placeholder={kind === 'quiz' ? 'e.g. What is the capital of Nigeria?' : 'e.g. How often do you pay bills with Pi?'} style={{ ...box, marginBottom: '6px' }} />
              {q.options.map((o, k) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px' }}>
                  {kind === 'quiz' && (
                    <input type="radio" name={`ans-${i}`} checked={q.answer === k} onChange={() => setQ(i, { answer: k })} title="The right answer" style={{ width: '18px', height: '18px', accentColor: '#059669', flex: 'none' }} />
                  )}
                  <input value={o} onChange={(e) => setOpt(i, k, e.target.value)} maxLength={120} placeholder={`Choice ${k + 1}`} style={{ ...box, flex: 1 }} />
                  {q.options.length > 2 && <button type="button" onClick={() => dropOpt(i, k)} aria-label="Remove choice" style={{ border: 'none', background: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: '1rem' }}>×</button>}
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {q.options.length < 6 ? <button type="button" onClick={() => addOpt(i)} style={{ border: 'none', background: 'none', color: '#047857', fontWeight: '700', fontSize: '0.76rem', cursor: 'pointer', padding: 0 }}>+ Add choice</button> : <span />}
                {kind === 'quiz' && <span style={{ fontSize: '0.68rem', color: 'var(--text-faint)' }}>Tick the right answer</span>}
              </div>
            </div>
          ))}
          {questions.length < 10 && (
            <button type="button" onClick={() => setQuestions([...questions, emptyQuestion()])} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1.5px dashed var(--border-strong)', background: 'var(--surface)', color: '#047857', fontWeight: '700', fontSize: '0.8rem', cursor: 'pointer' }}>+ Add question</button>
          )}
        </div>
      )}
    </div>
  );
}
