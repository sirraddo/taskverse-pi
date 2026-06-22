import React, { useState, useEffect, useCallback, useRef } from 'react';
import HowItWorks from './HowItWorks';
import PrivacyPolicy from './PrivacyPolicy';
import TermsOfService from './TermsOfService';
import Leaderboard from './Leaderboard';
import PayoutHistory from './PayoutHistory';
import PiLogin from './PiLogin';
import PiAdmin from './PiAdmin';
import PiDisputes from './PiDisputes';
import UserProfile from './UserProfile';
import CreateTask from './CreateTask';
import TaskSubmit from './TaskSubmit';
import MyPostedTasks from './MyPostedTasks';
import { fetchTasks, fetchMe, initPi, openExternalLink } from './piClient';

function inferCategory(title, description) {
const s = ((title || '') + ' ' + (description || '')).toLowerCase();
if (s.includes('video') || s.includes('record') || s.includes('tiktok') || s.includes('youtube')) return 'Content';
if (s.includes('translat')) return 'Translation';
if (s.includes('bug') || s.includes('feature') || s.includes('suggest') || s.includes('report')) return 'Feedback';
if (s.includes('review') || s.includes('write') || s.includes('sentence')) return 'Review';
if (s.includes('invit') || s.includes('friend') || s.includes('refer') || s.includes('sign up')) return 'Referral';
if (s.includes('follow') || s.includes('share') || s.includes('community') || s.includes('like') || s.includes('upvote') || s.includes('telegram')) return 'Social';
return 'Other';
}

const CATEGORY_META = {
All: { emoji: '🌐', color: '#667eea' },
Social: { emoji: '📢', color: '#ed8936' },
Review: { emoji: '✍️', color: '#48bb78' },
Content: { emoji: '🎬', color: '#e53e3e' },
Referral: { emoji: '🤝', color: '#9f7aea' },
Translation: { emoji: '🌍', color: '#38b2ac' },
Feedback: { emoji: '🐛', color: '#f6ad55' },
Other: { emoji: '📋', color: '#718096' },
};

