import React, { useState, useEffect, useCallback } from 'react';

export default function CaptchaVerify({ onVerifySuccess }) {
const [num1, setNum1] = useState(0);
const [num2, setNum2] = useState(0);
const [userAnswer, setUserAnswer] = useState('');
const [verified, setVerified] = useState(false);
const [wrong, setWrong] = useState(false);

const reset = useCallback(() => {
setNum1(Math.floor(Math.random() * 9) + 1);
setNum2(Math.floor(Math.random() * 9) + 1);
setUserAnswer('');
setWrong(false);
}, []);

useEffect(() => { reset(); }, []);

const checkAnswer = () => {
if (parseInt(userAnswer, 10) === num1 + num2) {
setVerified(true);
setWrong(false);
onVerifySuccess(true);
} else {
setWrong(true);
setUserAnswer('');
// New numbers after a brief moment so the user sees the error
setTimeout(reset, 1200);
}
};

const handleKey = (e) => {
if (e.key === 'Enter') checkAnswer();
};

return (
<div style={{ padding: '12px 14px', backgroundColor: '#fffaf0', border: '1.5px dashed', borderColor: verified ? '#9ae6b4' : wrong ? '#fc8181' : '#ffa500', borderRadius: '10px', marginTop: '14px', transition: 'border-color 0.2s' }}>
<span style={{ fontSize: '0.72rem', fontWeight: '700', color: verified ? '#276749' : '#dd6b20', display: 'block', marginBottom: '8px', letterSpacing: '0.04em' }}>
🤖 HUMAN CHECK
</span>

{!verified ? (
<div>
<div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
<span style={{ fontWeight: '800', fontSize: '1.05rem', color: '#2d3748', minWidth: '60px' }}>
{num1} + {num2} = ?
</span>
<input
type="number"
inputMode="numeric"
value={userAnswer}
onChange={(e) => { setUserAnswer(e.target.value); setWrong(false); }}
onKeyDown={handleKey}
placeholder="?"
style={{ width: '56px', padding: '6px 8px', borderRadius: '8px', border: '1.5px solid', borderColor: wrong ? '#fc8181' : '#e2e8f0', fontSize: '1rem', fontWeight: '700', textAlign: 'center', outline: 'none' }}
/>
<button
type="button"
onClick={checkAnswer}
style={{ backgroundColor: '#ffa500', color: 'white', border: 'none', padding: '7px 14px', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '0.84rem' }}
>
Verify
</button>
</div>
{wrong && (
<div style={{ marginTop: '6px', fontSize: '0.75rem', color: '#c53030', fontWeight: '600' }}>
✗ Incorrect — new question coming…
</div>
)}
</div>
) : (
<span style={{ color: '#276749', fontWeight: '700', fontSize: '0.88rem' }}>✓ Human verification passed</span>
)}
</div>
);
}
