import React, { useState, useEffect, useCallback } from 'react';
import { fetchDisputes, resolveDispute } from './piClient';

/**
 * PRODUCTION VERSION — disputes come from GET /api/admin/disputes.
 * Overturn triggers settlement + A2U payout on the server; uphold
 * finalizes the rejection. An optional note is stored on the record.
 */
export default function PiDisputes({ onBack, notify, onResolved }) {
  const [disputes, setDisputes] = useState(null);
  const [notes, setNotes] = useState({});
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try { setDisputes(await fetchDisputes()); }
    catch (err) { notify(`⚠️ ${err.message}`); }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const resolve = async (id, decision) => {
    setBusyId(id);
    try {
      await resolveDispute(id, decision, notes[id] || '');
      notify(decision === 'overturn'
        ? '⚖️ Dispute Overturned: Pioneer paid out.'
        : '⚖️ Dispute Upheld: rejection finalized.');
      await load();
      onResolved?.();
    } catch (err) {
      notify(`⚠️ ${err.message}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', minHeight: '100vh', backgroundColor: '#f7fafc' }}>
      <button onClick={onBack}>← Back to Moderation</button>
      <h2>⚖️ Dispute Appeals Board</h2>

      {disputes === null && <p style={{ color: '#718096' }}>Loading disputes…</p>}
      {disputes?.length === 0 && <p style={{ color: '#718096' }}>No open disputes.</p>}

      {disputes?.map((disp) => (
        <div key={disp._id} style={{ backgroundColor: 'white', padding: '20px', marginBottom: '15px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
          <h4 style={{ margin: '0 0 5px 0' }}>{disp.submission?.task?.title}</h4>
          <p style={{ fontSize: '0.85rem', color: '#4a5568' }}>
            👤 {disp.submission?.worker?.username} · claimed {(disp.submission?.rewardMicroPi / 1e6).toFixed(2)} π
          </p>
          <p style={{ backgroundColor: '#f7fafc', padding: '10px', borderRadius: '6px', fontSize: '0.9rem' }}>
            Proof: {disp.submission?.proofText || <em>(file-only)</em>}
          </p>
          {disp.workerStatement && (
            <p style={{ fontSize: '0.85rem' }}><strong>Worker statement:</strong> {disp.workerStatement}</p>
          )}
          <input
            type="text"
            placeholder="Resolution note (optional)"
            value={notes[disp._id] || ''}
            onChange={(e) => setNotes({ ...notes, [disp._id]: e.target.value })}
            style={{ width: '100%', padding: '8px', boxSizing: 'border-box', marginBottom: '10px' }}
          />
          <div style={{ display: 'flex', gap: '10px' }}>
            <button disabled={busyId === disp._id} onClick={() => resolve(disp._id, 'overturn')}
              style={{ flex: 1, backgroundColor: '#48bb78', color: 'white', border: 'none', padding: '10px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
              Overturn & Pay
            </button>
            <button disabled={busyId === disp._id} onClick={() => resolve(disp._id, 'uphold')}
              style={{ flex: 1, backgroundColor: '#718096', color: 'white', border: 'none', padding: '10px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
              Uphold Rejection
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