function SkeletonCard() {
return (
<div style={{ backgroundColor: 'white', borderRadius: '14px', padding: '16px', marginBottom: '10px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
<div style={{ flex: 1 }}>
<div style={{ height: '14px', background: 'linear-gradient(90deg,#edf2f7 25%,#e2e8f0 50%,#edf2f7 75%)', backgroundSize: '200% 100%', borderRadius: '7px', width: '70%', marginBottom: '8px', animation: 'shimmer 1.4s infinite' }} />
<div style={{ height: '11px', background: 'linear-gradient(90deg,#edf2f7 25%,#e2e8f0 50%,#edf2f7 75%)', backgroundSize: '200% 100%', borderRadius: '6px', width: '50%', animation: 'shimmer 1.4s infinite' }} />
</div>
<div style={{ width: '52px', height: '44px', background: 'linear-gradient(90deg,#edf2f7 25%,#e2e8f0 50%,#edf2f7 75%)', backgroundSize: '200% 100%', borderRadius: '10px', animation: 'shimmer 1.4s infinite', flexShrink: 0 }} />
</div>
<div style={{ marginTop: '12px', height: '5px', background: '#edf2f7', borderRadius: '3px' }} />
<div style={{ marginTop: '10px', height: '36px', background: '#edf2f7', borderRadius: '10px' }} />
</div>
);
}

const translations = {
en: { title: "TaskVerse Pi", wallet: "Balance", availableGigs: "Available Tasks", profile: "Profile", postTask: "+ Post Task", openTask: "Start", full: "Full", adminBtn: "Moderation Queue", alertSubmit: "Proof sent for review!", alertAutoApproved: "Auto-approved! Payout queued.", alertRejected: "Submission failed quality check:", alertPublish: "Task listed on global feed!", loading: "Loading...", empty: "No matching tasks — check back soon!", slotsLeft: "slots left", search: "Search tasks...", tasksDone: "tasks done" },
es: { title: "TaskVerse Pi", wallet: "Saldo", availableGigs: "Tareas Disponibles", profile: "Perfil", postTask: "+ Publicar", openTask: "Iniciar", full: "Lleno", adminBtn: "Moderacion", alertSubmit: "Prueba enviada!", alertAutoApproved: "Aprobado! Pago en camino.", alertRejected: "No paso el control:", alertPublish: "Tarea publicada!", loading: "Cargando...", empty: "Sin tareas - vuelve pronto!", slotsLeft: "cupos", search: "Buscar...", tasksDone: "tareas hechas" },
vi: { title: "TaskVerse Pi", wallet: "So du", availableGigs: "Viec Co San", profile: "Ho so", postTask: "+ Dang Viec", openTask: "Bat Dau", full: "Het", adminBtn: "Hang Doi", alertSubmit: "Da gui bang chung!", alertAutoApproved: "Tu dong duyet!", alertRejected: "Khong dat:", alertPublish: "Da dang!", loading: "Dang tai...", empty: "Chua co viec!", slotsLeft: "cho", search: "Tim viec...", tasksDone: "viec xong" },
};

export default function App() {
const [lang, setLang] = useState('en');
const t = translations[lang];
const [user, setUser] = useState(null);
const [view, setView] = useState('feed');
const [selectedTask, setSelectedTask] = useState(null);
const [tasks, setTasks] = useState(null);
const [notification, setNotification] = useState(null);
const [screen, setScreen] = useState(null);
const [categoryFilter, setCategoryFilter] = useState('All');
const [searchQuery, setSearchQuery] = useState('');
const [refreshing, setRefreshing] = useState(false);

useEffect(() => { try { initPi(); } catch (_) {} }, []);

const triggerNotification = useCallback((msg) => {
setNotification(msg);
setTimeout(() => setNotification(null), 4000);
}, []);

const refresh = useCallback(async () => {
try {
const [feed, me] = await Promise.all([fetchTasks(), fetchMe()]);
setTasks(feed);
// Only merge a valid profile, and never let an error-shaped payload (lacking
// username) clobber the logged-in user and unmount the admin panel.
if (me && me.username) {
setUser((prev) => ({ ...prev, ...me, isAdmin: me.isAdmin ?? prev?.isAdmin }));
}
} catch (err) { triggerNotification('Warning: ' + err.message); }
}, [triggerNotification]);

const handleManualRefresh = useCallback(async () => {
if (refreshing) return;
setRefreshing(true);
await refresh();
setRefreshing(false);
}, [refresh, refreshing]);

useEffect(() => {
if (!user) return;
refresh();
const onFocus = () => refresh();
window.addEventListener('focus', onFocus);
return () => window.removeEventListener('focus', onFocus);
}, [Boolean(user)]);

const lastApprovedRef = useRef(null);

useEffect(() => {
if (!user) return;
if (lastApprovedRef.current === null) lastApprovedRef.current = user.approvedCount ?? 0;
const interval = setInterval(async () => {
try {
const me = await fetchMe();
const prev = lastApprovedRef.current;
if (me.approvedCount > prev) {
const earned = me.approvedCount - prev;
triggerNotification('Payout received! ' + earned + ' task' + (earned > 1 ? 's' : '') + ' approved. Balance: ' + Number(me.balance).toFixed(2) + ' pi');
lastApprovedRef.current = me.approvedCount;
}
setUser(prev => (me && me.username) ? ({ ...prev, ...me, isAdmin: me.isAdmin ?? prev?.isAdmin }) : prev);
} catch (_) {}
}, 30_000);
return () => clearInterval(interval);
}, [Boolean(user)]);

useEffect(() => {
if (!user) return;
const interval = setInterval(async () => {
try { const feed = await fetchTasks(); setTasks(feed); } catch (_) {}
}, 60_000);
return () => clearInterval(interval);
}, [Boolean(user)]);

const handleSubmitted = (result) => {
setView('feed');
if (result.status === 'auto_approved') triggerNotification(t.alertAutoApproved);
else triggerNotification(t.alertSubmit);
refresh();
};
const handleSubmitRejected = (reasons) => { triggerNotification(t.alertRejected + ' ' + (reasons?.[0] || '')); };

if (!user) {
return (
<div style={{ maxWidth: '500px', margin: '0 auto', minHeight: '100vh', backgroundColor: '#f4f6fb', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
<PiLogin onLoginSuccess={(profile) => setUser(profile)} />
</div>
);
}

const enriched = (tasks || []).map(tk => ({ ...tk, category: inferCategory(tk.title, tk.description) }));
const cats = ['All', ...Array.from(new Set(enriched.map(tk => tk.category))).sort()];
const filtered = enriched.filter(tk => {
const matchCat = categoryFilter === 'All' || tk.category === categoryFilter;
const q = searchQuery.toLowerCase();
const matchSearch = !q || (tk.title || '').toLowerCase().includes(q) || (tk.description || '').toLowerCase().includes(q);
return matchCat && matchSearch;
});

const disputeCount = (user.openDisputes || []).length;

return (
<div style={{ maxWidth: '500px', margin: '0 auto', minHeight: '100vh', backgroundColor: '#f4f6fb', position: 'relative', paddingBottom: '40px' }}>
<style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}@keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}@keyframes spin{to{transform:rotate(360deg)}}`}</style>

{notification && (
<div style={{ position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)', backgroundColor: '#1a202c', color: 'white', padding: '11px 20px', borderRadius: '28px', zIndex: 1000, boxShadow: '0 4px 20px rgba(0,0,0,0.25)', fontWeight: '700', fontSize: '0.85rem', maxWidth: '88%', textAlign: 'center' }}>
{notification}
</div>
)}

{screen && (
<div style={{ position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '500px', bottom: 0, backgroundColor: '#f4f6fb', zIndex: 500, overflowY: 'auto' }}>
{screen === 'history' && <PayoutHistory onBack={() => setScreen(null)} />}
{screen === 'leaderboard' && <Leaderboard onBack={() => setScreen(null)} />}
{screen === 'privacy' && <PrivacyPolicy onBack={() => setScreen(null)} />}
{screen === 'terms' && <TermsOfService onBack={() => setScreen(null)} />}
{screen === 'howitworks' && <HowItWorks onBack={() => setScreen(null)} />}
{screen === 'myTasks' && <MyPostedTasks tasks={user.postedTasks || []} onBack={() => setScreen(null)} />}
</div>
)}

{view === 'admin' && user.isAdmin && <PiAdmin onBack={() => setView('feed')} onOpenDisputes={() => setView('disputes')} notify={triggerNotification} />}
{view === 'disputes' && user.isAdmin && <PiDisputes onBack={() => setView('admin')} notify={triggerNotification} onResolved={refresh} />}
{view === 'profile' && (
<div style={{ padding: '20px' }}>
<UserProfile user={user} onBack={() => setView('feed')} onRefresh={refresh} />
</div>
)}
{view === 'create' && <div style={{ padding: '20px' }}><CreateTask onBack={() => setView('feed')} onPublished={() => { triggerNotification(t.alertPublish); setView('feed'); refresh(); }} /></div>}
{view === 'submit' && selectedTask && (
<div style={{ padding: '20px' }}>
<TaskSubmit activeTask={selectedTask} onBack={() => setView('feed')} onSubmitted={handleSubmitted} onRejected={handleSubmitRejected} />
</div>
)}

{view === 'feed' && (
<div style={{ padding: '16px' }}>
{/* Nav */}
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
<button onClick={() => setView('profile')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.92rem', color: '#4a5568', fontWeight: '700', position: 'relative' }}>
👤 {t.profile}
{disputeCount > 0 && (
<span style={{ position: 'absolute', top: '-4px', right: '-10px', backgroundColor: '#c53030', color: 'white', borderRadius: '50%', width: '16px', height: '16px', fontSize: '0.55rem', fontWeight: '800', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
{disputeCount}
</span>
)}
</button>
<select value={lang} onChange={e => setLang(e.target.value)} style={{ padding: '4px 8px', borderRadius: '16px', border: '1px solid #cbd5e0', backgroundColor: 'white', fontWeight: '600', color: '#4a5568', fontSize: '0.78rem' }}>
<option value="en">🇬🇧 EN</option><option value="es">🇪🇸 ES</option><option value="vi">🇻🇳 VI</option>
</select>
<button onClick={() => setView('create')} style={{ backgroundColor: '#764ba2', color: 'white', border: 'none', padding: '7px 14px', borderRadius: '20px', cursor: 'pointer', fontWeight: '700', fontSize: '0.82rem' }}>{t.postTask}</button>
</div>

{/* Wallet card */}
<div style={{ background: 'linear-gradient(135deg,#667eea 0%,#764ba2 100%)', color: 'white', padding: '20px', borderRadius: '18px', marginBottom: '14px', boxShadow: '0 6px 24px rgba(102,126,234,0.4)', position: 'relative', overflow: 'hidden' }}>
<div style={{ position: 'absolute', top: '-25px', right: '-20px', width: '110px', height: '110px', borderRadius: '50%', background: 'rgba(255,255,255,0.07)' }} />
<div style={{ fontSize: '0.72rem', opacity: 0.85, marginBottom: '4px', fontWeight: '600' }}>
{user.username}
{user.isKycVerified && <span style={{ marginLeft: '6px', background: 'rgba(255,255,255,0.22)', padding: '1px 7px', borderRadius: '8px', fontSize: '0.65rem' }}>⚡ KYC</span>}
</div>
<div style={{ fontSize: '0.7rem', opacity: 0.7, marginBottom: '1px' }}>{t.wallet}</div>
<div style={{ fontSize: '2.2rem', fontWeight: '800', letterSpacing: '-1px', lineHeight: 1.1 }}>{Number(user.balance ?? 0).toFixed(2)} <span style={{ fontSize: '1rem', opacity: 0.85 }}>π</span></div>
<div style={{ fontSize: '0.7rem', opacity: 0.65, marginTop: '4px' }}>✅ {user.approvedCount ?? 0} {t.tasksDone}</div>
</div>

{/* Search */}
<div style={{ position: 'relative', marginBottom: '10px' }}>
<span style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', opacity: 0.35, fontSize: '0.85rem' }}>🔍</span>
<input type="text" placeholder={t.search} value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
style={{ width: '100%', boxSizing: 'border-box', padding: '9px 32px 9px 32px', borderRadius: '12px', border: '1.5px solid #e2e8f0', backgroundColor: 'white', fontSize: '0.86rem', outline: 'none', color: '#2d3748', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }} />
{searchQuery && <button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.4, fontSize: '0.8rem', padding: 0 }}>✕</button>}
</div>

{/* Category pills */}
{cats.length > 1 && (
<div className="no-scrollbar" style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '8px', marginBottom: '12px', scrollbarWidth: 'none' }}>
{cats.map(cat => {
const m = CATEGORY_META[cat] || CATEGORY_META.Other;
const active = categoryFilter === cat;
return (
<button key={cat} onClick={() => setCategoryFilter(cat)} style={{ flexShrink: 0, padding: '5px 11px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontWeight: '700', fontSize: '0.74rem', whiteSpace: 'nowrap', backgroundColor: active ? m.color : 'white', color: active ? 'white' : '#4a5568', boxShadow: active ? ('0 2px 8px ' + m.color + '55') : '0 1px 3px rgba(0,0,0,0.07)' }}>
{m.emoji} {cat}
</button>
);
})}
</div>
)}

{/* Section header with manual refresh */}
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
<h2 style={{ margin: 0, fontSize: '0.97rem', fontWeight: '700', color: '#2d3748' }}>{t.availableGigs}</h2>
<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
{tasks !== null && <span style={{ fontSize: '0.72rem', color: '#a0aec0', fontWeight: '600' }}>{filtered.length} {filtered.length === 1 ? 'task' : 'tasks'}</span>}
<button onClick={handleManualRefresh} disabled={refreshing} title="Refresh tasks"
style={{ background: 'none', border: 'none', cursor: refreshing ? 'not-allowed' : 'pointer', fontSize: '0.95rem', opacity: refreshing ? 0.4 : 0.6, padding: '2px 4px', display: 'flex', alignItems: 'center', transition: 'opacity 0.2s' }}>
<span style={{ display: 'inline-block', animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }}>🔄</span>
</button>
</div>
</div>

{/* Skeletons */}
{tasks === null && [1,2,3].map(i => <SkeletonCard key={i} />)}

{/* Empty state */}
{tasks !== null && filtered.length === 0 && (
<div style={{ textAlign: 'center', padding: '48px 20px' }}>
<div style={{ fontSize: '2.8rem', marginBottom: '10px' }}>{searchQuery ? '🔍' : '📭'}</div>
<p style={{ color: '#718096', fontWeight: '600', margin: '0 0 12px 0', fontSize: '0.9rem' }}>{t.empty}</p>
{(searchQuery || categoryFilter !== 'All') && (
<button onClick={() => { setSearchQuery(''); setCategoryFilter('All'); }} style={{ background: 'none', border: '1.5px solid #cbd5e0', padding: '6px 16px', borderRadius: '20px', cursor: 'pointer', color: '#4a5568', fontSize: '0.8rem', fontWeight: '600' }}>Clear filters</button>
)}
</div>
)}

{/* Task cards */}
{filtered.map(task => {
const isFull = task.slotsLeft <= 0;
const slotsFilled = task.slotsFilled || 0;
const totalSlots = task.slots || (task.slotsLeft + slotsFilled);
const pct = totalSlots > 0 ? Math.round((slotsFilled / totalSlots) * 100) : 0;
const urgency = task.slotsLeft > 0 && task.slotsLeft <= 5;
const m = CATEGORY_META[task.category] || CATEGORY_META.Other;
const snippet = (task.description || '').slice(0, 92) + ((task.description || '').length > 92 ? '…' : '');
const barColor = pct > 80 ? '#e53e3e' : pct > 55 ? '#ed8936' : '#48bb78';
return (
<div key={task.id} style={{ backgroundColor: 'white', borderRadius: '14px', padding: '14px 14px 12px', marginBottom: '10px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', opacity: isFull ? 0.65 : 1, animation: 'fadeUp 0.3s ease' }}>
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '10px' }}>
<div style={{ flex: 1 }}>
<div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '5px' }}>
<span style={{ background: m.color + '18', color: m.color, padding: '2px 8px', borderRadius: '10px', fontSize: '0.67rem', fontWeight: '700' }}>{m.emoji} {task.category}</span>
{urgency && <span style={{ background: '#fff5f5', color: '#e53e3e', padding: '2px 7px', borderRadius: '10px', fontSize: '0.65rem', fontWeight: '700' }}>🔥 {task.slotsLeft} left!</span>}
</div>
<h3 style={{ margin: '0 0 3px', fontSize: '0.93rem', fontWeight: '700', color: '#1a202c', lineHeight: 1.3 }}>{task.title}</h3>
{snippet && <p style={{ margin: 0, fontSize: '0.76rem', color: '#718096', lineHeight: 1.4 }}>{snippet}</p>}
{task.link && /^https?:\/\//i.test(task.link) && <a href={task.link} onClick={(e) => { e.preventDefault(); openExternalLink(task.link); }} style={{ display: 'inline-block', marginTop: '6px', fontSize: '0.74rem', color: '#667eea', fontWeight: '700', textDecoration: 'none' }}>🔗 Open task link</a>}
</div>
<div style={{ flexShrink: 0, background: 'linear-gradient(135deg,#667eea,#764ba2)', color: 'white', padding: '7px 10px', borderRadius: '11px', textAlign: 'center', minWidth: '46px' }}>
<div style={{ fontSize: '1rem', fontWeight: '800', lineHeight: 1 }}>{task.reward}</div>
<div style={{ fontSize: '0.6rem', opacity: 0.85, fontWeight: '600' }}>π</div>
</div>
</div>

{totalSlots > 0 && (
<div style={{ marginBottom: '10px' }}>
<div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
<span style={{ fontSize: '0.65rem', color: '#a0aec0', fontWeight: '600' }}>{task.slotsLeft} {t.slotsLeft}</span>
<span style={{ fontSize: '0.65rem', color: '#a0aec0', fontWeight: '600' }}>{pct}% claimed</span>
</div>
<div style={{ height: '5px', backgroundColor: '#edf2f7', borderRadius: '3px', overflow: 'hidden' }}>
<div style={{ height: '100%', width: pct + '%', backgroundColor: barColor, borderRadius: '3px', transition: 'width 0.6s ease' }} />
</div>
</div>
)}

<button
onClick={() => { if (!isFull && !task.userDone) { setSelectedTask(task); setView('submit'); } }}
disabled={isFull || task.userDone}
style={{ width: '100%', backgroundColor: isFull ? '#edf2f7' : task.userDone ? '#c6f6d5' : '#667eea', color: isFull ? '#a0aec0' : task.userDone ? '#276749' : 'white', border: 'none', padding: '10px', borderRadius: '10px', cursor: (isFull || task.userDone) ? 'not-allowed' : 'pointer', fontWeight: '700', fontSize: '0.84rem' }}>
{isFull ? 'Task Full' : task.userDone ? 'Done ✅' : t.openTask + ' →'}
</button>
</div>
);
})}

{/* Admin */}
{user.isAdmin && (
<button onClick={() => setView('admin')} style={{ width: '100%', marginTop: '16px', backgroundColor: '#edf2f7', border: 'none', padding: '10px', borderRadius: '10px', color: '#718096', cursor: 'pointer', fontSize: '0.82rem', fontWeight: '600' }}>🔧 {t.adminBtn}</button>
)}

{/* Bottom nav */}
<div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
<button onClick={() => setScreen('leaderboard')} style={{ flex: 1, padding: '11px', backgroundColor: 'white', border: '1.5px solid #e2e8f0', borderRadius: '12px', cursor: 'pointer', fontWeight: '700', color: '#667eea', fontSize: '0.82rem', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>🏆 Board</button>
<button onClick={() => setScreen('history')} style={{ flex: 1, padding: '11px', backgroundColor: 'white', border: '1.5px solid #e2e8f0', borderRadius: '12px', cursor: 'pointer', fontWeight: '700', color: '#667eea', fontSize: '0.82rem', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>📜 History</button>
<button onClick={() => setScreen('myTasks')} style={{ flex: 1, padding: '11px', backgroundColor: 'white', border: '1.5px solid #e2e8f0', borderRadius: '12px', cursor: 'pointer', fontWeight: '700', color: '#764ba2', fontSize: '0.82rem', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>📌 My Tasks</button>
</div>
<div style={{ display: 'flex', justifyContent: 'center', gap: '18px', marginTop: '10px', paddingBottom: '12px', fontSize: '0.7rem', color: '#b0bac8' }}>
<span onClick={() => setScreen('howitworks')} style={{ cursor: 'pointer', textDecoration: 'underline' }}>How It Works</span>
<span onClick={() => setScreen('privacy')} style={{ cursor: 'pointer', textDecoration: 'underline' }}>Privacy</span>
<span onClick={() => setScreen('terms')} style={{ cursor: 'pointer', textDecoration: 'underline' }}>Terms</span>
</div>
</div>
)}
</div>
);
}
