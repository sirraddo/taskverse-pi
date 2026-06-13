import React, { useState, useMemo } from 'react';
import { createTask, payForTaskFunding } from './piClient';

const FEE_RATE = 0.05; // display only — server recalculates authoritatively

/**
 * PRODUCTION VERSION — posting a task now:
 * 1. Creates the task server-side (status: awaiting_funding)
 * 2. Shows the poster a transparent breakdown: reward pool + 5% fee
 * 3. Opens the real Pi payment for the gross amount
 * 4. Task goes live only after on-chain completion
 */
export default function CreateTask({ onPublished, onBack }) {
  const [title, setTitle] = useState('');
  const [reward, setReward] = useState('');
  const [slots, setSlots] = useState('1');
  const [phase, setPhase] = useState('form'); // form | paying | done
  const [error, setError] = useState(null);

  const breakdown = useMemo(() => {
    const r = parseFloat(reward) || 0;
    const s = parseInt(slots, 10) || 0;
    const pool = r * s;
    const fee = pool * FEE_RATE;
    return { pool, fee, total: pool + fee };
  }, [reward, slots]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setPhase('paying');
    try {
      // 1. Server creates the campaign and returns the exact amount due
      const { taskId, amountToPay } = await createTask({
        title,
        rewardPi: parseFloat(reward),
        slots: parseInt(slots, 10),
      });
      // 2. Real Pi wallet payment (rewards + platform fee → app wallet)
      await payForTaskFunding({ taskId, amountToPay, title });
      setPhase('done');
      onPublished?.(); // parent refetches the feed
    } catch (err) {
      setError(err.message || 'Funding failed');
      setPhase('form');
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', backgroundColor: 'white', borderRadius: '12px' }}>
      <button onClick={onBack}>← Back</button>
      <h3>Post a Micro-Gig Campaign</h3>

      {phase === 'done' ? (
        <p style={{ color: '#2f855a', fontWeight: 'bold' }}>🚀 Payment confirmed — your gig is live on the feed!</p>
      ) : (
        <form onSubmit={handleSubmit}>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" required maxLength={120} style={{ width: '100%', padding: '10px', marginBottom: '10px' }} />
          <input type="number" step="0.01" min="0.01" value={reward} onChange={(e) => setReward(e.target.value)} placeholder="Reward per worker (π)" required style={{ width: '100%', padding: '10px', marginBottom: '10px' }} />
          <input type="number" min="1" max="1000" value={slots} onChange={(e) => setSlots(e.target.value)} placeholder="Number of worker slots" required style={{ width: '100%', padding: '10px', marginBottom: '10px' }} />

          {breakdown.total > 0 && (
            <div style={{ backgroundColor: '#f7fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', fontSize: '0.9rem', marginBottom: '15px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Reward pool ({slots} × {reward}π)</span><strong>{breakdown.pool.toFixed(2)} π</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#718096' }}><span>Platform hosting fee (5%)</span><span>{breakdown.fee.toFixed(2)} π</span></div>
              <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Total deposit</span><strong>{breakdown.total.toFixed(2)} π</strong></div>
            </div>
          )}

          {error && <p style={{ color: '#c53030', fontSize: '0.9rem' }}>{error}</p>}

          <button type="submit" disabled={phase === 'paying'} style={{ width: '100%', backgroundColor: '#764ba2', color: 'white', border: 'none', padding: '12px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
            {phase === 'paying' ? 'Waiting for Pi Wallet…' : `🚀 Deposit & Publish (${breakdown.total.toFixed(2)} π)`}
          </button>
        </form>
      )}
    </div>
  );
}
