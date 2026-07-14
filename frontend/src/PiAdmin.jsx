import React, { useState, useEffect, useCallback } from 'react';
import AdminAnnouncements from './AdminAnnouncements';
import AdminBanners from './AdminBanners';
import { fetchAdminQueue, approveSubmission, rejectSubmission, fetchRevenue, fetchDisputes, createAdminTask, reconcilePayouts, cancelStaleFunding, fetchWorkerPaymentLookup, fetchWalletOverview, reconcileA2U, fetchUnpayableSubmissions, reconcileConsolidated, adminRemoveAvatar } from './piClient';

const inputStyle = {
  width: '100%', padding: '9px 12px', boxSizing: 'border-box', borderRadius: '8px',
  border: '1.5px solid #e2e8f0', fontSize: '0.85rem', color: '#2d3748',
  backgroundColor: 'white', outline: 'none', marginBottom: '8px',
};

// Tab definitions for the admin panel — one section visible at a time.
const TABS = [
  { key: 'queue', label: '📋 Queue' },
  { key: 'tasks', label: '📌 Tasks' },
  { key: 'payouts', label: '💸 Payouts' },
  { key: 'announcements', label: '📢 Announcements' },
  { key: 'banners', label: '🖼️ Banners' },
  { key: 'users', label: '👤 Users' },
];

/**
 * PRODUCTION ADMIN PANEL
 * - Revenue + dispute count banner
 * - Collapsible "Create Sponsored Task" form (admin can seed live tasks instantly)
 * - Manual-review submission queue with auto-review reason trail
 * - Approve / Reject actions
 */
