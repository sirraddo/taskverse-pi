import { useEffect, useState } from 'react';
import { loadProofImage } from './piClient';

/**
 * Renders a proof screenshot.
 *
 * Screenshots are stored on our own server and served from an auth-gated
 * endpoint, so a plain <img src="local:..."> cannot load them. This component
 * fetches the bytes with the session header and renders an object URL,
 * revoking it on unmount so we don't leak memory.
 *
 * Legacy submissions still hold a plain ImgBB URL; loadProofImage passes those
 * straight through, so old proofs keep displaying.
 */
export default function ProofImage({ src, maxHeight = 200 }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl = '';
    let cancelled = false;

    if (!src) return undefined;
    setFailed(false);
    setUrl('');

    loadProofImage(src)
      .then((u) => {
        if (cancelled) {
          if (u && u.startsWith('blob:')) URL.revokeObjectURL(u);
          return;
        }
        objectUrl = u;
        setUrl(u);
      })
      .catch(() => { if (!cancelled) setFailed(true); });

    return () => {
      cancelled = true;
      if (objectUrl && objectUrl.startsWith('blob:')) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (!src) return null;
  if (src === 'expired') {
    return (
      <div style={{ fontSize: '0.72rem', color: '#a0aec0', fontStyle: 'italic' }}>
        (screenshot removed — submission settled beyond the retention window)
      </div>
    );
  }
  if (failed) {
    return (
      <div style={{ fontSize: '0.72rem', color: '#a0aec0', fontStyle: 'italic' }}>
        (screenshot unavailable)
      </div>
    );
  }
  if (!url) {
    return (
      <div style={{ fontSize: '0.72rem', color: '#a0aec0' }}>Loading screenshot…</div>
    );
  }
  return (
    <div>
      <img
        src={url}
        alt="Proof screenshot"
        style={{
          maxWidth: '100%', borderRadius: '8px', border: '1px solid #e2e8f0',
          display: 'block', maxHeight: `${maxHeight}px`, objectFit: 'contain',
        }}
        onError={() => setFailed(true)}
      />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ fontSize: '0.75rem', color: '#059669', display: 'inline-block', marginTop: '4px' }}
      >
        Open full image ↗
      </a>
    </div>
  );
}
