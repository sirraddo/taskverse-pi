import { useState, useEffect } from 'react';
import { fetchLeaderboard } from './piClient';

export default function Leaderboard({ onBack }) {
const [entries, setEntries] = useState(null);

useEffect(() => {
fetchLeaderboard()
.then(data => {
if (!Array.isArray(data)) { setEntries([]); return; }
// Fix #1: API returns tasksCompleted + totalEarned (not tasksDone / earned)
const map = new Map();
data.forEach(u => {
const existing = map.get(u.username);
if (!existing || u.tasksCompleted > existing.tasksCompleted) map.set(u.username, u);
});
setEntries([...map.values()].sort((a, b) => b.tasksCompleted - a.tasksCompleted));
})
.catch(() => setEntries([]));
}, []);

const medals = ['🥇', '🥈', '🥉'];

return (
<div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '500px', margin: '0 auto' }}>
<div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
<button onClick={onBack} style={{ background: 'white', border: '1px solid #d1d5db', padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem', color: '#374151', fontWeight: '500', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>← Back</button>
<h2 style={{ margin: 0 }}>🏆 Leaderboard</h2>
</div>

{entries === null && [1,2,3].map(i => (
<div key={i} style={{ height: '64px', backgroundColor: '#edf2f7', borderRadius: '10px', marginBottom: '10px' }} />
))}

{entries !== null && entries.length === 0 && (
<div style={{ textAlign: 'center', padding: '40px', color: '#a0aec0' }}>
<p>No entries yet. Complete tasks to appear here!</p>
</div>
)}

{(entries || []).map((entry, index) => (
<div key={entry.username} style={{ backgroundColor: 'white', padding: '14px 16px', borderRadius: '10px', marginBottom: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: '12px' }}>
<div style={{ fontSize: '1.4rem', width: '32px', textAlign: 'center' }}>
{index < 3 ? medals[index] : <span style={{ fontWeight: 'bold', color: '#a0aec0', fontSize: '1rem' }}>#{index + 1}</span>}
</div>
<div style={{ flex: 1 }}>
<div style={{ fontWeight: 'bold', color: '#2d3748', fontSize: '0.95rem' }}>{entry.username}</div>
<div style={{ fontSize: '0.75rem', color: '#a0aec0' }}>
{entry.tasksCompleted || 0} task{entry.tasksCompleted !== 1 ? 's' : ''} completed
</div>
</div>
<div style={{ fontWeight: 'bold', color: '#667eea', fontSize: '1rem' }}>
{Number(entry.totalEarned || 0).toFixed(2)} π
</div>
</div>
))}
</div>
);
}