export default function PiAdmin({ onBack, onOpenDisputes, notify }) {
  // Which section is showing. Mirrors the tabbed layout used in Zappi NG's
  // admin panel — one section visible at a time instead of one long scroll.
  const [tab, setTab] = useState('queue');
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
  const [cancelling, setCancelling] = useState(false);
  const [staleCutoff, setStaleCutoff] = useState('24');
  // Support: worker payment lookup + wallet overview
  const [lookupQuery, setLookupQuery] = useState('');

  // Avatar moderation (remove an inappropriate profile picture).
  const [avatarUid, setAvatarUid] = useState('');
  const [avatarModBusy, setAvatarModBusy] = useState(false);
  const [avatarModMsg, setAvatarModMsg] = useState('');
  const handleAvatarModeration = async (unblock) => {
    setAvatarModBusy(true); setAvatarModMsg('');
    try {
      const r = await adminRemoveAvatar(avatarUid.trim(), unblock);
      setAvatarModMsg(
        unblock
          ? `✓ ${r.username}: uploads re-enabled.`
          : `✓ ${r.username}: avatar removed and uploads blocked.`
      );
    } catch (e) {
      setAvatarModMsg(`⚠️ ${e.message || 'Failed'}`);
    } finally { setAvatarModBusy(false); }
  };
  const [lookupResult, setLookupResult] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [wallet, setWallet] = useState(null);
  const [walletLoading, setWalletLoading] = useState(false);

  // A2U reconcile (backlog flush) — fail-safe, button-driven
  const [a2uMode, setA2uMode] = useState('single'); // 'single' | 'batch'
  const [a2uSubmissionId, setA2uSubmissionId] = useState('');
  const [a2uLimit, setA2uLimit] = useState('3');
  const [a2uPreview, setA2uPreview] = useState(null);
  const [a2uResult, setA2uResult] = useState(null);
  const [a2uBusy, setA2uBusy] = useState(false);
  const [a2uConfirm, setA2uConfirm] = useState(null); // { opts, label, detail } | null
  const [unpayable, setUnpayable] = useState(null);
  const [unpayableLoading, setUnpayableLoading] = useState(false);
  const [staleConfirm, setStaleConfirm] = useState(false);
  const [consPreview, setConsPreview] = useState(null);
  const [consResult, setConsResult] = useState(null);
  const [consBusy, setConsBusy] = useState(false);
  const [consConfirm, setConsConfirm] = useState(null); // { maxWorkers } | null
  const [consIncludeSkipped, setConsIncludeSkipped] = useState(false);

  const handleCancelStale = () => setStaleConfirm(true);

  const executeCancelStale = async () => {
    setStaleConfirm(false);
    setCancelling(true);
    try {
      const res = await cancelStaleFunding(parseInt(staleCutoff, 10));
      const recovered = res.recovered || 0;
      const skipped = res.skipped || 0;
      if (res.scanned === 0) {
        notify(`✅ No stale tasks found older than ${staleCutoff}h.`);
      } else {
        const parts = [];
        parts.push(`🧹 Swept ${res.scanned} task${res.scanned !== 1 ? 's' : ''}`);
        parts.push(`cancelled ${res.cancelled}`);
        if (recovered) parts.push(`recovered ${recovered}`);
        if (skipped) parts.push(`skipped ${skipped}`);
        let msg = parts.join(', ') + '.';
        if (recovered) {
          const rec = res.details.filter(d => d.action === 'recovered');
          msg += ` Recovered: ${rec.map(d => '"' + d.title + '"').join(', ')}.`;
        }
        if (skipped) {
          const skp = res.details.filter(d => d.action === 'skipped');
          msg += ` Skipped (Pi unreachable, will retry): ${skp.map(d => '"' + d.title + '"').join(', ')}.`;
        }
        notify(msg);
      }
    } catch (err) { notify('⚠️ ' + err.message); }
    finally { setCancelling(false); }
  };

  const handleReconcile = async () => {
    setReconciling(true);
    try {
      const res = await reconcilePayouts();
      notify(`💸 Reconcile done: ${res.completed} completed, ${res.stillPending} still pending, ${res.failed} failed (scanned ${res.scanned})`);
    } catch (err) { notify('⚠️ ' + err.message); }
    finally { setReconciling(false); }
  };

  const handleLookup = async () => {
    const q = lookupQuery.trim();
    if (!q) return notify('Enter a username or piUid.');
    setLookingUp(true);
    setLookupResult(null);
    try {
      const res = await fetchWorkerPaymentLookup(q);
      setLookupResult(res);
    } catch (err) { notify('⚠️ ' + err.message); }
    finally { setLookingUp(false); }
  };

  const handleWalletOverview = async () => {
    setWalletLoading(true);
    try {
      const res = await fetchWalletOverview();
      setWallet(res);
    } catch (err) { notify('⚠️ ' + err.message); }
    finally { setWalletLoading(false); }
  };

  const handleLoadUnpayable = async () => {
    setUnpayableLoading(true);
    try {
      const res = await fetchUnpayableSubmissions();
      setUnpayable(res);
      notify(`📋 ${res.total} unpayable submission${res.total === 1 ? '' : 's'} (${res.totalPi}π) across ${res.byWorker.length} account${res.byWorker.length === 1 ? '' : 's'}.`);
    } catch (err) { notify('⚠️ ' + err.message); }
    finally { setUnpayableLoading(false); }
  };

  const handleConsPreview = async () => {
    setConsBusy(true);
    setConsResult(null);
    try {
      const res = await reconcileConsolidated({ dryRun: true, includeSkipped: consIncludeSkipped });
      setConsPreview(res);
      notify(`🧮 ${res.totalSubmissions} tasks → ${res.paymentsNeeded} payment${res.paymentsNeeded === 1 ? '' : 's'} (${res.totalPi}π). Nothing paid.`);
    } catch (err) { notify('⚠️ ' + err.message); }
    finally { setConsBusy(false); }
  };

  const handleConsSend = () => {
    if (!consPreview || consPreview.totalWorkers === 0) return notify('Run preview first.');
    setConsConfirm({ maxWorkers: Math.min(consPreview.totalWorkers, 5) });
  };

  const executeConsSend = async () => {
    const pending = consConfirm;
    if (!pending) return;
    setConsConfirm(null);
    setConsBusy(true);
    setConsResult(null);
    try {
      const res = await reconcileConsolidated({ maxWorkers: pending.maxWorkers, includeSkipped: consIncludeSkipped });
      setConsResult(res);
      if (res.stoppedForCooldown) {
        notify(`⏸ Rate-limited. ${res.workersPaid} worker(s) paid before cooldown.`);
      } else {
        notify(`✅ ${res.workersPaid} worker(s) paid · ${res.submissionsPaid} tasks · ${res.piPaid}π${res.skipped ? `, ${res.skipped} skipped` : ''}.`);
      }
    } catch (err) { notify('⚠️ ' + err.message); }
    finally { setConsBusy(false); }
  };

  // Dry-run preview — moves nothing, shows exactly what WOULD be paid
  const handleA2uPreview = async () => {
    const opts = { dryRun: true };
    if (a2uMode === 'single') {
      const id = a2uSubmissionId.trim();
      if (!id) return notify('Single mode: enter a submissionId first (or switch to Batch).');
      opts.submissionId = id;
    } else {
      opts.limit = parseInt(a2uLimit, 10) || 1;
    }
    setA2uBusy(true);
    setA2uResult(null);
    try {
      const res = await reconcileA2U(opts);
      setA2uPreview(res);
      notify(`👀 Would pay ${res.wouldPayCount} of ${res.totalUnpaid} unpaid. Nothing was paid.`);
    } catch (err) { notify('⚠️ ' + err.message); }
    finally { setA2uBusy(false); }
  };

  // Actually send — guarded by an explicit confirm dialog
  const handleA2uSend = async () => {
    let opts, label, detail;
    if (a2uMode === 'single') {
      const id = a2uSubmissionId.trim();
      if (!id) return notify('Enter a submissionId to pay.');
      opts = { submissionId: id };
      label = 'Single payout';
      detail = `Submission ${id}`;
    } else {
      const n = parseInt(a2uLimit, 10);
      if (!Number.isInteger(n) || n < 1) return notify('Enter a batch size of 1 or more.');
      opts = { limit: n };
      label = 'Batch payout';
      detail = `Up to ${n} submission${n > 1 ? 's' : ''}, paced one at a time`;
    }
    // Open the styled in-page confirmation modal instead of window.confirm()
    setA2uConfirm({ opts, label, detail });
  };

  const executeA2uSend = async () => {
    const pending = a2uConfirm;
    if (!pending) return;
    setA2uConfirm(null);
    setA2uBusy(true);
    setA2uResult(null);
    try {
      const res = await reconcileA2U(pending.opts);
      setA2uResult(res);
      if (res.dryRun) {
        notify('⚠️ Nothing paid — backend treated this as a dry-run.');
      } else if (res.stoppedForCooldown) {
        notify(`⏸ Pi rate-limited. ${res.succeeded} paid before cooldown — try again shortly.`);
      } else {
        notify(`✅ ${res.succeeded} paid${res.skippedUnpayable ? `, ${res.skippedUnpayable} skipped` : ''}${res.failed ? `, ${res.failed} failed` : ''}.`);
      }
    } catch (err) { notify('⚠️ ' + err.message); }
    finally { setA2uBusy(false); }
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

      {/* Tab bar — mirrors Zappi NG's admin layout: one section at a time */}
      <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', marginBottom: '16px', paddingBottom: '2px' }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              flexShrink: 0, padding: '8px 14px', borderRadius: '20px', border: 'none',
              fontSize: '0.8rem', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap',
              backgroundColor: tab === t.key ? '#059669' : 'white',
              color: tab === t.key ? 'white' : '#4a5568',
              boxShadow: tab === t.key ? '0 2px 8px rgba(5,150,105,0.35)' : '0 1px 3px rgba(0,0,0,0.06)',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'tasks' && (
      <>
      {/* Sponsored task creation */}
      <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '14px', marginBottom: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <button
          onClick={() => setShowForm(f => !f)}
          style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 0 }}
        >
          <span style={{ fontWeight: '700', color: '#047857', fontSize: '0.9rem' }}>📌 Create Sponsored Task</span>
          <span style={{ color: '#047857', fontSize: '1.1rem', fontWeight: '700' }}>{showForm ? '−' : '+'}</span>
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
              style={{ marginTop: '10px', width: '100%', backgroundColor: creating ? '#a0aec0' : '#047857', color: 'white', border: 'none', padding: '10px', borderRadius: '8px', fontWeight: '700', cursor: creating ? 'not-allowed' : 'pointer', fontSize: '0.88rem' }}>
              {creating ? '⏳ Creating…' : '🚀 Create & Publish Task'}
            </button>
          </div>
        )}
      </div>
      </>
      )}

      {tab === 'payouts' && (
      <>
      {/* Reconcile pending A2U payouts */}
      <button onClick={handleReconcile} disabled={reconciling}
        style={{ width: '100%', marginBottom: '14px', padding: '10px', backgroundColor: reconciling ? '#a0aec0' : '#2d3748', color: 'white', border: 'none', borderRadius: '10px', cursor: reconciling ? 'not-allowed' : 'pointer', fontWeight: '700', fontSize: '0.82rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
        <span style={{ display: 'inline-block', animation: reconciling ? 'spin 0.8s linear infinite' : 'none' }}>🔄</span>
        {reconciling ? 'Checking pending payouts…' : 'Reconcile Pending A2U Payouts'}
      </button>

      {/* Cancel stale "awaiting_funding" tasks */}
      <div style={{ backgroundColor: '#fff5f5', border: '1.5px solid #fed7d7', borderRadius: '12px', padding: '14px', marginBottom: '14px' }}>
        <div style={{ fontWeight: '700', color: '#c53030', fontSize: '0.85rem', marginBottom: '4px' }}>
          🚫 Cancel Stale Pending-Funding Tasks
        </div>
        <p style={{ fontSize: '0.72rem', color: '#718096', margin: '0 0 10px' }}>
          Tasks stuck in "awaiting_funding" because the Pi payment never completed (e.g. testnet key switch, user closed wallet). Cancelling tells Pi to release the hold and removes the task from the poster's queue.
        </p>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select value={staleCutoff} onChange={e => setStaleCutoff(e.target.value)}
            style={{ padding: '7px 10px', borderRadius: '8px', border: '1.5px solid #fed7d7', fontSize: '0.82rem', backgroundColor: 'white', color: '#2d3748', flex: 1 }}>
            <option value="1">Older than 1 hour</option>
            <option value="6">Older than 6 hours</option>
            <option value="24">Older than 24 hours</option>
            <option value="72">Older than 3 days</option>
            <option value="168">Older than 7 days</option>
          </select>
          <button onClick={handleCancelStale} disabled={cancelling}
            style={{ backgroundColor: cancelling ? '#a0aec0' : '#c53030', color: 'white', border: 'none', padding: '8px 14px', borderRadius: '8px', fontWeight: '700', cursor: cancelling ? 'not-allowed' : 'pointer', fontSize: '0.82rem', flexShrink: 0 }}>
            {cancelling ? 'Cancelling…' : '🚫 Cancel'}
          </button>
        </div>
      </div>

      {/* Admin: flush backlogged A2U payouts (fail-safe, button-driven) */}
      <div style={{ backgroundColor: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: '12px', padding: '14px', marginBottom: '14px' }}>
        <div style={{ fontWeight: '700', color: '#b45309', fontSize: '0.85rem', marginBottom: '4px' }}>
          🪙 Reconcile A2U Payouts
        </div>
        <p style={{ fontSize: '0.72rem', color: '#718096', margin: '0 0 10px' }}>
          Flushes approved submissions that were credited in-balance but never paid on-chain. Sends REAL testnet A2U (signs blockchain txns). Pi allows one A2U at a time — verify each completes before the next. Preview pays nothing.
        </p>

        <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
          <button onClick={() => setA2uMode('single')}
            style={{ flex: 1, padding: '6px', borderRadius: '8px', border: '1.5px solid #fde68a', fontSize: '0.76rem', fontWeight: '700', cursor: 'pointer', backgroundColor: a2uMode === 'single' ? '#b45309' : 'white', color: a2uMode === 'single' ? 'white' : '#b45309' }}>
            Single
          </button>
          <button onClick={() => setA2uMode('batch')}
            style={{ flex: 1, padding: '6px', borderRadius: '8px', border: '1.5px solid #fde68a', fontSize: '0.76rem', fontWeight: '700', cursor: 'pointer', backgroundColor: a2uMode === 'batch' ? '#b45309' : 'white', color: a2uMode === 'batch' ? 'white' : '#b45309' }}>
            Batch
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
          {a2uMode === 'single' ? (
            <input value={a2uSubmissionId} onChange={e => setA2uSubmissionId(e.target.value)}
              placeholder="submissionId"
              style={{ padding: '7px 10px', borderRadius: '8px', border: '1.5px solid #fde68a', fontSize: '0.82rem', backgroundColor: 'white', color: '#2d3748', flex: 1 }} />
          ) : (
            <input value={a2uLimit} onChange={e => setA2uLimit(e.target.value)}
              type="number" min="1" placeholder="batch size"
              style={{ padding: '7px 10px', borderRadius: '8px', border: '1.5px solid #fde68a', fontSize: '0.82rem', backgroundColor: 'white', color: '#2d3748', width: '110px' }} />
          )}
          <button onClick={handleA2uPreview} disabled={a2uBusy}
            style={{ backgroundColor: a2uBusy ? '#a0aec0' : '#0369a1', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '8px', fontWeight: '700', cursor: a2uBusy ? 'not-allowed' : 'pointer', fontSize: '0.78rem', flexShrink: 0 }}>
            👀 Preview
          </button>
          <button onClick={handleA2uSend} disabled={a2uBusy}
            style={{ backgroundColor: a2uBusy ? '#a0aec0' : '#b45309', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '8px', fontWeight: '700', cursor: a2uBusy ? 'not-allowed' : 'pointer', fontSize: '0.78rem', flexShrink: 0 }}>
            {a2uBusy ? 'Working…' : '💸 Send'}
          </button>
        </div>

        {a2uPreview && (
          <div style={{ fontSize: '0.72rem', color: '#4a5568', backgroundColor: 'white', border: '1px solid #fde68a', borderRadius: '8px', padding: '8px', marginTop: '4px' }}>
            Would pay <b>{a2uPreview.wouldPayCount}</b> of {a2uPreview.totalUnpaid} unpaid
            {a2uPreview.receivedSubmissionId && <span> · target <code>{a2uPreview.receivedSubmissionId}</code></span>}:
            {(a2uPreview.wouldPay || []).map((p, i) => (
              <div key={i} style={{ marginTop: '3px', fontFamily: 'monospace', fontSize: '0.68rem' }}>
                @{p.worker} · {p.pi}π · <span style={{ color: '#b45309' }}>{p.id}</span>
                {a2uMode === 'single' && (
                  <button onClick={() => setA2uSubmissionId(p.id)}
                    style={{ marginLeft: '6px', fontSize: '0.62rem', padding: '1px 5px', borderRadius: '5px', border: '1px solid #fde68a', backgroundColor: '#fffbeb', color: '#b45309', cursor: 'pointer' }}>
                    use
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {a2uResult && !a2uResult.dryRun && (
          <div style={{ fontSize: '0.72rem', color: '#166534', backgroundColor: 'white', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '8px', marginTop: '8px' }}>
            <b>{a2uResult.mode}</b> — {a2uResult.succeeded} paid
            {a2uResult.skippedUnpayable ? `, ${a2uResult.skippedUnpayable} skipped (unpayable)` : ''}
            {a2uResult.failed ? `, ${a2uResult.failed} failed` : ''}
            {a2uResult.rateLimitedRetries ? `, ${a2uResult.rateLimitedRetries} rate-limit retries` : ''}
            {' '}(attempted {a2uResult.attempted}).
            {a2uResult.stoppedForCooldown && (
              <div style={{ marginTop: '4px', color: '#b45309', fontWeight: 700 }}>
                ⏸ Pi rate-limited — run stopped for cooldown. Wait a while, then run again for the rest.
              </div>
            )}
            {(a2uResult.results || []).map((r, i) => {
              let line, color;
              if (r.paymentId) { line = `✓ @${r.worker} ${r.pi}π · ${r.paymentId}`; color = '#166534'; }
              else if (r.info) { line = `⏳ @${r.worker}: ${r.info}`; color = '#b45309'; }
              else if (r.skipped) { line = `⤼ @${r.worker}: skipped (unpayable, ${r.httpStatus})`; color = '#6b7280'; }
              else if (r.skippedDueToStop) { line = `· ${r.id}: not attempted (cooldown stop)`; color = '#9ca3af'; }
              else if (r.stopped) { line = `■ stopped: ${r.reason}`; color = '#c53030'; }
              else if (r.error) { line = `✗ ${r.worker || r.id}: ${r.error}`; color = '#c53030'; }
              else { line = JSON.stringify(r); color = '#6b7280'; }
              return (
                <div key={i} style={{ marginTop: '3px', fontFamily: 'monospace', fontSize: '0.66rem', color, wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
                  {line}
                </div>
              );
            })}
          </div>
        )}

        {/* Styled payout confirmation modal (replaces native confirm) */}
        {staleConfirm && (
          <div
            onClick={() => setStaleConfirm(false)}
            style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ width: '100%', maxWidth: '380px', backgroundColor: 'white', borderRadius: '16px', boxShadow: '0 20px 50px rgba(0,0,0,0.3)', overflow: 'hidden' }}
            >
              <div style={{ background: 'linear-gradient(135deg, #b91c1c, #dc2626)', padding: '18px 20px', color: 'white' }}>
                <div style={{ fontSize: '1.6rem', lineHeight: 1 }}>🧹</div>
                <div style={{ fontWeight: 800, fontSize: '1.02rem', marginTop: '8px' }}>Sweep stale funding tasks</div>
                <div style={{ fontSize: '0.76rem', opacity: 0.92, marginTop: '2px' }}>Tasks stuck in “awaiting_funding” &gt; {staleCutoff}h</div>
              </div>
              <div style={{ padding: '18px 20px' }}>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#334155', lineHeight: 1.5 }}>
                  Each task’s Pi payment is checked on-chain first:
                </p>
                <ul style={{ margin: '8px 0 0', padding: '0 0 0 18px', fontSize: '0.74rem', color: '#64748b', lineHeight: 1.6 }}>
                  <li><b style={{ color: '#16a34a' }}>Completed</b> payments are recovered — the task is set live.</li>
                  <li><b style={{ color: '#b91c1c' }}>Genuinely unpaid</b> tasks are cancelled.</li>
                  <li>Tasks whose Pi status can’t be read are skipped for a later run.</li>
                </ul>
                <div style={{ marginTop: '10px', fontSize: '0.72rem', color: '#b45309', backgroundColor: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', padding: '8px 10px' }}>
                  ⚠️ This cannot be undone.
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', padding: '0 20px 20px' }}>
                <button
                  onClick={() => setStaleConfirm(false)}
                  style={{ flex: 1, padding: '11px', borderRadius: '10px', border: '1.5px solid #e2e8f0', backgroundColor: 'white', color: '#475569', fontWeight: 700, fontSize: '0.84rem', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={executeCancelStale}
                  style={{ flex: 1.4, padding: '11px', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg, #b91c1c, #dc2626)', color: 'white', fontWeight: 800, fontSize: '0.84rem', cursor: 'pointer', boxShadow: '0 4px 12px rgba(185,28,28,0.35)' }}
                >
                  Sweep now
                </button>
              </div>
            </div>
          </div>
        )}

        {a2uConfirm && (
          <div
            onClick={() => setA2uConfirm(null)}
            style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ width: '100%', maxWidth: '380px', backgroundColor: 'white', borderRadius: '16px', boxShadow: '0 20px 50px rgba(0,0,0,0.3)', overflow: 'hidden' }}
            >
              <div style={{ background: 'linear-gradient(135deg, #b45309, #d97706)', padding: '18px 20px', color: 'white' }}>
                <div style={{ fontSize: '1.6rem', lineHeight: 1 }}>💸</div>
                <div style={{ fontWeight: 800, fontSize: '1.02rem', marginTop: '8px' }}>Confirm {a2uConfirm.label}</div>
                <div style={{ fontSize: '0.76rem', opacity: 0.92, marginTop: '2px' }}>Real testnet A2U — moves funds on-chain</div>
              </div>
              <div style={{ padding: '18px 20px' }}>
                <div style={{ fontSize: '0.82rem', color: '#334155', backgroundColor: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '10px', padding: '10px 12px', fontFamily: 'monospace' }}>
                  {a2uConfirm.detail}
                </div>
                <ul style={{ margin: '12px 0 0', padding: '0 0 0 18px', fontSize: '0.74rem', color: '#64748b', lineHeight: 1.6 }}>
                  <li>Each payment signs a blockchain transaction.</li>
                  <li>Pi processes one A2U at a time; sends are paced automatically.</li>
                  <li>Unpayable recipients are skipped, not retried.</li>
                </ul>
              </div>
              <div style={{ display: 'flex', gap: '10px', padding: '0 20px 20px' }}>
                <button
                  onClick={() => setA2uConfirm(null)}
                  style={{ flex: 1, padding: '11px', borderRadius: '10px', border: '1.5px solid #e2e8f0', backgroundColor: 'white', color: '#475569', fontWeight: 700, fontSize: '0.84rem', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={executeA2uSend}
                  style={{ flex: 1.4, padding: '11px', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg, #b45309, #d97706)', color: 'white', fontWeight: 800, fontSize: '0.84rem', cursor: 'pointer', boxShadow: '0 4px 12px rgba(180,83,9,0.35)' }}
                >
                  Confirm &amp; Send
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Admin: consolidated payout — one lump-sum per worker */}
      <div style={{ backgroundColor: '#ecfdf5', border: '1.5px solid #a7f3d0', borderRadius: '12px', padding: '14px', marginBottom: '14px' }}>
        <div style={{ fontWeight: '700', color: '#047857', fontSize: '0.85rem', marginBottom: '4px' }}>
          🧮 Consolidated Payout
        </div>
        <p style={{ fontSize: '0.72rem', color: '#6b7280', margin: '0 0 10px' }}>
          Pays each worker ONE lump sum covering all their pending tasks — far fewer A2U calls, so it clears a backlog with minimal rate-limit hits. Preview pays nothing.
        </p>

        <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '0.72rem', color: '#047857', marginBottom: '10px', cursor: 'pointer' }}>
          <input type="checkbox" checked={consIncludeSkipped} onChange={e => { setConsIncludeSkipped(e.target.checked); setConsPreview(null); }} />
          Retry previously-skipped (for wallets now activated on-chain)
        </label>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={handleConsPreview} disabled={consBusy}
            style={{ flex: 1, backgroundColor: consBusy ? '#a0aec0' : '#0369a1', color: 'white', border: 'none', padding: '9px', borderRadius: '8px', fontWeight: '700', cursor: consBusy ? 'not-allowed' : 'pointer', fontSize: '0.8rem' }}>
            🧮 Preview
          </button>
          <button onClick={handleConsSend} disabled={consBusy || !consPreview}
            style={{ flex: 1, backgroundColor: (consBusy || !consPreview) ? '#a0aec0' : '#047857', color: 'white', border: 'none', padding: '9px', borderRadius: '8px', fontWeight: '700', cursor: (consBusy || !consPreview) ? 'not-allowed' : 'pointer', fontSize: '0.8rem' }}>
            {consBusy ? 'Working…' : '💸 Pay (max 5)'}
          </button>
        </div>

        {consPreview && (
          <div style={{ fontSize: '0.72rem', color: '#374151', backgroundColor: 'white', border: '1px solid #a7f3d0', borderRadius: '8px', padding: '9px', marginTop: '10px' }}>
            <b>{consPreview.totalSubmissions}</b> tasks → <b>{consPreview.paymentsNeeded}</b> payment{consPreview.paymentsNeeded === 1 ? '' : 's'} · {consPreview.totalPi}π
            {(consPreview.workers || []).map((w, i) => (
              <div key={i} style={{ marginTop: '3px', fontFamily: 'monospace', fontSize: '0.67rem' }}>
                @{w.worker} · {w.count} task{w.count === 1 ? '' : 's'} → <b style={{ color: '#047857' }}>{Number(w.pi.toFixed(4))}π</b>
              </div>
            ))}
          </div>
        )}

        {consResult && (
          <div style={{ fontSize: '0.72rem', color: '#166534', backgroundColor: 'white', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '9px', marginTop: '8px' }}>
            <b>{consResult.workersPaid}</b> worker{consResult.workersPaid === 1 ? '' : 's'} paid · {consResult.submissionsPaid} tasks · {consResult.piPaid}π
            {consResult.skipped ? `, ${consResult.skipped} skipped` : ''}{consResult.failed ? `, ${consResult.failed} failed` : ''}
            {consResult.stoppedForCooldown && (
              <div style={{ marginTop: '4px', color: '#b45309', fontWeight: 700 }}>⏸ Rate-limited — run again later for the rest.</div>
            )}
            {(consResult.results || []).filter(r => r.paymentId || r.error || r.skipped).map((r, i) => (
              <div key={i} style={{ marginTop: '3px', fontFamily: 'monospace', fontSize: '0.66rem', color: r.paymentId ? '#166534' : (r.skipped ? '#6b7280' : '#c53030'), wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
                {r.paymentId ? `✓ @${r.worker} ${r.pi}π (${r.covered} task${r.covered === 1 ? '' : 's'})`
                  : r.skipped ? `⤼ @${r.worker}: skipped (unpayable)`
                  : `✗ @${r.worker}: ${r.error}`}
              </div>
            ))}
          </div>
        )}

        {consConfirm && (
          <div onClick={() => setConsConfirm(null)}
            style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
            <div onClick={(e) => e.stopPropagation()}
              style={{ width: '100%', maxWidth: '380px', backgroundColor: 'white', borderRadius: '16px', boxShadow: '0 20px 50px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
              <div style={{ background: 'linear-gradient(135deg, #047857, #059669)', padding: '18px 20px', color: 'white' }}>
                <div style={{ fontSize: '1.6rem', lineHeight: 1 }}>🧮</div>
                <div style={{ fontWeight: 800, fontSize: '1.02rem', marginTop: '8px' }}>Confirm consolidated payout</div>
                <div style={{ fontSize: '0.76rem', opacity: 0.92, marginTop: '2px' }}>Real testnet A2U — moves funds on-chain</div>
              </div>
              <div style={{ padding: '18px 20px' }}>
                <div style={{ fontSize: '0.82rem', color: '#334155', backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '10px', padding: '10px 12px', fontFamily: 'monospace' }}>
                  Up to {consConfirm.maxWorkers} worker{consConfirm.maxWorkers === 1 ? '' : 's'} — one lump-sum payment each
                </div>
                <ul style={{ margin: '12px 0 0', padding: '0 0 0 18px', fontSize: '0.74rem', color: '#64748b', lineHeight: 1.6 }}>
                  <li>Each worker’s pending tasks are paid in a single A2U.</li>
                  <li>Paced one at a time; backs off if Pi rate-limits.</li>
                  <li>Unpayable recipients are skipped, not retried.</li>
                </ul>
              </div>
              <div style={{ display: 'flex', gap: '10px', padding: '0 20px 20px' }}>
                <button onClick={() => setConsConfirm(null)}
                  style={{ flex: 1, padding: '11px', borderRadius: '10px', border: '1.5px solid #e2e8f0', backgroundColor: 'white', color: '#475569', fontWeight: 700, fontSize: '0.84rem', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={executeConsSend}
                  style={{ flex: 1.4, padding: '11px', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg, #047857, #059669)', color: 'white', fontWeight: 800, fontSize: '0.84rem', cursor: 'pointer', boxShadow: '0 4px 12px rgba(4,120,87,0.35)' }}>
                  Confirm &amp; Pay
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Admin: review submissions auto-skipped as unpayable */}
      <div style={{ backgroundColor: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '14px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: '700', color: '#475569', fontSize: '0.85rem' }}>📋 Unpayable Submissions</div>
          <button onClick={handleLoadUnpayable} disabled={unpayableLoading}
            style={{ backgroundColor: unpayableLoading ? '#a0aec0' : '#475569', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '8px', fontWeight: '700', cursor: unpayableLoading ? 'not-allowed' : 'pointer', fontSize: '0.74rem' }}>
            {unpayableLoading ? 'Loading…' : 'Review'}
          </button>
        </div>
        <p style={{ fontSize: '0.72rem', color: '#94a3b8', margin: '6px 0 0' }}>
          Submissions skipped because the recipient couldn't be paid on-chain (e.g. unresolvable Pi account). These were not retried and moved no funds.
        </p>

        {unpayable && (
          <div style={{ marginTop: '10px' }}>
            <div style={{ fontSize: '0.76rem', color: '#334155', fontWeight: 700, marginBottom: '6px' }}>
              {unpayable.total} skipped · {unpayable.totalPi}π · {unpayable.byWorker.length} account{unpayable.byWorker.length === 1 ? '' : 's'}
            </div>
            {unpayable.byWorker.map((w, i) => (
              <div key={i} style={{ fontSize: '0.7rem', color: '#475569', backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '7px 9px', marginBottom: '5px', fontFamily: 'monospace' }}>
                @{w.worker} · {w.count} sub{w.count === 1 ? '' : 's'} · {Number(w.totalPi.toFixed(4))}π
                {w.piUid && <div style={{ color: '#94a3b8', fontSize: '0.64rem', marginTop: '2px' }}>uid {w.piUid}</div>}
              </div>
            ))}
            {unpayable.total === 0 && (
              <div style={{ fontSize: '0.72rem', color: '#16a34a' }}>✓ No unpayable submissions — nothing was skipped.</div>
            )}
          </div>
        )}
      </div>
      </>
      )}

      {tab === 'announcements' && (
      <AdminAnnouncements notify={notify} />
      )}

      {tab === 'banners' && (
      <AdminBanners notify={notify} />
      )}

      {tab === 'users' && (
      <>
      {/* Moderation: remove an inappropriate profile picture */}
      <div style={{ backgroundColor: '#fff5f5', border: '1.5px solid #fed7d7', borderRadius: '12px', padding: '14px', marginBottom: '14px' }}>
        <div style={{ fontWeight: '700', color: '#c53030', fontSize: '0.85rem', marginBottom: '4px' }}>
          🖼️ Remove Profile Picture
        </div>
        <p style={{ fontSize: '0.72rem', color: '#718096', margin: '0 0 10px' }}>
          Clears an inappropriate avatar and blocks that user from re-uploading. Use “Unblock” to allow uploads again.
        </p>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
          <input value={avatarUid} onChange={e => setAvatarUid(e.target.value)}
            placeholder="piUid of the user"
            style={{ padding: '7px 10px', borderRadius: '8px', border: '1.5px solid #fed7d7', fontSize: '0.82rem', backgroundColor: 'white', color: '#2d3748', flex: 1 }} />
          <button onClick={() => handleAvatarModeration(false)} disabled={avatarModBusy || !avatarUid.trim()}
            style={{ backgroundColor: (avatarModBusy || !avatarUid.trim()) ? '#a0aec0' : '#c53030', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '8px', fontWeight: '700', cursor: (avatarModBusy || !avatarUid.trim()) ? 'not-allowed' : 'pointer', fontSize: '0.8rem', flexShrink: 0 }}>
            {avatarModBusy ? '…' : 'Remove'}
          </button>
          <button onClick={() => handleAvatarModeration(true)} disabled={avatarModBusy || !avatarUid.trim()}
            style={{ backgroundColor: 'white', color: '#c53030', border: '1.5px solid #fed7d7', padding: '8px 12px', borderRadius: '8px', fontWeight: '700', cursor: (avatarModBusy || !avatarUid.trim()) ? 'not-allowed' : 'pointer', fontSize: '0.8rem', flexShrink: 0 }}>
            Unblock
          </button>
        </div>
        {avatarModMsg && (
          <div style={{ fontSize: '0.75rem', color: '#276749', backgroundColor: '#f0fff4', padding: '8px 10px', borderRadius: '8px', wordBreak: 'break-word' }}>
            {avatarModMsg}
          </div>
        )}
      </div>

      {/* Support: worker payment lookup */}
      <div style={{ backgroundColor: '#f0f9ff', border: '1.5px solid #bae6fd', borderRadius: '12px', padding: '14px', marginBottom: '14px' }}>
        <div style={{ fontWeight: '700', color: '#0369a1', fontSize: '0.85rem', marginBottom: '4px' }}>
          💸 Worker Payment Lookup
        </div>
        <p style={{ fontSize: '0.72rem', color: '#718096', margin: '0 0 10px' }}>
          For "I didn't get paid" cases. Cross-checks our DB, the Pi Platform API, and the blockchain (Horizon) for a worker's payouts. Read-only.
        </p>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
          <input value={lookupQuery} onChange={e => setLookupQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleLookup(); }}
            placeholder="username or piUid"
            style={{ padding: '7px 10px', borderRadius: '8px', border: '1.5px solid #bae6fd', fontSize: '0.82rem', backgroundColor: 'white', color: '#2d3748', flex: 1 }} />
          <button onClick={handleLookup} disabled={lookingUp}
            style={{ backgroundColor: lookingUp ? '#a0aec0' : '#0369a1', color: 'white', border: 'none', padding: '8px 14px', borderRadius: '8px', fontWeight: '700', cursor: lookingUp ? 'not-allowed' : 'pointer', fontSize: '0.82rem', flexShrink: 0 }}>
            {lookingUp ? 'Looking…' : '🔍 Look up'}
          </button>
        </div>

        {lookupResult && (
          <div style={{ marginTop: '8px' }}>
            <div style={{ fontSize: '0.78rem', color: '#2d3748', fontWeight: '700', marginBottom: '6px' }}>
              @{lookupResult.worker.username} · {lookupResult.worker.piUid}
              {lookupResult.worker.isBanned && <span style={{ color: '#c53030', marginLeft: '6px' }}>BANNED</span>}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#4a5568', marginBottom: '8px' }}>
              Stored balance: <b>{lookupResult.worker.storedBalancePi}π</b> · Approved: {lookupResult.worker.approvedCount} · Total approved reward: {lookupResult.totalApprovedRewardPi}π
              {lookupResult.approvedSubmissionsWithoutPayout > 0 && (
                <div style={{ color: '#c53030', marginTop: '4px', fontWeight: '700' }}>
                  ⚠️ {lookupResult.approvedSubmissionsWithoutPayout} approved submission(s) have NO linked payout
                </div>
              )}
            </div>
            {lookupResult.payoutCount === 0 ? (
              <div style={{ fontSize: '0.72rem', color: '#718096', fontStyle: 'italic' }}>No A2U worker_payout records for this worker.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {lookupResult.payouts.map((p, i) => {
                  const c = p.verdict === 'paid_confirmed' ? '#16a34a'
                    : p.verdict.startsWith('not_paid') ? '#9ca3af'
                    : p.verdict.startsWith('pending') ? '#d97706'
                    : '#c53030';
                  return (
                    <div key={i} style={{ border: `1px solid ${c}33`, borderLeft: `3px solid ${c}`, borderRadius: '6px', padding: '7px 9px', backgroundColor: 'white' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem' }}>
                        <span style={{ fontWeight: '700', color: c }}>{p.verdict}</span>
                        <span style={{ color: '#2d3748', fontWeight: '700' }}>{p.amountPi}π</span>
                      </div>
                      <div style={{ fontSize: '0.68rem', color: '#718096', marginTop: '2px' }}>
                        db: {p.dbStatus} · pi-api: {p.piApiStatus || '—'} · chain: {p.chain}
                      </div>
                      {p.txid && <div style={{ fontSize: '0.62rem', color: '#a0aec0', wordBreak: 'break-all', marginTop: '2px' }}>tx: {p.txid}</div>}
                      {p.note && <div style={{ fontSize: '0.64rem', color: '#c53030', marginTop: '2px' }}>{p.note}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <button onClick={handleWalletOverview} disabled={walletLoading}
          style={{ width: '100%', marginTop: '10px', padding: '8px', backgroundColor: 'white', color: '#0369a1', border: '1.5px solid #bae6fd', borderRadius: '8px', cursor: walletLoading ? 'not-allowed' : 'pointer', fontWeight: '700', fontSize: '0.78rem' }}>
          {walletLoading ? 'Loading wallet…' : '🏦 Check payout wallet balance & recent payments'}
        </button>
        {wallet && (
          <div style={{ marginTop: '8px', fontSize: '0.72rem', color: '#4a5568' }}>
            {!wallet.exists ? (
              <span style={{ color: '#c53030' }}>Wallet account not found on-chain.</span>
            ) : (
              <>
                <div>Payout wallet balance: <b>{wallet.balancePi}π</b></div>
                <div style={{ marginTop: '4px', color: '#718096' }}>
                  {wallet.recentPayments.length} recent payment(s){wallet.recentPayments.length ? ':' : ''}
                </div>
                {wallet.recentPayments.map((rp, i) => (
                  <div key={i} style={{ fontSize: '0.66rem', color: '#a0aec0', marginTop: '2px' }}>
                    {rp.amount} → {rp.to ? rp.to.slice(0, 8) + '…' : '—'} · {rp.createdAt ? rp.createdAt.slice(0, 10) : ''}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
      </>
      )}

      {tab === 'queue' && (
      <>
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
            <span style={{ background: 'linear-gradient(135deg,#059669,#047857)', color: 'white', padding: '3px 8px', borderRadius: '8px', fontWeight: '800', fontSize: '0.78rem', flexShrink: 0, marginLeft: '8px' }}>
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
                style={{ fontSize: '0.75rem', color: '#059669', display: 'inline-block', marginTop: '4px' }}>
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
      </>
      )}

      <button onClick={onOpenDisputes}
        style={{ width: '100%', marginTop: '8px', backgroundColor: disputeCount > 0 ? '#c53030' : '#718096', color: 'white', border: 'none', padding: '12px', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '0.88rem' }}>
        ⚖️ Dispute Appeals Board ({disputeCount})
      </button>
    </div>
  );
}
