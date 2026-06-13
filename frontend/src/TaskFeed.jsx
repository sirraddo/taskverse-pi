import React, { useState } from 'react';

export default function TaskFeed() {
  const [piBalance, setPiBalance] = useState(0.00);
  const [tasks, setTasks] = useState([
    { id: 1, title: "Verify 3 AI Image Prompts", reward: 0.15, completed: false },
    { id: 2, title: "Translate Short Web Banner Text", reward: 0.25, completed: false },
    { id: 3, title: "Complete Community Feedback Poll", reward: 0.10, completed: false }
  ]);

  const claimTaskReward = (id, reward) => {
    setTasks(tasks.map(task => task.id === id ? { ...task, completed: true } : task));
    setPiBalance(prev => parseFloat((prev + reward).toFixed(2)));
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', backgroundColor: '#f9f9f9', minHeight: '100vh' }}>
      {/* Top Banner / Wallet */}
      <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white', padding: '20px', borderRadius: '12px', marginBottom: '20px', textAlign: 'center' }}>
        <h1 style={{ margin: '0 0 10px 0' }}>TaskVerse Pi</h1>
        <p style={{ fontSize: '1.2rem', margin: 0 }}>Balance: <strong>{piBalance} π</strong></p>
      </div>

      {/* Task Feed Listing */}
      <h2>Available Micro-Gigs</h2>
      <div>
        {tasks.map(task => (
          <div key={task.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px', backgroundColor: 'white', borderRadius: '8px', marginBottom: '10px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
            <div>
              <h3 style={{ margin: '0 0 5px 0', fontSize: '1rem' }}>{task.title}</h3>
              <span style={{ color: '#4a5568', fontSize: '0.9rem' }}>Reward: {task.reward} π</span>
            </div>
            <button 
              onClick={() => claimTaskReward(task.id, task.reward)}
              disabled={task.completed}
              style={{ backgroundColor: task.completed ? '#cbd5e0' : '#48bb78', color: 'white', border: 'none', padding: '10px 15px', borderRadius: '6px', cursor: task.completed ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}
            >
              {task.completed ? 'Submitted' : 'Claim Task'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
