import { useState, useEffect } from 'react';
import { fetchLeaderboard } from './piClient';

const PERIODS = [
  { key: 'week',  label: '7 Days' },
  { key: 'month', label: '30 Days' },
  { key: 'all',   label: 'All Time' },
];

export default function Leaderboard({ onBack }) {
  const [period, setPeriod] = useState('week');
  const [entries, setEntries] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setEntries(null);
    setLoading(true);
    fetchLeaderboard(period)
      .then(data => {
        if (!Array.isArray(data)) { setEntries([]); return; }
        // Deduplicate by username — keep highest tasksCompleted per user
        const map = new Map();
        data.forEach(u => {
          const ex = map.get(u.username);
          if (!ex || u.tasksCompleted > ex.tasksCompleted) map.set(u.username, u);
        });
        setEntries([...map.values()].sort((a, b) => b.tasksCompleted - a.tasksCompleted));
      })
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [period]);

  const medals = ['🥇', '🥈', '🥉'];

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '500px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <button onClick={onBack} style={{ background: 'var(--surface)', border: '1px solid var(--border-strong)', padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-muted)', fontWeight: '500', boxShadow: '0 1px 3px var(--shadow-color)' }}>← Back</button>
        <h2 style={{ margin: 0, color: 'var(--text)' }}>🏆 Leaderboard</h2>
      </div>

      {/* Period tabs */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)}
            style={{ flex: 1, padding: '8px 0', borderRadius: '10px', border: 'none', cursor: 'pointer', fontWeight: '700', fontSize: '0.78rem',
              backgroundColor: period === p.key ? '#059669' : 'var(--surface)',
              color: period === p.key ? 'white' : 'var(--text-faint)',
              boxShadow: period === p.key ? '0 2px 8px rgba(5,150,105,0.4)' : '0 1px 3px var(--shadow-color)',
              transition: 'all 0.15s ease' }}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Skeleton */}
      {(entries === null || loading) && [1,2,3].map(i => (
        <div key={i} style={{ height: '64px', backgroundColor: 'var(--surface-alt)', borderRadius: '10px', marginBottom: '10px', animation: 'shimmer 1.4s infinite', background: 'linear-gradient(90deg,var(--surface-alt) 25%,var(--border) 50%,var(--surface-alt) 75%)', backgroundSize: '200% 100%' }} />
      ))}

      {/* Empty */}
      {entries !== null && !loading && entries.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-faintest)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>🏅</div>
          <p style={{ fontWeight: '600', margin: 0 }}>No entries yet for this period</p>
          <p style={{ fontSize: '0.82rem', marginTop: '4px' }}>Complete tasks to appear here!</p>
        </div>
      )}

      {/* Entries */}
      {!loading && (entries || []).map((entry, index) => (
        <div key={entry.username} style={{ backgroundColor: 'var(--surface)', padding: '14px 16px', borderRadius: '12px', marginBottom: '8px', boxShadow: '0 1px 6px var(--shadow-color)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontSize: '1.4rem', width: '34px', textAlign: 'center', flexShrink: 0 }}>
            {index < 3 ? medals[index] : <span style={{ fontWeight: '800', color: 'var(--text-faintest)', fontSize: '0.95rem' }}>#{index + 1}</span>}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: '700', color: 'var(--text-secondary)', fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.username}</div>
            <div style={{ fontSize: '0.73rem', color: 'var(--text-faintest)', marginTop: '1px' }}>
              {entry.tasksCompleted || 0} task{entry.tasksCompleted !== 1 ? 's' : ''} completed
            </div>
          </div>
          <div style={{ fontWeight: '800', color: '#059669', fontSize: '1rem', flexShrink: 0 }}>
            {Number(entry.totalEarned || 0).toFixed(2)} π
          </div>
        </div>
      ))}

      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
    </div>
  );
}
