import { useState, useEffect, useCallback } from 'react';
import {
  fetchAdminAnnouncements, createAnnouncement,
  setAnnouncementActive, deleteAnnouncement,
} from './piClient';

const LEVELS = [
  { key: 'info', label: '📢 Info', hint: 'General news' },
  { key: 'warning', label: '⚠️ Warning', hint: 'Delays, issues' },
  { key: 'success', label: '✅ Good news', hint: 'Fixed, launched' },
];

/**
 * Admin: post an announcement to all users without a code deploy.
 * Only one announcement is live at a time — publishing a new one automatically
 * takes the previous one down, so users never see a stack of banners.
 */
export default function AdminAnnouncements({ notify }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [level, setLevel] = useState('info');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchAdminAnnouncements();
      setList(r.announcements || []);
    } catch (e) {
      setErr(e.message || 'Could not load announcements');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const publish = async () => {
    setErr('');
    if (!title.trim() || !body.trim()) { setErr('Title and message are required.'); return; }
    setBusy(true);
    try {
      await createAnnouncement({
        title: title.trim(), body: body.trim(), level,
        linkUrl: linkUrl.trim(), linkLabel: linkLabel.trim(),
      });
      setTitle(''); setBody(''); setLinkUrl(''); setLinkLabel(''); setLevel('info');
      notify?.('📢 Announcement published');
      await load();
    } catch (e) {
      setErr(e.message || 'Could not publish');
    } finally { setBusy(false); }
  };

  const toggle = async (a) => {
    setBusy(true);
    try { await setAnnouncementActive(a.id, !a.active); await load(); }
    catch (e) { setErr(e.message || 'Failed'); }
    finally { setBusy(false); }
  };

  const remove = async (a) => {
    setBusy(true);
    try { await deleteAnnouncement(a.id); await load(); }
    catch (e) { setErr(e.message || 'Failed'); }
    finally { setBusy(false); }
  };

  const inputStyle = {
    width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: '9px',
    border: '1.5px solid var(--border)', fontSize: '0.84rem', color: 'var(--text-secondary)',
    outline: 'none', backgroundColor: 'var(--surface)', fontFamily: 'inherit',
  };

  return (
    <div style={{ backgroundColor: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: '12px', padding: '14px', marginBottom: '14px' }}>
      <div style={{ fontWeight: '800', color: '#065F46', fontSize: '0.9rem', marginBottom: '3px' }}>
        📢 Announcements
      </div>
      <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', margin: '0 0 12px' }}>
        Post a message to all users. Only one is live at a time — publishing a new one replaces the current one.
      </p>

      {/* Compose */}
      <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80}
        placeholder="Title (e.g. Payouts delayed today)" style={{ ...inputStyle, marginBottom: '8px' }} />

      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={600}
        placeholder="Message to your users…"
        style={{ ...inputStyle, marginBottom: '4px', resize: 'vertical', lineHeight: 1.5 }} />
      <div style={{ fontSize: '0.65rem', color: 'var(--text-faintest)', textAlign: 'right', marginBottom: '8px' }}>
        {body.length}/600
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
        {LEVELS.map((l) => (
          <button key={l.key} onClick={() => setLevel(l.key)} title={l.hint}
            style={{
              flex: 1, minWidth: '90px', padding: '7px 8px', borderRadius: '9px', cursor: 'pointer',
              fontSize: '0.75rem', fontWeight: '700',
              border: level === l.key ? '2px solid #059669' : '1.5px solid var(--border)',
              backgroundColor: level === l.key ? '#ECFDF5' : 'var(--surface)',
              color: level === l.key ? '#065F46' : 'var(--text-faint)',
            }}>
            {l.label}
          </button>
        ))}
      </div>

      {/* Optional CTA — e.g. link to your other app */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
        <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="Link (optional) https://…" style={{ ...inputStyle, flex: 2 }} />
        <input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} maxLength={40}
          placeholder="Button text" style={{ ...inputStyle, flex: 1 }} />
      </div>

      {err && (
        <div style={{ fontSize: '0.75rem', color: '#c53030', backgroundColor: '#fff5f5', padding: '7px 10px', borderRadius: '8px', marginBottom: '8px' }}>
          ⚠️ {err}
        </div>
      )}

      <button onClick={publish} disabled={busy || !title.trim() || !body.trim()}
        style={{
          width: '100%', padding: '10px', borderRadius: '10px', border: 'none',
          backgroundColor: (busy || !title.trim() || !body.trim()) ? '#a0aec0' : '#059669',
          color: 'white', fontWeight: '800', fontSize: '0.85rem',
          cursor: (busy || !title.trim() || !body.trim()) ? 'not-allowed' : 'pointer',
        }}>
        {busy ? 'Publishing…' : 'Publish to all users'}
      </button>

      {/* History */}
      <div style={{ marginTop: '14px', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
        <div style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-faint)', marginBottom: '7px' }}>
          RECENT
        </div>
        {loading ? (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-faintest)' }}>Loading…</div>
        ) : list.length === 0 ? (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-faintest)' }}>None yet.</div>
        ) : list.map((a) => (
          <div key={a.id} style={{
            border: '1px solid var(--border)', borderRadius: '9px', padding: '9px 10px', marginBottom: '6px',
            backgroundColor: a.active ? '#f0fff4' : 'var(--surface-alt)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-secondary)', wordBreak: 'break-word' }}>
                  {a.active && <span style={{ color: '#059669' }}>● </span>}{a.title}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: '2px' }}>
                  {new Date(a.createdAt).toLocaleDateString()} · {a.dismissCount} dismissed
                </div>
              </div>
              <div style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
                <button onClick={() => toggle(a)} disabled={busy}
                  style={{ padding: '5px 9px', borderRadius: '7px', border: '1.5px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-muted)', fontSize: '0.7rem', fontWeight: '700', cursor: 'pointer' }}>
                  {a.active ? 'Take down' : 'Show'}
                </button>
                <button onClick={() => remove(a)} disabled={busy}
                  style={{ padding: '5px 9px', borderRadius: '7px', border: '1.5px solid #fed7d7', backgroundColor: 'var(--surface)', color: '#c53030', fontSize: '0.7rem', fontWeight: '700', cursor: 'pointer' }}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
