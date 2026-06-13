import React from 'react';

/**
 * PRODUCTION VERSION — receives the merged user object that App.jsx
 * keeps in sync with GET /api/me. Balance, KYC flag, and history are
 * all server truth.
 */
const STATUS_COLORS = {
  approved: '#2f855a', auto_approved: '#2f855a',
  pending: '#b7791f', disputed: '#c53030', rejected: '#718096',
};

export default function UserProfile({ user, onBack }) {
  const history = user.history || [];
  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', backgroundColor: 'white', borderRadius: '12px' }}>
      <button onClick={onBack}>← Back</button>
      <h3>{user.username} {user.isKycVerified && '⚡ KYC Verified'}</h3>
      <p>Escrow balance: <strong>{Number(user.balance ?? 0).toFixed(2)} π</strong></p>
      <p style={{ fontSize: '0.8rem', color: '#a0aec0' }}>
        Approved payouts are sent to your Pi wallet automatically; this balance shows rewards still settling on-chain.
      </p>
      <p style={{ fontSize: '0.85rem', color: '#4a5568' }}>✅ {user.approvedCount ?? 0} tasks approved all-time</p>

      <h4>History</h4>
      {history.length === 0 && <p style={{ color: '#718096' }}>No submissions yet — pick a gig from the feed!</p>}
      {history.map((item, index) => (
        <div key={index} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #edf2f7', fontSize: '0.9rem' }}>
          <span>{item.title}</span>
          <span style={{ color: STATUS_COLORS[item.status] || '#4a5568', fontWeight: 'bold' }}>
            {item.reward} π · {item.status.replace('_', '-')}
          </span>
        </div>
      ))}
    </div>
  );
}
