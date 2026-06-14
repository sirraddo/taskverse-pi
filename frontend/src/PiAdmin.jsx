import React, { useState, useEffect, useCallback } from 'react';
import { fetchAdminQueue, approveSubmission, rejectSubmission, fetchRevenue, fetchDisputes, createAdminTask, reconcilePayouts } from './piClient';

const inputStyle = {
  width: '100%', padding: '9px 12px', boxSizing: 'border-box', borderRadius: '8px',
  border: '1.5px solid #e2e8f0', fontSize: '0.85rem', color: '#2d3748',
  backgroundColor: 'white', outline: 'none', marginBottom: '8px',
};

/**
 * PRODUCTION ADMIN PANEL
 * - Revenue + dispute count banner
 * - Collapsible "Create Sponsored Task" form (admin can seed live tasks instantly)
 * - Manual-review submission queue with auto-review reason trail
 * - Approve / Reject actions
 */
export default function PiAdmin({ onBack, onOpenDisputes, notify }) {
  const [queue, setQueue] = useState(null);
  const [revenue, setRevenue] = useState(null);
  const [disputeCount, setDisputeCount] = useState(0);
  const [busyId, setBusyId] = useState(null);

  // Sponsored task form
  const [showForm, setShowForm] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskReward, setTaskReward] = useState('');
  const [taskSlots, setTaskSlots] = useState('10');
  const [creating, setCreating] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  const handleReconcile = async () => {
    setReconciling(true);
    try {
      const res = await reconcilePayouts();
      notify(`💸 Reconcile done: ${res.completed} completed, ${res.stillPending} still pending, ${res.failed} failed (scanned ${res.scanned})`);
    } catch (err) { notify('⚠️ ' + err.message); }
    finally { setReconciling(false); }
  };

  const load = useCallback(async () => {
    try {
      const [q, rev, disputes] = await Promise.all([fetchAdminQueue(), fetchRevenue(), fetchDisputes()]);
      setQueue(q);
      setRevenue(rev);
      setDisputeCount(disputes.length);
    } catch (err) { notify('Warning: ' + err.message); }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn, id, successMsg) => {
    setBusyId(id);
    try { await fn(id); notify(successMsg); await load(); }
    catch (err) { notify('Warning: ' + err.message); }
    finally { setBusyId(null); }
  };

  const handleCreateTask = async () => {
    if (!taskTitle.trim() || !taskReward || !taskSlots) return notify('Fill all required fields.');
    setCreating(true);
    try {
      const result = await createAdminTask({
        title: taskTitle.trim(),
        description: taskDesc.trim(),
        rewardPi: parseFloat(taskReward),
        slots: parseInt(taskSlots, 10),
      });
      notify('✅ Sponsored task live: "' + result.title + '" (' + result.slots + ' slots × ' + result.rewardPi + 'π)');
      setTaskTitle(''); setTaskDesc(''); setTaskReward(''); setTaskSlots('10');
      setShowForm(false);
      await load();
    } catch (err) {
      notify('⚠️ ' + err.message);
    } finally { setCreating(false); }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', backgroundColor: '#f7fafc', minHeight: '100vh' }}>
      <button onClick={onBack} style={{ background: 'white', border: '1px solid #d1d5db', padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem', color: '#374151', fontWeight: '500', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '16px' }}>← Back</button>
      <h2 style={{ margin: '0 0 14px', fontSize: '1.05rem', fontWeight: '700', color: '#1a202c' }}>🔧 Admin Moderation Center</h2>

      {/* Revenue / dispute banner */}
      {revenue && (
        <div style={{ backgroundColor: '#2d3748', color: 'white', padding: '12px 16px', borderRadius: '10px', marginBottom: '14px', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <span>Platform revenue: <strong>{revenue.totalFeesPi.toFixed(4)} π</strong> from {revenue.fundedTasks} funded campaign{revenue.fundedTasks !== 1 ? 's' : ''}</span>
          <span style={{ opacity: 0.75, fontSize: '0.78rem' }}>Escrowed rewards power A2U payouts</span>
        </div>
      )}

      {/* Sponsored task creation */}
      <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '14px', marginBottom: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <button
          onClick={() => setShowForm(f => !f)}
          style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 0 }}
        >
          <span style={{ fontWeight: '700', color: '#764ba2', fontSize: '0.9rem' }}>📌 Create Sponsored Task</span>
          <span style={{ color: '#764ba2', fontSize: '1.1rem', fontWeight: '700' }}>{showForm ? '−' : '+'}</span>
        </button>
        <p style={{ margin: '4px 0 0', fontSize: '0.72rem', color: '#a0aec0' }}>
          Sponsored tasks go live instantly without Pi payment — use to seed the feed or reward specific actions.
        </p>

        {showForm && (
          <div style={{ marginTop: '14px', borderTop: '1px solid #e2e8f0', paddingTop: '14px' }}>
            <input type="text" value={taskTitle} onChange={e => setTaskTitle(e.target.value)}
              placeholder="Task title *" style={inputStyle} />
            <textarea value={taskDesc} onChange={e => setTaskDesc(e.target.value)}
              placeholder="Task description (what to do, how to prove it)" rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'sans-serif', lineHeight: 1.45 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '0.68rem', fontWeight: '700', color: '#718096', display: 'block', marginBottom: '3px' }}>REWARD PER SLOT (π) *</label>
                <input type="number" step="0.01" min="0.01" value={taskReward} onChange={e => setTaskReward(e.target.value)}
                  placeholder="0.10" style={{ ...inputStyle, marginBottom: 0 }} />
              </div>
              <div>
                <label style={{ fontSize: '0.68rem', fontWeight: '700', color: '#718096', display: 'block', marginBottom: '3px' }}>SLOTS *</label>
                <input type="number" min="1" max="1000" value={taskSlots} onChange={e => setTaskSlots(e.target.value)}
                  placeholder="10" style={{ ...inputStyle, marginBottom: 0 }} />
              </div>
            </div>
            {taskReward && taskSlots && (
              <div style={{ fontSize: '0.75rem', color: '#718096', marginTop: '6px', backgroundColor: '#f7fafc', padding: '6px 10px', borderRadius: '6px' }}>
                Escrow needed: {(parseFloat(taskReward) * parseInt(taskSlots, 10)).toFixed(4)} π total
              </div>
            )}
            <button onClick={handleCreateTask} disabled={creating}
              style={{ marginTop: '10px', width: '100%', backgroundColor: creating ? '#a0aec0' : '#764ba2', color: 'white', border: 'none', padding: '10px', borderRadius: '8px', fontWeight: '700', cursor: creating ? 'not-allowed' : 'pointer', fontSize: '0.88rem' }}>
              {creating ? '⏳ Creating…' : '🚀 Create & Publish Task'}
            </button>
          </div>
        )}
      </div>

      {/* Reconcile pending A2U payouts */}
      <button onClick={handleReconcile} disabled={reconciling}
        style={{ width: '100%', marginBottom: '14px', padding: '10px', backgroundColor: reconciling ? '#a0aec0' : '#2d3748', color: 'white', border: 'none', borderRadius: '10px', cursor: reconciling ? 'not-allowed' : 'pointer', fontWeight: '700', fontSize: '0.82rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
        <span style={{ display: 'inline-block', animation: reconciling ? 'spin 0.8s linear infinite' : 'none' }}>🔄</span>
        {reconciling ? 'Checking pending payouts…' : 'Reconcile Pending A2U Payouts'}
      </button>

      {/* Review queue */}
      <h3 style={{ margin: '0 0 10px', fontSize: '0.88rem', fontWeight: '700', color: '#4a5568' }}>
        📋 Manual Review Queue {queue !== null && <span style={{ color: '#a0aec0' }}>({queue.length})</span>}
      </h3>
      {queue === null && <p style={{ color: '#718096', fontSize: '0.85rem' }}>Loading queue…</p>}
      {queue?.length === 0 && (
        <p style={{ color: '#718096', fontSize: '0.85rem', backgroundColor: 'white', padding: '14px', borderRadius: '10px' }}>
          ✨ Queue is empty — the auto-review engine is handling submissions.
        </p>
      )}

      {queue?.map((sub) => (
        <div key={sub._id} style={{ backgroundColor: 'white', padding: '16px', marginBottom: '12px', borderRadius: '10px', boxShadow: '0 2px 6px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
            <h4 style={{ margin: 0, fontSize: '0.88rem', fontWeight: '700', color: '#1a202c', flex: 1 }}>
              {sub.task?.title}
            </h4>
            <span style={{ background: 'linear-gradient(135deg,#667eea,#764ba2)', color: 'white', padding: '3px 8px', borderRadius: '8px', fontWeight: '800', fontSize: '0.78rem', flexShrink: 0, marginLeft: '8px' }}>
              {(sub.task?.rewardMicroPi / 1e6).toFixed(2)} π
            </span>
          </div>
          <p style={{ fontSize: '0.78rem', color: '#718096', margin: '0 0 8px' }}>
            👤 {sub.worker?.username}
            {sub.worker?.isKycVerified && <span style={{ marginLeft: '5px', color: '#48bb78', fontWeight: '700' }}>⚡ KYC</span>}
            {' '}— {sub.worker?.approvedCount ?? 0} prior approvals
          </p>
          <div style={{ backgroundColor: '#f7fafc', padding: '10px 12px', borderRadius: '8px', fontSize: '0.85rem', color: '#2d3748', marginBottom: '8px', lineHeight: 1.5 }}>
            {sub.proofText || <em style={{ color: '#a0aec0' }}>(file-only submission)</em>}
          </div>

          {sub.proofFileUrl && (
            <div style={{ marginBottom: '8px' }}>
              <img src={sub.proofFileUrl} alt="Proof screenshot"
                style={{ maxWidth: '100%', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'block', maxHeight: '200px', objectFit: 'contain' }}
                onError={(e) => { e.target.style.display = 'none'; }} />
              <a href={sub.proofFileUrl} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: '0.75rem', color: '#667eea', display: 'inline-block', marginTop: '4px' }}>
                Open full image ↗
              </a>
            </div>
          )}

          {sub.autoReview?.reasons?.length > 0 && (
            <p style={{ fontSize: '0.72rem', color: '#a0aec0', backgroundColor: '#fffbeb', padding: '6px 10px', borderRadius: '6px', marginBottom: '10px' }}>
              🤖 {sub.autoReview.reasons.join(' • ')}
            </p>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            <button disabled={busyId === sub._id}
              onClick={() => act(approveSubmission, sub._id, '✅ Approved — A2U payout sent.')}
              style={{ flex: 1, backgroundColor: busyId === sub._id ? '#a0aec0' : '#48bb78', color: 'white', border: 'none', padding: '10px', borderRadius: '8px', fontWeight: '700', cursor: busyId === sub._id ? 'not-allowed' : 'pointer', fontSize: '0.85rem' }}>
              Approve & Pay
            </button>
            <button disabled={busyId === sub._id}
              onClick={() => act(rejectSubmission, sub._id, '❌ Rejected — moved to Appeals.')}
              style={{ flex: 1, backgroundColor: busyId === sub._id ? '#a0aec0' : '#e53e3e', color: 'white', border: 'none', padding: '10px', borderRadius: '8px', fontWeight: '700', cursor: busyId === sub._id ? 'not-allowed' : 'pointer', fontSize: '0.85rem' }}>
              Reject
            </button>
          </div>
        </div>
      ))}

      <button onClick={onOpenDisputes}
        style={{ width: '100%', marginTop: '8px', backgroundColor: disputeCount > 0 ? '#c53030' : '#718096', color: 'white', border: 'none', padding: '12px', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '0.88rem' }}>
        ⚖️ Dispute Appeals Board ({disputeCount})
      </button>
    </div>
  );
}
