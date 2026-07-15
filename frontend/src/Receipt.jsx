import { useState } from 'react';
import { downloadReceiptImage } from './piClient';

/**
 * Shareable receipt for a single transaction — used for both worker payouts
 * (kind='payout') and task-funding payments (kind='funding'). Renders as a
 * full-screen overlay so it works the same whichever screen opens it.
 */
export default function Receipt({ kind, title, amountPi, refId, status, date, onClose }) {
  const [copied, setCopied] = useState(false);

  const summaryText = [
    'TaskVerse Earn — ' + (kind === 'payout' ? 'Payout Receipt' : 'Task Funding Receipt'),
    `Amount: ${amountPi} π`,
    `Description: ${title}`,
    `Reference: ${refId || '—'}`,
    `Status: ${status}`,
    `Date: ${date}`,
  ].join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — nothing destructive to fall back to, just skip.
    }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(2px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: '380px', backgroundColor: 'var(--surface)', borderRadius: '18px',
        boxShadow: '0 20px 50px rgba(0,0,0,0.3)', overflow: 'hidden', fontFamily: 'sans-serif',
      }}>
        <div style={{ background: 'linear-gradient(135deg, #059669, #047857)', padding: '20px', color: 'white' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: '700', opacity: 0.85, letterSpacing: '0.04em' }}>
            {kind === 'payout' ? 'PAYOUT RECEIPT' : 'TASK FUNDING RECEIPT'}
          </div>
          <div style={{ fontSize: '2rem', fontWeight: '800', marginTop: '6px' }}>{amountPi} π</div>
        </div>

        <div style={{ padding: '18px 20px' }}>
          <ReceiptRow label="Description" value={title} />
          <ReceiptRow label="Reference" value={refId || '—'} mono />
          <ReceiptRow label="Status" value={status} />
          <ReceiptRow label="Date" value={date} last />

          {copied && (
            <div style={{ fontSize: '0.72rem', color: '#059669', fontWeight: '700', marginBottom: '8px', textAlign: 'center' }}>
              ✓ Copied to clipboard
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
            <button onClick={copy}
              style={{ flex: 1, padding: '11px', borderRadius: '10px', border: '1.5px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-muted)', fontWeight: '700', fontSize: '0.82rem', cursor: 'pointer' }}>
              📋 Copy
            </button>
            <button onClick={() => downloadReceiptImage({ kind, title, amountPi, refId, status, date })}
              style={{ flex: 1.3, padding: '11px', borderRadius: '10px', border: 'none', backgroundColor: '#059669', color: 'white', fontWeight: '700', fontSize: '0.82rem', cursor: 'pointer' }}>
              ⬇️ Save image
            </button>
          </div>
          <button onClick={onClose}
            style={{ width: '100%', marginTop: '8px', padding: '9px', borderRadius: '10px', border: 'none', backgroundColor: 'transparent', color: 'var(--text-faintest)', fontWeight: '600', fontSize: '0.78rem', cursor: 'pointer' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ReceiptRow({ label, value, mono, last }) {
  return (
    <div style={{ marginBottom: last ? '14px' : '12px' }}>
      <div style={{ fontSize: '0.66rem', fontWeight: '700', color: 'var(--text-faintest)', letterSpacing: '0.03em' }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize: '0.86rem', fontWeight: '600', color: 'var(--text-secondary)', marginTop: '2px', fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-word' }}>
        {value}
      </div>
    </div>
  );
}
