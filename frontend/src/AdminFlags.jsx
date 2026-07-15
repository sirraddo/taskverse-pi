import { useState, useEffect, useCallback } from 'react';
import {
  fetchAdminFlags, createFlag, setFlagEnabled, deleteFlag,
} from './piClient';

/**
 * Admin: emergency-brake feature flags (disable posting/submissions/payouts
 * instantly, no deploy) plus a global Maintenance Mode switch. Mirrors the
 * "select a feature → Create" pattern from Zappi NG's Flags tab.
 *
 * Note on the Maintenance Mode row specifically: unlike the other flags,
 * turning IT "on" is what blocks the app for everyone else — so it's shown
 * with inverted colors (red = active/blocking) rather than the usual
 * red-means-disabled convention used for the other three.
 */
export default function AdminFlags({ notify }) {
  const [features, setFeatures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState(null);
  const [selectedNew, setSelectedNew] = useState('');
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchAdminFlags();
      setFeatures(r.features || []);
    } catch (e) {
      setErr(e.message || 'Could not load flags');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const created = features.filter((f) => f.exists);
  const uncreated = features.filter((f) => !f.exists);

  const handleCreate = async () => {
    if (!selectedNew) return;
    setCreating(true);
    setErr('');
    try {
      await createFlag(selectedNew);
      setSelectedNew('');
      notify?.('🚩 Flag created');
      await load();
    } catch (e) {
      setErr(e.message || 'Could not create flag');
    } finally { setCreating(false); }
  };

  const toggle = async (f) => {
    setBusyKey(f.key);
    try {
      await setFlagEnabled(f.key, !f.enabled);
      const nowBlocking = f.key === 'maintenance' ? !f.enabled : f.enabled;
      notify?.(nowBlocking ? `⛔ ${f.label} disabled` : `✅ ${f.label} enabled`);
      await load();
    } catch (e) {
      setErr(e.message || 'Failed');
    } finally { setBusyKey(null); }
  };

  const remove = async (f) => {
    setBusyKey(f.key);
    try { await deleteFlag(f.key); await load(); }
    catch (e) { setErr(e.message || 'Failed'); }
    finally { setBusyKey(null); }
  };

  return (
    <div style={{ backgroundColor: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: '12px', padding: '14px', marginBottom: '14px' }}>
      <div style={{ fontWeight: '800', color: '#065F46', fontSize: '0.9rem', marginBottom: '3px' }}>
        🚩 Feature Flags
      </div>
      <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', margin: '0 0 12px' }}>
        Emergency brake — disable posting, submissions, or payouts instantly without a deploy. Maintenance Mode overrides all of them at once and blocks the app for everyone except admins.
      </p>

      {uncreated.length > 0 && (
        <div style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: '10px', padding: '10px', marginBottom: '12px' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-faint)', marginBottom: '7px' }}>NEW FLAG</div>
          <select value={selectedNew} onChange={(e) => setSelectedNew(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: '9px', border: '1.5px solid var(--border)', fontSize: '0.84rem', color: 'var(--text-secondary)', backgroundColor: 'var(--surface)', marginBottom: '8px' }}>
            <option value="">Select a feature…</option>
            {uncreated.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <button onClick={handleCreate} disabled={creating || !selectedNew}
            style={{
              width: '100%', padding: '10px', borderRadius: '10px', border: 'none',
              backgroundColor: (creating || !selectedNew) ? '#a0aec0' : '#059669',
              color: 'white', fontWeight: '800', fontSize: '0.85rem',
              cursor: (creating || !selectedNew) ? 'not-allowed' : 'pointer',
            }}>
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      )}

      {err && (
        <div style={{ fontSize: '0.75rem', color: '#c53030', backgroundColor: '#fff5f5', padding: '7px 10px', borderRadius: '8px', marginBottom: '8px' }}>
          ⚠️ {err}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-faintest)' }}>Loading…</div>
      ) : created.length === 0 ? (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-faintest)' }}>No flags yet.</div>
      ) : created.map((f) => {
        // "Blocking" = this flag is currently having an effect that stops
        // something. For maintenance that's enabled=true; for the rest
        // it's enabled=false.
        const blocking = f.key === 'maintenance' ? f.enabled : !f.enabled;
        return (
          <div key={f.key} style={{
            border: '1px solid var(--border)', borderRadius: '9px', padding: '9px 10px', marginBottom: '6px',
            backgroundColor: blocking ? '#fff5f5' : '#f0fff4',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-secondary)' }}>
                  <span style={{ color: blocking ? '#c53030' : '#059669' }}>● </span>{f.label}
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-faintest)', marginTop: '2px' }}>{f.description}</div>
              </div>
              <div style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
                <button onClick={() => toggle(f)} disabled={busyKey === f.key}
                  style={{
                    padding: '6px 10px', borderRadius: '7px', border: '1.5px solid',
                    borderColor: blocking ? '#fed7d7' : '#c6f6d5',
                    backgroundColor: 'var(--surface)', color: blocking ? '#c53030' : '#276749',
                    fontSize: '0.7rem', fontWeight: '700', cursor: 'pointer',
                  }}>
                  {f.key === 'maintenance'
                    ? (f.enabled ? 'Turn off' : 'Turn on')
                    : (f.enabled ? 'Disable' : 'Enable')}
                </button>
                <button onClick={() => remove(f)} disabled={busyKey === f.key}
                  style={{ padding: '6px 9px', borderRadius: '7px', border: '1.5px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-faintest)', fontSize: '0.7rem', fontWeight: '700', cursor: 'pointer' }}>
                  Remove
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
