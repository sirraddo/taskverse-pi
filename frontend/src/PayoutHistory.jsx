import { useState, useEffect } from 'react';

export default function PayoutHistory({ onBack }) {
  const [history, setHistory] = useState(null);
  const [total, setTotal] = useState(0);
  const API = import.meta.env.VITE_API_URL || 'https://taskverse-pi.onrender.com';

  useEffect(() => {
    fetch(API + '/api/me/history', { credentials: 'include' })
      .then(r => r.json())
      .then(data => { setHistory(data.submissions || []); setTotal(data.totalEarned || 0); })
      .catch(() => setHistory([]));
  }, []);

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '500px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <button onClick={onBack} style={{ background: 'none', border: '1px solid #cbd5e0', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer' }}>Back</button>
        <h2 style={{ margin: 0 }}>&#128220; Payout History</h2>
      </div>
      {history !== null && (
        <div style={{ background: 'linear-gradient(135deg, #667eea, #764ba2)', color: 'white', padding: '20px', borderRadius: '12px', marginBottom: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: '0.85rem', opacity: 0.85 }}>Total Earned</div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{Number(total).toFixed(2)} &#960;</div>
          <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>{history.length} submissions</div>
        </div>
      )}
      {history === null && [1,2,3].map(i => <div key={i} style={{ height: '72px', backgroundColor: '#edf2f7', borderRadius: '10px', marginBottom: '10px' }} />)}
      {history?.length === 0 && <div style={{ textAlign: 'center', padding: '40px', color: '#a0aec0' }}><p>No submissions yet.</p></div>}
      {history?.map((sub) => {
        const isPaid = ['auto_approved','approved'].includes(sub.status);
        const date = new Date(sub.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        return (
          <div key={sub._id} style={{ backgroundColor: 'white', padding: '14px', borderRadius: '10px', marginBottom: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 'bold', color: '#2d3748', fontSize: '0.9rem' }}>{sub.task?.title || 'Task removed'}</div>
              <div style={{ fontSize: '0.75rem', color: '#a0aec0' }}>{date}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 'bold', color: isPaid ? '#48bb78' : '#e53e3e' }}>{isPaid ? '+' : ''}{(sub.rewardMicroPi / 1e6).toFixed(2)} &#960;</div>
              <span style={{ backgroundColor: isPaid ? '#f0fff4' : '#fff5f5', color: isPaid ? '#48bb78' : '#e53e3e', padding: '2px 8px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 'bold' }}>{isPaid ? 'Paid' : sub.status}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
