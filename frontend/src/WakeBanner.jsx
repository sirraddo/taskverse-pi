import { useState, useEffect } from 'react';

/** Shown when the server (free hosting) is slow to answer because it was asleep. Disappears by itself. */
export default function WakeBanner() {
  const [waking, setWaking] = useState(false);
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const h = (e) => setWaking(!!e.detail);
    window.addEventListener('tv-waking', h);
    return () => window.removeEventListener('tv-waking', h);
  }, []);
  useEffect(() => {
    if (!waking) return undefined;
    const t0 = Date.now();
    const id = setInterval(() => setSecs(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => { clearInterval(id); setSecs(0); };
  }, [waking]);
  if (!waking) return null;
  return (
    <div role="status" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, padding: '10px 14px', background: 'linear-gradient(135deg,#065F46,#047857)', color: 'white', fontSize: '0.8rem', fontWeight: 600, textAlign: 'center', boxShadow: '0 2px 10px rgba(0,0,0,0.25)' }}>
      ⏳ TaskVerse is waking up… this can take up to a minute{secs > 0 ? ` (${secs}s)` : ''}. Please wait, no need to refresh.
    </div>
  );
}
