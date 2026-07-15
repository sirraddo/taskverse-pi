import { useState } from 'react';
import Receipt from './Receipt';

export default function MyPostedTasks({ tasks, onBack }) {
const [receiptTask, setReceiptTask] = useState(null);
if (!tasks) return null;

const statusBadge = {
live:             { label: '🟢 Live',            color: '#276749', bg: '#c6f6d5' },
awaiting_funding: { label: '⏳ Pending Funding',   color: '#744210', bg: '#fefcbf' },
exhausted:        { label: '✅ All Slots Filled',  color: '#2c5282', bg: '#bee3f8' },
cancelled:        { label: '🚫 Cancelled',       color: '#742a2a', bg: '#fff5f5' },
paused:           { label: '⏸️ Paused',        color: '#553c1a', bg: '#fef3c7' },
};

const STATUS_LABEL_PLAIN = {
  live: 'Live', awaiting_funding: 'Pending funding', exhausted: 'All slots filled',
  cancelled: 'Cancelled', paused: 'Paused',
};

return (
<div style={{ padding: '20px', maxWidth: '500px', margin: '0 auto', fontFamily: 'sans-serif' }}>
<div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
<button onClick={onBack} style={{ background: 'var(--surface)', border: '1px solid var(--border-strong)', padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-muted)', fontWeight: '500', boxShadow: '0 1px 3px var(--shadow-color)' }}>← Back</button>
<h2 style={{ margin: 0, color: 'var(--text)' }}>📌 My Posted Tasks</h2>
</div>

{tasks.length === 0 && (
<div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-faintest)' }}>
<div style={{ fontSize: '2.8rem', marginBottom: '10px' }}>📭</div>
<p style={{ fontWeight: '700', margin: '0 0 6px', color: 'var(--text-faint)' }}>No tasks posted yet</p>
<p style={{ fontSize: '0.82rem', margin: 0 }}>Use "+ Post Task" to create and fund your first task.</p>
</div>
)}

{tasks.map(task => {
const pct = task.slots > 0 ? Math.round((task.slotsFilled / task.slots) * 100) : 0;
const barColor = pct >= 100 ? '#e53e3e' : pct > 55 ? '#ed8936' : '#48bb78';
const badge = statusBadge[task.status] || { label: task.status, color: '#718096', bg: '#edf2f7' };
return (
<div key={task.id} style={{ backgroundColor: 'var(--surface)', borderRadius: '14px', padding: '14px 16px', marginBottom: '10px', boxShadow: '0 2px 10px var(--shadow-color)', animation: 'fadeUp 0.3s ease' }}>
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
<div style={{ flex: 1, minWidth: 0 }}>
<span style={{ display: 'inline-block', backgroundColor: badge.bg, color: badge.color, padding: '2px 9px', borderRadius: '10px', fontSize: '0.67rem', fontWeight: '700', marginBottom: '5px' }}>
{badge.label}
</span>
<h3 style={{ margin: 0, fontSize: '0.93rem', fontWeight: '700', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
{task.title}
</h3>
{task.fundingRefId && (
<div onClick={() => setReceiptTask(task)}
  style={{ fontSize: '0.65rem', color: 'var(--text-faintest)', marginTop: '2px', fontFamily: 'monospace', cursor: 'pointer', textDecoration: 'underline', display: 'inline-block' }}>
Ref: {task.fundingRefId}
</div>
)}
</div>
<div style={{ background: 'linear-gradient(135deg,#059669,#047857)', color: 'white', padding: '7px 10px', borderRadius: '11px', textAlign: 'center', minWidth: '52px', flexShrink: 0, marginLeft: '10px' }}>
<div style={{ fontSize: '1rem', fontWeight: '800', lineHeight: 1 }}>{Number(task.reward).toFixed(2)}</div>
<div style={{ fontSize: '0.58rem', opacity: 0.85, fontWeight: '600' }}>π/slot</div>
</div>
</div>
<div>
<div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
<span style={{ fontSize: '0.72rem', color: 'var(--text-faint)', fontWeight: '600' }}>
{task.slotsFilled} / {task.slots} slots filled
</span>
<span style={{ fontSize: '0.72rem', fontWeight: '700', color: pct >= 100 ? '#e53e3e' : pct > 55 ? '#ed8936' : '#48bb78' }}>
{pct}%
</span>
</div>
<div style={{ height: '6px', backgroundColor: 'var(--surface-alt)', borderRadius: '3px', overflow: 'hidden' }}>
<div style={{ height: '100%', width: pct + '%', backgroundColor: barColor, borderRadius: '3px', transition: 'width 0.6s ease' }} />
</div>
</div>
</div>
);
})}

{receiptTask && (
<Receipt
  kind="funding"
  title={receiptTask.title}
  amountPi={(Number(receiptTask.reward) * receiptTask.slots).toFixed(2)}
  refId={receiptTask.fundingRefId}
  status={STATUS_LABEL_PLAIN[receiptTask.status] || receiptTask.status}
  date={new Date(receiptTask.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
  onClose={() => setReceiptTask(null)}
/>
)}
</div>
);
}
