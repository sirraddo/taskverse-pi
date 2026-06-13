import { useState } from 'react';
import HowItWorks from './HowItWorks';
import PrivacyPolicy from './PrivacyPolicy';
import TermsOfService from './TermsOfService';
import { authenticateWithPi } from './piClient';

/**
 * PRODUCTION VERSION — replaces the setTimeout mock.
 * The orange button now performs the real Pi Browser handshake and the
 * profile it passes up comes from the backend's /v2/me verification,
 * never from the client.
 */
export default function PiLogin({ onLoginSuccess }) {
  const [showHow, setShowHow] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handlePiAuth = async () => {
    setLoading(true);
    setError(null);
    try {
      const user = await authenticateWithPi();
      onLoginSuccess(user); // { username, balance, isKycVerified, isAdmin }
    } catch (err) {
      setError(
        err.message?.includes('Pi SDK not loaded')
          ? 'Please open TaskVerse inside the Pi Browser to sign in.'
          : err.message || 'Authentication failed. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '40px 20px', fontFamily: 'sans-serif', backgroundColor: 'white', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.08)', textAlign: 'center', margin: '40px 15px' }}>
      <div style={{ width: '80px', height: '80px', backgroundColor: '#ffa500', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px auto' }}>
        <span style={{ fontSize: '2.5rem', color: 'white', fontWeight: 'bold' }}>π</span>
      </div>
      <h2>Welcome to TaskVerse</h2>
      {error && (
        <p style={{ color: '#c53030', backgroundColor: '#fff5f5', padding: '10px', borderRadius: '8px', fontSize: '0.9rem' }}>
          {error}
        </p>
      )}
      <button onClick={handlePiAuth} disabled={loading} style={{ width: '100%', backgroundColor: '#ffa500', color: 'white', border: 'none', padding: '14px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', opacity: loading ? 0.7 : 1 }}>
        {loading ? 'Connecting to Pi…' : 'Authenticate with Pi Browser'}
      </button>
    
      {/* How It Works overlay */}
      {showHow      && <div style={{ position:'fixed', inset:0, backgroundColor:'#f9f9f9', zIndex:300, overflowY:'auto' }}><HowItWorks onClose={() => setShowHow(false)} /></div>}
      {showPrivacy  && <div style={{ position:'fixed', inset:0, backgroundColor:'white', zIndex:300, overflowY:'auto' }}><PrivacyPolicy onBack={() => setShowPrivacy(false)} /></div>}
      {showTerms    && <div style={{ position:'fixed', inset:0, backgroundColor:'white', zIndex:300, overflowY:'auto' }}><TermsOfService onBack={() => setShowTerms(false)} /></div>}

      {/* Legal footer — bottom of login card */}
      <div style={{ textAlign: 'center', padding: '16px 20px', fontSize: '0.75rem', color: '#a0aec0' }}>
        <button onClick={() => setShowHow(true)} style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '8px', display: 'block', width: '100%' }}>
          How does TaskVerse Pi work? ➜
        </button>
        By continuing you agree to our{' '}
        <button onClick={() => setShowTerms(true)} style={{ background:'none', border:'none', color:'#667eea', cursor:'pointer', padding:0, fontSize:'0.75rem' }}>Terms</button>
        {' '}and{' '}
        <button onClick={() => setShowPrivacy(true)} style={{ background:'none', border:'none', color:'#667eea', cursor:'pointer', padding:0, fontSize:'0.75rem' }}>Privacy Policy</button>
      </div>
</div>
  );
}
