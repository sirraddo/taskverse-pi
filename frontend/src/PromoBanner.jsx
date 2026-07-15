import { useEffect, useState } from 'react';
import { fetchBanners, openExternalLink } from './piClient';

/**
 * Home-feed promo carousel — shows admin-posted banners (e.g. cross-promoting
 * Zappi NG). Silent when there's nothing to show, and never blocks the app
 * if the request fails. Simple dot-paged carousel, no auto-advance timer
 * (keeps it predictable and avoids layout jumps while a user is reading).
 */
export default function PromoBanner() {
  const [banners, setBanners] = useState([]);
  const [i, setI] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchBanners()
      .then((r) => { if (!cancelled) setBanners(r?.banners || []); })
      .catch(() => { /* never break the feed over a banner */ });
    return () => { cancelled = true; };
  }, []);

  if (banners.length === 0) return null;
  const b = banners[Math.min(i, banners.length - 1)];

  return (
    <div style={{ marginBottom: '14px' }}>
      <button
        onClick={() => openExternalLink(b.linkUrl)}
        style={{
          display: 'block', width: '100%', padding: 0, border: 'none', borderRadius: '14px',
          overflow: 'hidden', cursor: 'pointer', position: 'relative', lineHeight: 0,
        }}
      >
        <img src={b.image} alt="" style={{ width: '100%', display: 'block', aspectRatio: '16/7', objectFit: 'cover' }} />
        {b.linkLabel && (
          <span style={{
            position: 'absolute', bottom: '10px', right: '10px', backgroundColor: 'rgba(15,23,42,0.78)',
            color: 'white', fontSize: '0.72rem', fontWeight: '700', padding: '6px 12px', borderRadius: '20px',
          }}>
            {b.linkLabel} →
          </span>
        )}
      </button>

      {banners.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '5px', marginTop: '7px' }}>
          {banners.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setI(idx)}
              aria-label={`Show banner ${idx + 1}`}
              style={{
                width: idx === i ? '16px' : '6px', height: '6px', borderRadius: '3px', border: 'none',
                backgroundColor: idx === i ? '#059669' : 'var(--border-strong)', cursor: 'pointer', padding: 0,
                transition: 'width 0.15s ease',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
