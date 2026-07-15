/**
 * Full-app block shown to everyone except admins when the 'maintenance'
 * feature flag is turned on (Admin → Flags → Maintenance Mode). Admins
 * still see the normal app so they can flip the switch back off.
 */
export default function MaintenancePage() {
  return (
    <div style={{
      maxWidth: '500px', margin: '0 auto', minHeight: '100vh', backgroundColor: 'var(--bg)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '32px 24px', textAlign: 'center', fontFamily: 'sans-serif',
    }}>
      <div style={{ fontSize: '2.6rem', marginBottom: '14px' }}>🛠️</div>
      <h1 style={{ fontSize: '1.15rem', fontWeight: '800', color: 'var(--text)', margin: '0 0 8px' }}>
        Down for quick maintenance
      </h1>
      <p style={{ fontSize: '0.88rem', color: 'var(--text-faint)', lineHeight: 1.6, maxWidth: '340px', margin: '0 0 4px' }}>
        TaskVerse Earn is briefly offline while we make some changes. Your balance and progress are safe — nothing is lost.
      </p>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-faintest)', marginTop: '18px' }}>
        Please check back in a little while.
      </p>
    </div>
  );
}
