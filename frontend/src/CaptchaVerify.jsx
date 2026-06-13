import React, { useState, useEffect } from 'react';

export default function CaptchaVerify({ onVerifySuccess }) {
  const [num1, setNum1] = useState(0);
  const [num2, setNum2] = useState(0);
  const [userAnswer, setUserAnswer] = useState('');
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    setNum1(Math.floor(Math.random() * 10) + 1);
    setNum2(Math.floor(Math.random() * 10) + 1);
  }, []);

  const checkAnswer = () => {
    if (parseInt(userAnswer) === num1 + num2) {
      setVerified(true);
      onVerifySuccess(true);
    } else {
      alert("Incorrect answer. Please try again.");
      setUserAnswer('');
      setNum1(Math.floor(Math.random() * 10) + 1);
      setNum2(Math.floor(Math.random() * 10) + 1);
    }
  };

  return (
    <div style={{ padding: '15px', backgroundColor: '#fffaf0', border: '1px dashed #ffa500', borderRadius: '8px', marginTop: '15px' }}>
      <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#dd6b20', display: 'block', marginBottom: '8px' }}>🤖 Anti-Bot Security Check:</span>
      
      {!verified ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{num1} + {num2} =</span>
          <input 
            type="number" 
            value={userAnswer}
            onChange={(e) => setUserAnswer(e.target.value)}
            style={{ width: '60px', padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e0' }}
          />
          <button 
            type="button"
            onClick={checkAnswer}
            style={{ backgroundColor: '#ffa500', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            Verify
          </button>
        </div>
      ) : (
        <span style={{ color: '#48bb78', fontWeight: 'bold', fontSize: '0.95rem' }}>✓ Human Verification Passed successfully.</span>
      )}
    </div>
  );
}
