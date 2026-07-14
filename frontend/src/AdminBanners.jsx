import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchAdminBanners, createBanner, updateBanner, deleteBanner, resizeBannerImageToDataUrl,
} from './piClient';

/**
 * Admin: manage the promo banner carousel shown on the home feed —
 * used to cross-promote your other apps (e.g. Zappi NG). Unlike
 * Announcements, several banners can be active at once; `order` controls
 * which shows first (lower = first).
 */
export default function AdminBanners({ notify }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const [title, setTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  const [order, setOrder] = useState('0');
  const [image, setImage] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchAdminBanners();
      setList(r.banners || []);
    } catch (e) {
      setErr(e.message || 'Could not load banners');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr('');
    try {
      const dataUrl = await resizeBannerImageToDataUrl(file);
      setImage(dataUrl);
    } catch (ex) {
      setErr(ex.message || 'Could not process that image.');
    }
  };

  const publish = async () => {
    setErr('');
    if (!title.trim() || !linkUrl.trim() || !image) {
      setErr('Title, link, and an image are all required.');
      return;
    }
    setBusy(true);
    try {
      await createBanner({
        title: title.trim(), linkUrl: linkUrl.trim(), linkLabel: linkLabel.trim(),
        order: Number(order) || 0, image,
      });
      setTitle(''); setLinkUrl(''); setLinkLabel(''); setOrder('0'); setImage('');
      if (fileRef.current) fileRef.current.value = '';
      notify?.('🖼️ Banner published');
      await load();
    } catch (e) {
      setErr(e.message || 'Could not publish');
    } finally { setBusy(false); }
  };

  const toggle = async (b) => {
    setBusy(true);
    try { await updateBanner(b.id, { active: !b.active }); await load(); }
    catch (e) { setErr(e.message || 'Failed'); }
    finally { setBusy(false); }
  };

  const remove = async (b) => {
    setBusy(true);
    try { await deleteBanner(b.id); await load(); }
    catch (e) { setErr(e.message || 'Failed'); }
    finally { setBusy(false); }
  };

  const inputStyle = {
    width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: '9px',
    border: '1.5px solid #e2e8f0', fontSize: '0.84rem', color: '#2d3748',
    outline: 'none', backgroundColor: 'white', fontFamily: 'inherit',
  };

  return (
    <div style={{ backgroundColor: 'white', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '14px', marginBottom: '14px' }}>
      <div style={{ fontWeight: '800', color: '#065F46', fontSize: '0.9rem', marginBottom: '3px' }}>
        🖼️ Banners
      </div>
      <p style={{ fontSize: '0.72rem', color: '#718096', margin: '0 0 12px' }}>
        Promo carousel on the home feed — e.g. cross-promote Zappi NG. Multiple can be live at once; lowest order shows first.
      </p>

      {/* Compose */}
      <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80}
        placeholder="Title (internal label, not shown to users)" style={{ ...inputStyle, marginBottom: '8px' }} />

      <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
        <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="Link https://…" style={{ ...inputStyle, flex: 2 }} />
        <input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} maxLength={40}
          placeholder="Button text" style={{ ...inputStyle, flex: 1 }} />
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', alignItems: 'center' }}>
        <input type="number" value={order} onChange={(e) => setOrder(e.target.value)}
          placeholder="Order" style={{ ...inputStyle, width: '90px' }} />
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={pickFile}
          style={{ fontSize: '0.75rem', flex: 1 }} />
      </div>

      {image && (
        <img src={image} alt="Banner preview" style={{ width: '100%', borderRadius: '9px', marginBottom: '8px', display: 'block' }} />
      )}

      {err && (
        <div style={{ fontSize: '0.75rem', color: '#c53030', backgroundColor: '#fff5f5', padding: '7px 10px', borderRadius: '8px', marginBottom: '8px' }}>
          ⚠️ {err}
        </div>
      )}

      <button onClick={publish} disabled={busy || !title.trim() || !linkUrl.trim() || !image}
        style={{
          width: '100%', padding: '10px', borderRadius: '10px', border: 'none',
          backgroundColor: (busy || !title.trim() || !linkUrl.trim() || !image) ? '#a0aec0' : '#059669',
          color: 'white', fontWeight: '800', fontSize: '0.85rem',
          cursor: (busy || !title.trim() || !linkUrl.trim() || !image) ? 'not-allowed' : 'pointer',
        }}>
        {busy ? 'Publishing…' : 'Add banner'}
      </button>

      {/* List */}
      <div style={{ marginTop: '14px', borderTop: '1px solid #edf2f7', paddingTop: '10px' }}>
        <div style={{ fontSize: '0.72rem', fontWeight: '700', color: '#718096', marginBottom: '7px' }}>
          ALL BANNERS
        </div>
        {loading ? (
          <div style={{ fontSize: '0.75rem', color: '#a0aec0' }}>Loading…</div>
        ) : list.length === 0 ? (
          <div style={{ fontSize: '0.75rem', color: '#a0aec0' }}>None yet.</div>
        ) : list.map((b) => (
          <div key={b.id} style={{
            border: '1px solid #edf2f7', borderRadius: '9px', padding: '9px 10px', marginBottom: '6px',
            backgroundColor: b.active ? '#f0fff4' : '#f7fafc',
          }}>
            <div style={{ display: 'flex', gap: '9px', alignItems: 'flex-start' }}>
              <img src={b.image} alt="" style={{ width: '72px', height: '32px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: '0.8rem', fontWeight: '700', color: '#2d3748', wordBreak: 'break-word' }}>
                  {b.active && <span style={{ color: '#059669' }}>● </span>}{b.title}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#718096', marginTop: '2px' }}>
                  order {b.order} · {new Date(b.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
                <button onClick={() => toggle(b)} disabled={busy}
                  style={{ padding: '5px 9px', borderRadius: '7px', border: '1.5px solid #e2e8f0', backgroundColor: 'white', color: '#4a5568', fontSize: '0.7rem', fontWeight: '700', cursor: 'pointer' }}>
                  {b.active ? 'Hide' : 'Show'}
                </button>
                <button onClick={() => remove(b)} disabled={busy}
                  style={{ padding: '5px 9px', borderRadius: '7px', border: '1.5px solid #fed7d7', backgroundColor: 'white', color: '#c53030', fontSize: '0.7rem', fontWeight: '700', cursor: 'pointer' }}>
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
