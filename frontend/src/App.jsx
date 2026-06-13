import React, { useState, useEffect, useCallback } from 'react';
import PiLogin from './PiLogin';
import PiAdmin from './PiAdmin';
import PiDisputes from './PiDisputes';
import UserProfile from './UserProfile';
import CreateTask from './CreateTask';
import TaskSubmit from './TaskSubmit';
import { fetchTasks, fetchMe } from './piClient';

/**
 * PRODUCTION App.jsx
 *
 * Architectural rules applied throughout:
 *  - The server is the only source of truth. No local balance math,
 *    no local queue mutation. Every action = API call → refetch.
 *  - The admin button only renders for user.isAdmin (server-verified);
 *    the backend enforces it regardless, the UI just stops advertising it.
 *  - Auto-review verdicts from the server drive the notifications.
 */

const translations = {
  en: { title: "TaskVerse Pi", wallet: "Wallet", availableGigs: "Available Micro-Gigs", profile: "👤 Profile", postTask: "+ Post Task", openTask: "Open Task", full: "Full", adminBtn: "⚙️ Open Moderation Queue", alertSubmit: "✓ Proof sent to TaskVerse review system!", alertAutoApproved: "⚡ Auto-approved! Payout queued to your wallet.", alertRejected: "✕ Submission failed quality check:", alertPublish: "🚀 Gig listed on global feed!", loading: "Loading gigs…", empty: "No open gigs right now — check back soon or post one!", slotsLeft: "slots left" },
  es: { title: "TaskVerse Pi", wallet: "Billetera", availableGigs: "Microtareas Disponibles", profile: "👤 Perfil", postTask: "+ Publicar Tarea", openTask: "Abrir Tarea", full: "Completo", adminBtn: "⚙️ Abrir Cola de Moderación", alertSubmit: "✓ ¡Prueba enviada al sistema de revisión!", alertAutoApproved: "⚡ ¡Aprobado automáticamente! Pago en camino.", alertRejected: "✕ El envío no pasó el control de calidad:", alertPublish: "🚀 ¡Tarea publicada!", loading: "Cargando tareas…", empty: "No hay tareas abiertas ahora — ¡vuelve pronto o publica una!", slotsLeft: "cupos" },
  vi: { title: "TaskVerse Pi", wallet: "Ví điện tử", availableGigs: "Việc Nhỏ Có Sẵn", profile: "👤 Hồ sơ", postTask: "+ Đăng Việc", openTask: "Mở Việc", full: "Đã đủ", adminBtn: "⚙️ Mở Hàng Đợi Kiểm Duyệt", alertSubmit: "✓ Minh chứng đã gửi đến hệ thống duyệt!", alertAutoApproved: "⚡ Tự động duyệt! Thanh toán đang được gửi.", alertRejected: "✕ Bài nộp không đạt kiểm tra chất lượng:", alertPublish: "🚀 Việc nhỏ đã được đăng!", loading: "Đang tải việc…", empty: "Chưa có việc nào — quay lại sau hoặc đăng một việc!", slotsLeft: "chỗ trống" }
};

