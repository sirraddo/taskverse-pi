import { useState, useEffect } from 'react';

export default function Leaderboard({ onBack }) {
  const [entries, setEntries] = useState(null);
  const API = import.meta.env.VITE_API_URL || 'https://taskverse-pi.onrender.com';

  useEffect(() => {
    fetch(API + '/api/leaderboard', { credentials: 'include' })
      .then(r => r.json())
      .then(data => setEntries(Array.isArray(data) ? data : []))
      .catch(() => setEntries([]));
  }, []);

  const medals = ['🥇', '🥈', '🥉'];

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '500px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <button onClick={onBack} style={{ background: 'white', border: '1px solid #d1d5db', padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem', color: '#374151', fontWeight: '500', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>← Back</button>
        <h2 style={{ margin: 0 }}>🏆 Leaderboard</h2>
      </div>

      {entries === null && [1,2,3,4,5].map(i => (
        <div key={i} style={{ height: '64px', backgroundColor: '#edf2f7', borderRadius: '10px', marginBottom: '10px' }} />
      ))}

      {entries?.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#a0aec0' }}>
          <p>No entries yet. Complete tasks to appear here!</p>
        </div>
      )}

      {entries?.map((entry, index) => (
        <div key={entry.userId || index} style={{
          backgroundColor: 'white',
          padding: '14px 16px',
          borderRadius: '10px',
          marginBottom: '8px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <div style={{ fontSize: '1.4rem', width: '32px', textAlign: 'center' }}>
            {index < 3 ? medals[index] : <span style={{ fontWeight: 'bold', color: '#a0aec0', fontSize: '1rem' }}>#{index + 1}</span>}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 'bold', color: '#2d3748', fontSize: '0.95rem' }}>
              {entry.username || entry.userId?.slice(0, 8) || 'Anonymous'}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#a0aec0' }}>
              {entry.count || 0} task{entry.count !== 1 ? 's' : ''} completed
            </div>
          </div>
          <div style={{ fontWeight: 'bold', color: '#667eea', fontSize: '1rem' }}>
            {Number((entry.totalEarned || 0) / 1e6).toFixed(2)} π
          </div>
        </div>
      ))}
    </div>
  );
}
