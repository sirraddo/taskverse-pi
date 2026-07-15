import { useState, useEffect, useCallback } from 'react';
import { fetchAdminSettings, updateSettings } from './piClient';

const FIELD_GROUPS = [
  {
    title: 'Fee rate',
    fields: [
      { key: 'feeRate', label: 'Platform fee', suffix: '%', display: (v) => (v * 100).toFixed(1), toStored: (v) => Number(v) / 100, help: 'Charged on top of the reward pool when a user funds a task. Default 5%.' },
    ],
  },
  {
    title: 'Reward & slot limits (public task posting)',
    fields: [
      { key: 'minRewardMicroPi', label: 'Min reward per slot', suffix: 'π', help: 'Default 0.01π.' },
      { key: 'maxRewardMicroPi', label: 'Max reward per slot', suffix: 'π', nullable: true, help: 'Leave blank for no cap.' },
      { key: 'minSlots', label: 'Min slots', suffix: '', help: 'Default 1.' },
      { key: 'maxSlots', label: 'Max slots', suffix: '', nullable: true, help: 'Leave blank for no cap.' },
    ],
  },
  {
    title: 'Auto-approve thresholds',
    fields: [
      { key: 'autoApproveRejectionRateThreshold', label: 'Rejection-rate flag threshold', suffix: '%', display: (v) => (v * 100).toFixed(0), toStored: (v) => Number(v) / 100, help: 'Workers at or above this rejection rate get flagged for manual review. Default 35%.' },
      { key: 'autoApproveMinDecisions', label: 'Min decisions before that applies', suffix: '', help: 'A worker needs at least this many approved+rejected submissions before the rejection-rate check kicks in. Default 5.' },
    ],
  },
];

// Reward fields are stored in microPi (1,000,000 = 1 π) but edited in π.
const MICRO_PI_FIELDS = new Set(['minRewardMicroPi', 'maxRewardMicroPi']);

export default function AdminSettings({ notify }) {
  const [settings, setSettings] = useState(null);
  const [overridden, setOverridden] = useState({});
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchAdminSettings();
      setSettings(r.settings || {});
      setOverridden(r.overridden || {});
      setDraft({});
    } catch (e) {
      setErr(e.message || 'Could not load settings');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading || !settings) {
    return <div style={{ fontSize: '0.75rem', color: 'var(--text-faintest)', padding: '14px' }}>Loading…</div>;
  }

  const rawValueFor = (field) => {
    if (draft[field.key] !== undefined) return draft[field.key] === null ? '' : draft[field.key];
    const stored = settings[field.key];
    if (stored === null || stored === undefined) return '';
    const asEditUnit = MICRO_PI_FIELDS.has(field.key) ? stored / 1_000_000 : stored;
    return field.display ? field.display(asEditUnit) : String(asEditUnit);
  };

  const setValue = (key, v) => setDraft((d) => ({ ...d, [key]: v }));

  const resetField = (field) => setDraft((d) => ({ ...d, [field.key]: null }));

  const save = async () => {
    setErr('');
    // Build a payload of only the fields the admin actually touched.
    const payload = {};
    for (const group of FIELD_GROUPS) {
      for (const field of group.fields) {
        if (!(field.key in draft)) continue;
        const v = draft[field.key];
        if (v === null || v === '') { payload[field.key] = null; continue; }
        let n = Number(v);
        if (field.toStored) n = field.toStored(n);
        if (MICRO_PI_FIELDS.has(field.key)) n = Math.round(n * 1_000_000);
        payload[field.key] = n;
      }
    }
    if (Object.keys(payload).length === 0) { notify?.('Nothing changed'); return; }
    setSaving(true);
    try {
      await updateSettings(payload);
      notify?.('⚙️ Settings saved');
      await load();
    } catch (e) {
      setErr(e.message || 'Could not save');
    } finally { setSaving(false); }
  };

  const inputStyle = {
    width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: '9px',
    border: '1.5px solid var(--border)', fontSize: '0.84rem', color: 'var(--text-secondary)',
    outline: 'none', backgroundColor: 'var(--surface)', fontFamily: 'inherit',
  };

  return (
    <div style={{ backgroundColor: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: '12px', padding: '14px', marginBottom: '14px' }}>
      <div style={{ fontWeight: '800', color: '#065F46', fontSize: '0.9rem', marginBottom: '3px' }}>
        ⚙️ Platform Settings
      </div>
      <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', margin: '0 0 12px' }}>
        Live-editable — no deploy needed. Fields left blank use the app's built-in default.
      </p>

      {err && (
        <div style={{ fontSize: '0.75rem', color: '#c53030', backgroundColor: '#fff5f5', padding: '7px 10px', borderRadius: '8px', marginBottom: '10px' }}>
          ⚠️ {err}
        </div>
      )}

      {FIELD_GROUPS.map((group) => (
        <div key={group.title} style={{ marginBottom: '14px' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-faint)', marginBottom: '7px' }}>
            {group.title.toUpperCase()}
          </div>
          {group.fields.map((field) => (
            <div key={field.key} style={{ marginBottom: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '3px' }}>
                <label style={{ fontSize: '0.78rem', fontWeight: '600', color: 'var(--text-muted)' }}>{field.label}</label>
                {overridden[field.key] && !(field.key in draft) && (
                  <button onClick={() => resetField(field)}
                    style={{ border: 'none', background: 'none', color: '#059669', fontSize: '0.68rem', fontWeight: '700', cursor: 'pointer', padding: 0 }}>
                    reset to default
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input
                  type="number" step="any"
                  value={rawValueFor(field)}
                  placeholder={field.nullable ? 'no cap' : ''}
                  onChange={(e) => setValue(field.key, e.target.value)}
                  style={inputStyle}
                />
                {field.suffix && <span style={{ fontSize: '0.8rem', color: 'var(--text-faintest)', flexShrink: 0 }}>{field.suffix}</span>}
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-faintest)', marginTop: '3px' }}>{field.help}</div>
            </div>
          ))}
        </div>
      ))}

      <button onClick={save} disabled={saving || Object.keys(draft).length === 0}
        style={{
          width: '100%', padding: '10px', borderRadius: '10px', border: 'none',
          backgroundColor: (saving || Object.keys(draft).length === 0) ? '#a0aec0' : '#059669',
          color: 'white', fontWeight: '800', fontSize: '0.85rem',
          cursor: (saving || Object.keys(draft).length === 0) ? 'not-allowed' : 'pointer',
        }}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}
