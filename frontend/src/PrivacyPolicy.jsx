export default function PrivacyPolicy({ onBack }) {
  return (
    <div style={{ maxWidth: '500px', margin: '0 auto', padding: '20px', fontFamily: 'sans-serif', lineHeight: 1.7, color: 'var(--text-secondary)' }}>
      <button onClick={onBack} style={{ marginBottom: '20px', background: 'none', border: '1px solid var(--border-strong)', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', color: 'var(--text-muted)' }}>← Back</button>
      <h1 style={{ fontSize: '1.4rem', color: 'var(--text)' }}>Privacy Policy</h1>
      <p style={{ color: 'var(--text-faint)', fontSize: '0.85rem' }}>Last updated: June 2026</p>

      <h2 style={{ fontSize: '1rem', marginTop: '24px', color: 'var(--text)' }}>1. Who We Are</h2>
      <p>TaskVerse Earn is a decentralised micro-task marketplace that runs inside the Pi Browser. We connect task posters with workers who earn Pi cryptocurrency for completing small jobs.</p>

      <h2 style={{ fontSize: '1rem', marginTop: '20px', color: 'var(--text)' }}>2. Data We Collect</h2>
      <p>We collect only what is necessary to operate the platform:</p>
      <ul style={{ paddingLeft: '20px' }}>
        <li><strong>Pi username</strong> — provided by the Pi Network SDK on login. We never see your password.</li>
        <li><strong>KYC status</strong> — a true/false flag from the Pi SDK. We do not store your identity documents.</li>
        <li><strong>Proof submissions</strong> — text descriptions and optional screenshot URLs you submit when completing tasks.</li>
        <li><strong>Transaction records</strong> — Pi payment identifiers required for payout processing and dispute resolution.</li>
      </ul>

      <h2 style={{ fontSize: '1rem', marginTop: '20px', color: 'var(--text)' }}>3. How We Use Your Data</h2>
      <ul style={{ paddingLeft: '20px' }}>
        <li>To authenticate you via the Pi Network SDK</li>
        <li>To process task payouts through Pi's A2U (App-to-User) payment system</li>
        <li>To detect fraud (duplicate images, repeated submissions)</li>
        <li>To display your earnings history and reputation score</li>
      </ul>

      <h2 style={{ fontSize: '1rem', marginTop: '20px', color: 'var(--text)' }}>4. Data Sharing</h2>
      <p>We <strong>never sell</strong> your data. We share only:</p>
      <ul style={{ paddingLeft: '20px' }}>
        <li>With <strong>Pi Network</strong> — payment processing requires sharing transaction data with Pi's servers as required by the SDK.</li>
        <li>With <strong>ImgBB</strong> — if you upload a screenshot, it is stored on ImgBB's servers under their privacy policy.</li>
      </ul>

      <h2 style={{ fontSize: '1rem', marginTop: '20px', color: 'var(--text)' }}>5. Data Retention</h2>
      <p>Submission records and transaction logs are kept for 12 months to support disputes and audits, then deleted. You may request deletion of your account data at any time by contacting us.</p>

      <h2 style={{ fontSize: '1rem', marginTop: '20px', color: 'var(--text)' }}>6. Your Rights</h2>
      <p>You have the right to access, correct, or delete your personal data. To exercise these rights, contact us through the Pi Network community channels.</p>

      <h2 style={{ fontSize: '1rem', marginTop: '20px', color: 'var(--text)' }}>7. Security</h2>
      <p>All data is transmitted over HTTPS. Sensitive fields are stored encrypted. We use JWT authentication with short expiry windows.</p>

      <h2 style={{ fontSize: '1rem', marginTop: '20px', color: 'var(--text)' }}>8. Changes</h2>
      <p>We will notify users of material changes to this policy via an in-app notification. Continued use of TaskVerse Earn after changes constitutes acceptance.</p>

      <p style={{ marginTop: '30px', color: 'var(--text-faintest)', fontSize: '0.8rem' }}>TaskVerse Earn — Built on the Pi Network</p>
    </div>
  );
        }
