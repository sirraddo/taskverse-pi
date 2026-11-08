import { TERMS_SECTIONS, LEGAL_UPDATED } from './legalContent';

export default function TermsOfService({ onBack }) {
  return (
    <div style={{ maxWidth: '500px', margin: '0 auto', padding: '20px', fontFamily: 'sans-serif', lineHeight: 1.7, color: 'var(--text-secondary)' }}>
      <button onClick={onBack} style={{ marginBottom: '20px', background: 'none', border: '1px solid var(--border-strong)', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', color: 'var(--text-muted)' }}>← Back</button>
      <h1 style={{ fontSize: '1.4rem', color: 'var(--text)' }}>Terms of Service</h1>
      <p style={{ color: 'var(--text-faint)', fontSize: '0.85rem' }}>Last updated: {LEGAL_UPDATED}</p>
      {TERMS_SECTIONS.map((s) => (
        <div key={s.title}>
          <h2 style={{ fontSize: '1rem', marginTop: '22px', color: 'var(--text)' }}>{s.title}</h2>
          {s.body.map((p, i) => <p key={i}>{p}</p>)}
        </div>
      ))}
      <p style={{ marginTop: '30px', color: 'var(--text-faintest)', fontSize: '0.8rem' }}>TaskVerse Earn — built for the Pi Network</p>
    </div>
  );
}
