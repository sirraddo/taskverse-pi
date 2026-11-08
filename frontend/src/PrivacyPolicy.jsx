import { PRIVACY_SECTIONS, LEGAL_UPDATED } from './legalContent';

export default function PrivacyPolicy({ onBack }) {
  return (
    <div style={{ maxWidth: '500px', margin: '0 auto', padding: '20px', fontFamily: 'sans-serif', lineHeight: 1.7, color: 'var(--text-secondary)' }}>
      <button onClick={onBack} style={{ marginBottom: '20px', background: 'none', border: '1px solid var(--border-strong)', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', color: 'var(--text-muted)' }}>← Back</button>
      <h1 style={{ fontSize: '1.4rem', color: 'var(--text)' }}>Privacy Policy</h1>
      <p style={{ color: 'var(--text-faint)', fontSize: '0.85rem' }}>Last updated: {LEGAL_UPDATED}</p>
      {PRIVACY_SECTIONS.map((s) => (
        <div key={s.title}>
          <h2 style={{ fontSize: '1rem', marginTop: '22px', color: 'var(--text)' }}>{s.title}</h2>
          {s.body.map((p, i) => <p key={i}>{p}</p>)}
          {s.list && <ul style={{ paddingLeft: '20px' }}>{s.list.map((li, i) => <li key={i}>{li}</li>)}</ul>}
        </div>
      ))}
    </div>
  );
}