export default function App() {
  const [lang, setLang] = useState('en');
  const t = translations[lang];

  const [user, setUser] = useState(null);          // from /api/auth/verify
  const [view, setView] = useState('feed');
  const [selectedTask, setSelectedTask] = useState(null);
  const [tasks, setTasks] = useState(null);        // null = loading
  const [notification, setNotification] = useState(null);

  const triggerNotification = useCallback((msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 4000);
  }, []);

  /* Single refresh path: feed + my profile (balance, KYC, history) */
  const refresh = useCallback(async () => {
    try {
      const [feed, me] = await Promise.all([fetchTasks(), fetchMe()]);
      setTasks(feed);
      setUser((prev) => ({ ...prev, ...me }));
    } catch (err) {
      triggerNotification(`⚠️ ${err.message}`);
    }
  }, [triggerNotification]);

  useEffect(() => {
    if (!user) return;
    refresh();
    // Re-sync when the Pi Browser tab regains focus
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(user)]);

  /* Submission result comes from the server's auto-review engine */
  const handleSubmitted = (result) => {
    setView('feed');
    if (result.status === 'auto_approved') triggerNotification(t.alertAutoApproved);
    else triggerNotification(t.alertSubmit);
    refresh();
  };

  const handleSubmitRejected = (reasons) => {
    triggerNotification(`${t.alertRejected} ${reasons?.[0] || ''}`);
  };

  if (!user) {
    return (
      <div style={{ maxWidth: '500px', margin: '0 auto', minHeight: '100vh', backgroundColor: '#f9f9f9', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <PiLogin onLoginSuccess={(profile) => setUser(profile)} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '500px', margin: '0 auto', minHeight: '100vh', backgroundColor: '#f9f9f9', position: 'relative', paddingBottom: '40px' }}>
      {notification && (
        <div style={{ position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)', backgroundColor: '#2d3748', color: 'white', padding: '12px 24px', borderRadius: '30px', zIndex: 1000, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', fontWeight: 'bold', fontSize: '0.9rem', width: '80%', textAlign: 'center' }}>
          {notification}
        </div>
      )}

      {view === 'admin' && user.isAdmin && (
        <PiAdmin
          onBack={() => setView('feed')}
          onOpenDisputes={() => setView('disputes')}
          notify={triggerNotification}
        />
      )}

      {view === 'disputes' && user.isAdmin && (
        <PiDisputes onBack={() => setView('admin')} notify={triggerNotification} onResolved={refresh} />
      )}

      {view === 'profile' && (
        <div style={{ padding: '20px' }}>
          <UserProfile user={user} onBack={() => setView('feed')} />
        </div>
      )}

      {view === 'create' && (
        <div style={{ padding: '20px' }}>
          <CreateTask
            onBack={() => setView('feed')}
            onPublished={() => { triggerNotification(t.alertPublish); setView('feed'); refresh(); }}
          />
        </div>
      )}

      {view === 'submit' && selectedTask && (
        <div style={{ padding: '20px' }}>
          <TaskSubmit
            activeTask={selectedTask}
            onBack={() => setView('feed')}
            onSubmitted={handleSubmitted}
            onRejected={handleSubmitRejected}
          />
        </div>
      )}

      {view === 'feed' && (
        <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <button onClick={() => setView('profile')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: '#4a5568', fontWeight: 'bold' }}>{t.profile}</button>
            <select value={lang} onChange={(e) => setLang(e.target.value)} style={{ padding: '5px 10px', borderRadius: '20px', border: '1px solid #cbd5e0', backgroundColor: 'white', fontWeight: 'bold', color: '#4a5568' }}>
              <option value="en">🇺🇸 English</option>
              <option value="es">🇪🇸 Español</option>
              <option value="vi">🇻🇳 Tiếng Việt</option>
            </select>
            <button onClick={() => setView('create')} style={{ backgroundColor: '#764ba2', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '20px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}>{t.postTask}</button>
          </div>

          <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white', padding: '20px', borderRadius: '12px', marginBottom: '20px', textAlign: 'center', position: 'relative' }}>
            <span style={{ position: 'absolute', top: '10px', left: '15px', fontSize: '0.75rem', opacity: 0.9, backgroundColor: 'rgba(255,255,255,0.2)', padding: '2px 8px', borderRadius: '10px', fontWeight: 'bold' }}>
              👤 {user.username} {user.isKycVerified && '✓'}
            </span>
            <h1 style={{ margin: '20px 0 5px 0', fontSize: '1.8rem' }}>{t.title}</h1>
            {/* Balance is server truth from GET /api/me — never computed locally */}
            <p style={{ fontSize: '1.1rem', margin: 0 }}>{t.wallet}: <strong>{Number(user.balance ?? 0).toFixed(2)} π</strong></p>
          </div>

          {/* Ad slot #1 would go here — see README §5 (Pi Ad Network) */}

          <h2>{t.availableGigs}</h2>

          {tasks === null && <p style={{ color: '#718096' }}>{t.loading}</p>}
          {tasks?.length === 0 && <p style={{ color: '#718096' }}>{t.empty}</p>}

          {tasks?.map((task) => {
            const isFull = task.slotsLeft <= 0;
            return (
              <div key={task.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px', backgroundColor: 'white', borderRadius: '8px', marginBottom: '10px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                <div>
                  <h3 style={{ margin: '0 0 5px 0', fontSize: '1rem' }}>{task.title}</h3>
                  <span style={{ color: '#4a5568', fontSize: '0.9rem' }}>
                    Reward: {task.reward} π · {task.slotsLeft} {t.slotsLeft}
                  </span>
                </div>
                <button
                  onClick={() => { setSelectedTask(task); setView('submit'); }}
                  disabled={isFull}
                  style={{ backgroundColor: isFull ? '#cbd5e0' : '#48bb78', color: 'white', border: 'none', padding: '10px 15px', borderRadius: '6px', cursor: isFull ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}
                >
                  {isFull ? t.full : t.openTask}
                </button>
              </div>
            );
          })}

          {user.isAdmin && (
            <button onClick={() => setView('admin')} style={{ width: '100%', marginTop: '40px', backgroundColor: '#e2e8f0', border: 'none', padding: '10px', borderRadius: '6px', color: '#718096', cursor: 'pointer', fontSize: '0.85rem' }}>
              {t.adminBtn}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
