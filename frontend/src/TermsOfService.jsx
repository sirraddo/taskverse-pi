export default function TermsOfService({ onBack }) {
  const sections = [
    { title: '1. Acceptance', body: 'By using TaskVerse Earn you agree to these Terms. If you do not agree, do not use the app.' },
    { title: '2. What TaskVerse Earn Does', body: 'TaskVerse Earn is a micro-task marketplace. Task posters escrow Pi to fund campaigns. Workers complete tasks and earn Pi. The platform charges a 5% fee on funded campaigns.' },
    { title: '3. Eligibility', body: 'You must be a registered Pi Network Pioneer to use this app. Access is provided through the Pi Browser only.' },
    { title: '4. Worker Rules', body: 'Submit honest proof of work. Do not submit recycled screenshots. Do not create multiple accounts to circumvent slot limits. Repeated fraudulent submissions may result in a ban.' },
    { title: '5. Task Poster Rules', body: 'Task descriptions must be truthful and achievable. Funded escrow is non-refundable once workers have been paid. You may not post tasks that require illegal, harmful, or deceptive actions.' },
    { title: '6. Payments', body: 'All payments are processed in Pi cryptocurrency via the Pi Network SDK. TaskVerse Earn does not hold fiat currency. Payouts depend on Pi Network availability and may be delayed during maintenance.' },
    { title: '7. Disputes', body: 'Rejected workers may appeal via the Dispute Appeals Board. Admin decisions are final. Disputes must be raised within 7 days of rejection.' },
    { title: '8. Prohibited Content', body: 'Tasks and proof submissions must not contain adult content, hate speech, spam, malware links, or content that violates Pi Network terms of service.' },
    { title: '9. Limitation of Liability', body: 'TaskVerse Earn is provided as-is. We are not responsible for losses arising from Pi Network downtime, wallet issues, or third-party service failures.' },
    { title: '10. Changes to Terms', body: 'We may update these Terms at any time. Continued use of the app after changes constitutes acceptance of the new Terms.' },
  ];

  return (
    <div style={{ maxWidth: '500px', margin: '0 auto', padding: '20px', fontFamily: 'sans-serif', lineHeight: 1.7, color: '#2d3748' }}>
      <button onClick={onBack} style={{ marginBottom: '20px', background: 'none', border: '1px solid #cbd5e0', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer' }}>Back</button>
      <h1 style={{ fontSize: '1.4rem', color: '#1a202c' }}>Terms of Service</h1>
      <p style={{ color: '#718096', fontSize: '0.85rem' }}>Last updated: June 2026</p>
      {sections.map((s, i) => (
        <div key={i}>
          <h2 style={{ fontSize: '1rem', marginTop: '20px' }}>{s.title}</h2>
          <p>{s.body}</p>
        </div>
      ))}
      <p style={{ marginTop: '30px', color: '#a0aec0', fontSize: '0.8rem' }}>TaskVerse Earn - Built on the Pi Network</p>
    </div>
  );
}
