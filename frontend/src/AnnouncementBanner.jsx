import { useEffect, useState } from 'react';
import { fetchAnnouncement, dismissAnnouncement, openExternalLink } from './piClient';

// Visual treatment per level. Kept in the app's emerald/navy palette —
// no Pi purple (see Pi trademark guidelines).
const STYLES = {
  info: { bg: '#ECFDF5', border: '#A7F3D0', title: '#065F46', icon: '📢' },
  warning: { bg: '#FFFBEB', border: '#FDE68A', title: '#92400E', icon: '⚠️' },
  success: { bg: '#ECFDF5', border: '#6EE7B7', title: '#065F46', icon: '✅' },
};

/**
 * Shows the current admin announcement, if there is one and the user hasn't
 * dismissed it. Silent when there's nothing to say — never takes up space
 * unnecessarily, and never blocks the app if the request fails.
 */
export default function AnnouncementBanner() {
  const [ann, setAnn] = useState(null);
  const [hiding, setHiding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAnnouncement()
      .then((r) => { if (!cancelled) setAnn(r?.announcement || null); })
      .catch(() => { /* never break the feed over an announcement */ });
    return () => { cancelled = true; };
  }, []);

  if (!ann || hiding) return null;
  const s = STYLES[ann.level] || STYLES.info;

  const hide = async () => {
    setHiding(true);
    try { await dismissAnnouncement(ann.id); } catch { /* non-fatal */ }
  };

  return (
    <div style={{
      backgroundColor: s.bg, border: `1.5px solid ${s.border}`, borderRadius: '12px',
      padding: '12px 14px', marginBottom: '12px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
        <div style={{ fontWeight: '800', color: s.title, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>{s.icon}</span>
          <span>{ann.title}</span>
        </div>
        <button
          onClick={hide}
          aria-label="Dismiss"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: s.title, opacity: 0.55, fontSize: '0.95rem', lineHeight: 1, padding: 0, flexShrink: 0 }}
        >
          ✕
        </button>
      </div>

      <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: '#374151', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
        {ann.body}
      </p>

      {ann.linkUrl && (
        <button
          onClick={() => openExternalLink(ann.linkUrl)}
          style={{
            marginTop: '9px', backgroundColor: '#059669', color: 'white', border: 'none',
            padding: '8px 14px', borderRadius: '9px', fontWeight: '700', fontSize: '0.78rem',
            cursor: 'pointer',
          }}
        >
          {ann.linkLabel || 'Learn more'} →
        </button>
      )}
    </div>
  );
}
