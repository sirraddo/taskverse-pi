import React, { useState, useEffect, useCallback } from 'react';
import { fetchAdminQueue, approveSubmission, rejectSubmission, fetchRevenue, fetchDisputes } from './piClient';

/**
 * PRODUCTION VERSION — the queue lives on the server.
 * Every action calls the API then refetches; nothing is mutated locally.
 * Shows the auto-review reason trail so you can audit why a submission
 * reached the manual queue, plus a live platform-revenue counter.
 */
export default function PiAdmin({ onBack, onOpenDisputes, notify }) {
  const [queue, setQueue] = useState(null);
  const [revenue, setRevenue] = useState(null);
  const [disputeCount, setDisputeCount] = useState(0);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const [q, rev, disputes] = await Promise.all([fetchAdminQueue(), fetchRevenue(), fetchDisputes()]);
      setQueue(q);
      setRevenue(rev);
      setDisputeCount(disputes.length);
    } catch (err) {
      notify(`⚠️ ${err.message}`);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn, id, successMsg) => {
    setBusyId(id);
    try {
      await fn(id);
      notify(successMsg);
      await load();
    } catch (err) {
      notify(`⚠️ ${err.message}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', backgroundColor: '#f7fafc', minHeight: '100vh' }}>
      <button onClick={onBack}>← Back</button>
      <h2>🛡️ Admin Moderation Center</h2>

      {revenue && (
        <div style={{ backgroundColor: '#2d3748', color: 'white', padding: '12px 16px', borderRadius: '8px', marginBottom: '15px', fontSize: '0.9rem' }}>
          💼 Platform revenue: <strong>{revenue.totalFeesPi.toFixed(2)} π</strong> from {revenue.fundedTasks} funded campaigns
        </div>
      )}

      {queue === null && <p style={{ color: '#718096' }}>Loading queue…</p>}
      {queue?.length === 0 && <p style={{ color: '#718096' }}>Queue is empty — the auto-review engine is handling the rest. 🎉</p>}

      {queue?.map((sub) => (
        <div key={sub._id} style={{ backgroundColor: 'white', padding: '20px', marginBottom: '15px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
          <h4 style={{ margin: '0 0 5px 0' }}>
            {sub.task?.title} · {(sub.task?.rewardMicroPi / 1e6).toFixed(2)} π
          </h4>
          <p style={{ fontSize: '0.85rem', color: '#4a5568', margin: '0 0 8px 0' }}>
            👤 {sub.worker?.username} {sub.worker?.isKycVerified && '✓'} · {sub.worker?.approvedCount ?? 0} prior approvals
          </p>
          <p style={{ backgroundColor: '#f7fafc', padding: '10px', borderRadius: '6px', fontSize: '0.9rem' }}>
            {sub.proofText || <em>(file-only submission)</em>}
          </p>
          {sub.autoReview?.reasons?.length > 0 && (
            <p style={{ fontSize: '0.75rem', color: '#a0aec0' }}>
              Auto-review: {sub.autoReview.reasons.join(' · ')}
            </p>
          )}
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              disabled={busyId === sub._id}
              onClick={() => act(approveSubmission, sub._id, '💰 Approved — payout sent via A2U.')}
              style={{ flex: 1, backgroundColor: '#48bb78', color: 'white', border: 'none', padding: '10px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
            >✓ Approve & Pay</button>
            <button
              disabled={busyId === sub._id}
              onClick={() => act(rejectSubmission, sub._id, '✕ Rejected — moved to Appeals.')}
              style={{ flex: 1, backgroundColor: '#e53e3e', color: 'white', border: 'none', padding: '10px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
            >✕ Reject</button>
          </div>
        </div>
      ))}

      <button onClick={onOpenDisputes} style={{ width: '100%', marginTop: '15px', backgroundColor: '#c53030', color: 'white', border: 'none', padding: '12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
        ⚖️ Open Dispute Appeals Board ({disputeCount})
      </button>
    </div>
  );
}
