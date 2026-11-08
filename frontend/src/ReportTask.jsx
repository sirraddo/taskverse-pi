import { useState } from 'react';
import { reportTask } from './piClient';

const REASONS = [
  { key: 'scam', label: '⚠️ Scam or asks for money / passwords' },
  { key: 'misleading', label: '🎭 Misleading or impossible to complete' },
  { key: 'inappropriate', label: '🚫 Inappropriate or harmful content' },
  { key: 'other', label: '💬 Something else' },
];

/** Bottom-sheet to report a task for admin review. */
export default function ReportTask({ task, onClose, notify }) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!reason) return notify('Pick a reason first.');
    setBusy(true);
    try {
      const r = await reportTask(task.id, reason, note.trim());
      notify(r.alreadyReported ? 'You already reported this task.' : '✅ Thanks — an admin will review this task.');
      onClose();
    } catch (e) { notify('⚠️ ' + e.message); setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: '500px', backgroundColor: 'var(--surface)', borderRadius: '18px 18px 0 0', padding: '18px 18px 22px', fontFamily: 'sans-serif' }}>
        <div style={{ fontWeight: '800', color: 'var(--text)', marginBottom: '2px' }}>Report this task</div>
        <div style={{ fontSize: '0.76rem', color: 'var(--text-faint)', marginBottom: '12px' }}>{task.title}</div>
        {REASONS.map((r) => (
          <button key={r.key} onClick={() => setReason(r.key)}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', marginBottom: '6px', borderRadius: '10px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: '600',
              border: reason === r.key ? '2px solid #059669' : '1.5px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-secondary)' }}>
            {r.label}
          </button>
        ))}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Add details (optional)"
          style={{ width: '100%', boxSizing: 'border-box', minHeight: '60px', padding: '9px 10px', borderRadius: '10px', border: '1.5px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '4px' }} />
        <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '11px', borderRadius: '10px', border: '1.5px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-muted)', fontWeight: '700', cursor: 'pointer' }}>Cancel</button>
          <button onClick={send} disabled={busy} style={{ flex: 1.4, padding: '11px', borderRadius: '10px', border: 'none', backgroundColor: '#c53030', color: 'white', fontWeight: '700', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Sending…' : 'Send report'}</button>
        </div>
      </div>
    </div>
  );
}
