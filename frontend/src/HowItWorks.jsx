import Logo from './Logo';

const STEPS = [
  { icon: '🔐', title: 'Sign In with Pi', desc: 'Open in Pi Browser and tap Authenticate. Your Pi username and KYC status are verified automatically.' },
  { icon: '📋', title: 'Browse Tasks', desc: 'See available micro-gigs posted by task creators. Each shows the reward in Pi, slots remaining, and what you need to do.' },
  { icon: '✅', title: 'Complete and Submit', desc: 'Do the task — follow, share, review, or create. Write a short proof and optionally attach a screenshot.' },
  { icon: '🤖', title: 'Auto-Review', desc: 'Our engine checks your submission instantly. Clean submissions are approved and paid automatically.' },
  { icon: '💰', title: 'Get Paid in Pi', desc: 'Pi lands in your TaskVerse wallet within seconds of approval. Post your own tasks to grow your Pi further.' },
];

const FAQS = [
  { q: 'Is TaskVerse Earn free to use?', a: 'Free for workers. Task posters pay a 5% platform fee on top of the reward pool when funding a campaign.' },
  { q: 'How fast are payouts?', a: 'Auto-approved submissions are paid within seconds. Manual-reviewed ones take up to 24 hours.' },
  { q: 'What if my submission is rejected?', a: 'You will see the rejection reason in your Profile. You can submit an appeal statement from the Open Appeals section.' },
  { q: 'How do I post my own task?', a: 'Tap “+ Post Task” on the main feed, fill in the title, description, reward per slot and number of slots, then fund via Pi Browser.' },
  { q: 'How do I track tasks I posted?', a: 'Tap “📌 My Tasks” at the bottom of the feed. You’ll see slot fill progress for each of your campaigns.' },
];

/**
 * Accepts either onClose (from PiLogin) or onBack (from App overlay screen).
 * Always prefer onClose if both are provided (PiLogin uses it for the CTA button label).
 */
export default function HowItWorks({ onClose, onBack }) {
  const dismiss = onClose || onBack || (() => {});

  return (
    <div style={{ maxWidth: '500px', margin: '0 auto', padding: '20px', fontFamily: 'sans-serif', lineHeight: 1.7, color: 'var(--text-secondary)', backgroundColor: 'var(--bg)', minHeight: '100vh' }}>

      {/* Back button — only shown when opened from the feed (onBack prop) */}
      {onBack && !onClose && (
        <button onClick={dismiss} style={{ marginBottom: '16px', background: 'var(--surface)', border: '1px solid var(--border-strong)', padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-muted)', fontWeight: '500', boxShadow: '0 1px 3px var(--shadow-color)' }}>
          ← Back
        </button>
      )}

      <div style={{ textAlign: 'center', padding: onBack && !onClose ? '10px 0 20px' : '30px 0 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
          <Logo size={72} />
        </div>
        <h1 style={{ fontSize: '1.6rem', color: 'var(--text)', margin: 0 }}>TaskVerse Earn</h1>
        <p style={{ color: '#059669', fontWeight: 'bold', margin: '6px 0 0' }}>Earn Pi. Anywhere. Anytime.</p>
        <p style={{ color: 'var(--text-faint)', fontSize: '0.9rem', marginTop: '10px' }}>
          The micro-task marketplace built for the Pi Network ecosystem.
        </p>
      </div>

      <h2 style={{ fontSize: '1rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', margin: '24px 0 12px' }}>How It Works</h2>
      {STEPS.map((step, i) => (
        <div key={i} style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', backgroundColor: 'var(--surface)', padding: '14px', borderRadius: '12px', marginBottom: '10px', boxShadow: '0 1px 6px var(--shadow-color)' }}>
          <div style={{ fontSize: '1.8rem', lineHeight: 1, flexShrink: 0 }}>{step.icon}</div>
          <div>
            <div style={{ fontWeight: '700', color: 'var(--text-secondary)', marginBottom: '4px' }}>{step.title}</div>
            <div style={{ color: 'var(--text-faint)', fontSize: '0.85rem', lineHeight: 1.5 }}>{step.desc}</div>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: '10px', margin: '24px 0', textAlign: 'center' }}>
        {[['⚡', 'Instant', 'Auto-payouts'], ['🔒', 'Secure', 'Pi SDK auth'], ['🌐', 'Global', 'All pioneers']].map(([icon, label, sub]) => (
          <div key={label} style={{ flex: 1, backgroundColor: 'var(--surface)', padding: '14px 8px', borderRadius: '12px', boxShadow: '0 1px 6px var(--shadow-color)' }}>
            <div style={{ fontSize: '1.4rem' }}>{icon}</div>
            <div style={{ fontWeight: '700', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{label}</div>
            <div style={{ color: 'var(--text-faintest)', fontSize: '0.75rem' }}>{sub}</div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: '1rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', margin: '24px 0 12px' }}>FAQ</h2>
      {FAQS.map((faq, i) => (
        <div key={i} style={{ backgroundColor: 'var(--surface)', padding: '14px', borderRadius: '12px', marginBottom: '10px', boxShadow: '0 1px 6px var(--shadow-color)' }}>
          <div style={{ fontWeight: '700', color: 'var(--text-secondary)', marginBottom: '6px' }}>{faq.q}</div>
          <div style={{ color: 'var(--text-faint)', fontSize: '0.85rem' }}>{faq.a}</div>
        </div>
      ))}

      <button onClick={dismiss}
        style={{ width: '100%', marginTop: '24px', padding: '14px', background: 'linear-gradient(135deg, #059669, #047857)', color: 'white', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: '700', cursor: 'pointer', boxShadow: '0 4px 14px rgba(5,150,105,0.4)' }}>
        {onClose ? 'Get Started — Earn Pi Now 🚀' : 'Got It ✔'}
      </button>
      <p style={{ textAlign: 'center', color: 'var(--text-faintest)', fontSize: '0.75rem', marginTop: '12px' }}>Available exclusively inside Pi Browser</p>
    </div>
  );
}
