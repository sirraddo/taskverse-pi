const STEPS = [
  { icon: '🔐', title: 'Sign In with Pi', desc: 'Open in Pi Browser and tap Authenticate. Your Pi username and KYC status are verified automatically.' },
  { icon: '📋', title: 'Browse Tasks', desc: 'See available micro-gigs posted by task creators. Each shows the reward in Pi, slots remaining, and what you need to do.' },
  { icon: '✅', title: 'Complete and Submit', desc: 'Do the task — follow, share, review, or create. Write a short proof and optionally attach a screenshot.' },
  { icon: '🤖', title: 'Auto-Review', desc: 'Our engine checks your submission instantly. Clean submissions are approved and paid automatically.' },
  { icon: '💰', title: 'Get Paid in Pi', desc: 'Pi lands in your TaskVerse wallet within seconds of approval. Post your own tasks to grow your Pi further.' },
];

const FAQS = [
  { q: 'Is TaskVerse Pi free to use?', a: 'Free for workers. Task posters pay a 5% platform fee on top of the reward pool when funding a campaign.' },
  { q: 'How fast are payouts?', a: 'Auto-approved submissions are paid within seconds. Manual-reviewed ones take up to 24 hours.' },
  { q: 'What if my submission is rejected?', a: 'You will see the rejection reason. You can appeal via the Dispute Board within 7 days.' },
  { q: 'How do I post my own task?', a: 'Tap "+ Post Task" on the main feed, fill in the details, reward per slot and number of slots, then fund via Pi Browser.' },
];

export default function HowItWorks({ onClose }) {
  return (
    <div style={{ maxWidth: '500px', margin: '0 auto', padding: '20px', fontFamily: 'sans-serif', backgroundColor: '#f9f9f9', minHeight: '100vh' }}>
      <div style={{ textAlign: 'center', padding: '30px 0 20px' }}>
        <div style={{ fontSize: '3rem', marginBottom: '10px' }}>🌍</div>
        <h1 style={{ fontSize: '1.6rem', color: '#1a202c', margin: 0 }}>TaskVerse Pi</h1>
        <p style={{ color: '#667eea', fontWeight: 'bold', margin: '6px 0 0' }}>Earn Pi. Anywhere. Anytime.</p>
        <p style={{ color: '#718096', fontSize: '0.9rem', marginTop: '10px' }}>
          The micro-task marketplace built for the Pi Network ecosystem.
        </p>
      </div>

      <h2 style={{ fontSize: '1rem', color: '#4a5568', textTransform: 'uppercase', letterSpacing: '1px', margin: '24px 0 12px' }}>How It Works</h2>
      {STEPS.map((step, i) => (
        <div key={i} style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', backgroundColor: 'white', padding: '14px', borderRadius: '10px', marginBottom: '10px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: '1.8rem', lineHeight: 1 }}>{step.icon}</div>
          <div>
            <div style={{ fontWeight: 'bold', color: '#2d3748', marginBottom: '4px' }}>{step.title}</div>
            <div style={{ color: '#718096', fontSize: '0.85rem' }}>{step.desc}</div>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: '10px', margin: '24px 0', textAlign: 'center' }}>
        {[['⚡', 'Instant', 'Auto-payouts'], ['🔒', 'Secure', 'Pi SDK auth'], ['🌐', 'Global', 'All pioneers']].map(([icon, label, sub]) => (
          <div key={label} style={{ flex: 1, backgroundColor: 'white', padding: '14px 8px', borderRadius: '10px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: '1.4rem' }}>{icon}</div>
            <div style={{ fontWeight: 'bold', color: '#2d3748', fontSize: '0.9rem' }}>{label}</div>
            <div style={{ color: '#a0aec0', fontSize: '0.75rem' }}>{sub}</div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: '1rem', color: '#4a5568', textTransform: 'uppercase', letterSpacing: '1px', margin: '24px 0 12px' }}>FAQ</h2>
      {FAQS.map((faq, i) => (
        <div key={i} style={{ backgroundColor: 'white', padding: '14px', borderRadius: '10px', marginBottom: '10px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontWeight: 'bold', color: '#2d3748', marginBottom: '6px' }}>{faq.q}</div>
          <div style={{ color: '#718096', fontSize: '0.85rem' }}>{faq.a}</div>
        </div>
      ))}

      <button onClick={onClose} style={{ width: '100%', marginTop: '24px', padding: '14px', background: 'linear-gradient(135deg, #667eea, #764ba2)', color: 'white', border: 'none', borderRadius: '10px', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer' }}>
        Get Started - Earn Pi Now 🚀
      </button>
      <p style={{ textAlign: 'center', color: '#a0aec0', fontSize: '0.75rem', marginTop: '12px' }}>Available exclusively inside Pi Browser</p>
    </div>
  );
        }
