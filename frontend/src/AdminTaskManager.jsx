import { useState, useEffect, useCallback } from 'react';
import { fetchAdminTasks, removeAdminTask, fetchTaskReports, dismissTaskReports } from './piClient';

/** Running tasks with a Remove button — takes a task off the worker feed. */
export default function AdminTaskManager({ notify, refreshKey = 0 }) {
  const [tasks, setTasks] = useState(null);
  const [busy, setBusy] = useState(null);
  const [reports, setReports] = useState([]);

  const load = useCallback(() => {
    fetchAdminTasks().then(setTasks).catch((e) => { setTasks([]); notify('⚠️ ' + e.message); });
    fetchTaskReports().then(setReports).catch(() => {});
  }, [notify]);
  // Reload when the parent says a task was created, then keep it fresh.
  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [load, refreshKey]);

  const remove = async (t) => {
    if (!window.confirm(`Remove "${t.title}" from the feed?\n\nWorkers will no longer see it. Pending submissions stay in the queue. Escrow left (${t.escrowRemainingPi} π) is not refunded automatically.`)) return;
    setBusy(t.id);
    try {
      await removeAdminTask(t.id);
      setTasks((list) => (list || []).filter((x) => x.id !== t.id));
      setReports((r) => r.filter((x) => String(x.taskId) !== String(t.id)));
      notify('🗑️ Task removed from the feed.');
    } catch (e) { notify('⚠️ ' + e.message); }
    finally { setBusy(null); }
  };

  const dismiss = async (r) => {
    setBusy(r.taskId);
    try { await dismissTaskReports(r.taskId); notify('Reports dismissed.'); load(); }
    catch (e) { notify('⚠️ ' + e.message); }
    finally { setBusy(null); }
  };

  return (
    <>
    {reports.length > 0 && (
      <div style={{ backgroundColor: 'var(--surface)', border: '1.5px solid #c53030', borderRadius: '12px', padding: '14px', marginBottom: '16px' }}>
        <div style={{ fontWeight: '700', color: 'var(--text)', fontSize: '0.9rem', marginBottom: '8px' }}>⚑ Reported tasks ({reports.length})</div>
        {reports.map((r) => (
          <div key={r.taskId} style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
            <div style={{ fontWeight: '600', fontSize: '0.84rem', color: 'var(--text)' }}>{r.title}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginBottom: '6px' }}>{r.count} report(s) · {r.reasons.join(', ')} · {r.status}</div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={() => dismiss(r)} disabled={busy === r.taskId} style={{ padding: '6px 12px', borderRadius: '8px', border: '1.5px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-muted)', fontWeight: '700', fontSize: '0.74rem', cursor: 'pointer' }}>Dismiss</button>
              <button onClick={() => remove({ id: r.taskId, title: r.title, escrowRemainingPi: '?' })} disabled={busy === r.taskId} style={{ padding: '6px 12px', borderRadius: '8px', border: 'none', backgroundColor: '#c53030', color: 'white', fontWeight: '700', fontSize: '0.74rem', cursor: 'pointer' }}>Remove task</button>
            </div>
          </div>
        ))}
      </div>
    )}
    <div style={{ backgroundColor: 'var(--surface)', borderRadius: '12px', padding: '14px', marginBottom: '16px', boxShadow: '0 2px 8px var(--shadow-color)' }}>
      <div style={{ fontWeight: '700', color: 'var(--text)', fontSize: '0.9rem', marginBottom: '8px' }}>
        🗂️ Running tasks {tasks !== null && <span style={{ color: 'var(--text-faintest)' }}>({tasks.length})</span>}
      </div>
      {tasks === null && <div style={{ fontSize: '0.8rem', color: 'var(--text-faintest)' }}>Loading…</div>}
      {tasks?.length === 0 && <div style={{ fontSize: '0.8rem', color: 'var(--text-faintest)' }}>No running tasks.</div>}
      {tasks?.map((t) => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: '600', fontSize: '0.84rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>
              @{t.poster} · {t.rewardPi} π · {t.slotsFilled}/{t.slots} filled · {t.status}
            </div>
          </div>
          <button onClick={() => remove(t)} disabled={busy === t.id}
            style={{ flexShrink: 0, padding: '6px 12px', borderRadius: '8px', border: 'none', backgroundColor: '#c53030', color: 'white', fontWeight: '700', fontSize: '0.74rem', cursor: busy === t.id ? 'not-allowed' : 'pointer', opacity: busy === t.id ? 0.6 : 1 }}>
            {busy === t.id ? '…' : 'Remove'}
          </button>
        </div>
      ))}
    </div>
    </>
  );
}
