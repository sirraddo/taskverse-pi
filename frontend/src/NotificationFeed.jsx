import { useState, useEffect, useCallback } from 'react';
import { fetchNotifications, markNotificationRead, markAllNotificationsRead } from './piClient';

const TYPE_ICON = {
  submission_approved: '✅',
  submission_rejected: '❌',
  support_reply: '🎧',
};

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function NotificationFeed({ onBack, onRefresh }) {
  const [notes, setNotes] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await fetchNotifications();
      setNotes(r.notifications || []);
    } catch (e) {
      setError(e.message || 'Could not load notifications');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNote = async (note) => {
    if (!note.read) {
      setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, read: true } : n)));
      try { await markNotificationRead(note.id); onRefresh?.(); } catch { /* non-fatal */ }
    }
  };

  const markAllRead = async () => {
    setNotes((prev) => prev?.map((n) => ({ ...n, read: true })));
    try { await markAllNotificationsRead(); onRefresh?.(); } catch { /* non-fatal */ }
  };

  const hasUnread = notes?.some((n) => !n.read);

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '500px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <button onClick={onBack} style={{ background: 'var(--surface)', border: '1px solid var(--border-strong)', padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-muted)', fontWeight: '500', boxShadow: '0 1px 3px var(--shadow-color)' }}>← Back</button>
        <h2 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--text)', flex: 1 }}>🔔 Notifications</h2>
        {hasUnread && (
          <button onClick={markAllRead} style={{ background: 'none', border: 'none', color: '#059669', fontWeight: '700', fontSize: '0.76rem', cursor: 'pointer' }}>
            Mark all read
          </button>
        )}
      </div>

      {error && <div style={{ color: '#c53030', fontSize: '0.82rem', marginBottom: '10px' }}>⚠️ {error}</div>}

      {notes === null ? (
        <div style={{ fontSize: '0.82rem', color: 'var(--text-faintest)' }}>Loading…</div>
      ) : notes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-faintest)' }}>
          <div style={{ fontSize: '2.4rem', marginBottom: '8px' }}>🔔</div>
          <p>Nothing yet — you'll see approvals, rejections, and support replies here.</p>
        </div>
      ) : notes.map((n) => (
        <div key={n.id} onClick={() => openNote(n)}
          style={{
            display: 'flex', gap: '10px', alignItems: 'flex-start',
            backgroundColor: n.read ? 'var(--surface)' : '#f0fff4',
            border: n.read ? '1px solid var(--border)' : '1px solid #c6f6d5',
            borderRadius: '12px', padding: '12px 14px', marginBottom: '8px', cursor: 'pointer',
          }}>
          <div style={{ fontSize: '1.2rem', flexShrink: 0 }}>{TYPE_ICON[n.type] || '🔔'}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontWeight: '700', color: n.read ? 'var(--text-secondary)' : '#276749', fontSize: '0.86rem' }}>{n.title}</span>
              {!n.read && <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#059669', flexShrink: 0 }} />}
            </div>
            {n.body && <div style={{ fontSize: '0.78rem', color: n.read ? 'var(--text-faint)' : '#4b6357', marginTop: '3px' }}>{n.body}</div>}
            <div style={{ fontSize: '0.68rem', color: n.read ? 'var(--text-faintest)' : '#6b8577', marginTop: '4px' }}>{timeAgo(n.createdAt)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
