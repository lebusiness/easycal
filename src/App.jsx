import { useEffect, useState } from 'react';
import DiaryScreen from './components/DiaryScreen.jsx';
import AddFoodScreen from './components/AddFoodScreen.jsx';
import HistoryScreen from './components/HistoryScreen.jsx';
import AuthScreen from './components/AuthScreen.jsx';
import Toasts from './components/Toasts.jsx';
import { Spinner } from './components/Icons.jsx';
import { openUserDb, closeUserDb, pullSnapshot } from './db.js';
import { getSessionUser, cachedUser, clearSession } from './auth.js';
import { getToken } from './api-client.js';
import { toISODate } from './utils.js';

export default function App() {
  // Мгновенный старт: профиль из кэша + локальное зеркало показываем сразу,
  // сервер (проверка токена + свежий снапшот) — в фоне. Спиннер остаётся только
  // на случай «токен есть, а кэша профиля нет».
  const [user, setUser] = useState(() => {
    if (!getToken()) return null;
    const u = cachedUser();
    if (u) {
      openUserDb(`calorie-tracker-u${u.id}`);
      return u;
    }
    return undefined;
  });
  const [date, setDate] = useState(() => toISODate(new Date()));
  const [screen, setScreen] = useState({ name: 'diary' }); // diary | add | history

  useEffect(() => {
    if (!getToken()) return undefined;
    let alive = true;
    const boot = cachedUser();
    getSessionUser()
      .then(async (u) => {
        if (!alive) return;
        if (u) {
          if (!boot || boot.id !== u.id) {
            closeUserDb();
            openUserDb(`calorie-tracker-u${u.id}`);
          }
          // Сервер недоступен — остаёмся на последнем локальном зеркале
          await pullSnapshot().catch(() => {});
          if (alive) setUser(u);
        } else {
          // Токен отвергнут сервером — выходим из аккаунта
          closeUserDb();
          clearSession();
          setUser(null);
        }
      })
      .catch(() => {
        if (alive && !boot) setUser(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function handleAuthed(u) {
    openUserDb(`calorie-tracker-u${u.id}`);
    await pullSnapshot().catch(() => {});
    setScreen({ name: 'diary' });
    setUser(u);
  }

  function handleLogout() {
    closeUserDb();
    clearSession();
    setScreen({ name: 'diary' });
    setUser(null);
  }

  if (user === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-stone-100">
        <Spinner className="h-8 w-8 text-emerald-600" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-stone-100 text-stone-900">
      {!user ? (
        <AuthScreen onAuthed={handleAuthed} />
      ) : (
        <>
          {/* Дневник всегда смонтирован: возврат из «Добавить»/«Истории» мгновенный,
              без перезагрузки данных и потери прокрутки. Другие экраны — оверлеи
              со своей прокруткой, каждый открывается с чистого верха; дневник под
              оверлеем помечен inert — его кнопки недоступны кликам и фокусу. */}
          {screen.name === 'add' && (
            <div className="fixed inset-0 z-20 overflow-y-auto overscroll-contain bg-stone-100">
              <AddFoodScreen
                date={date}
                initialMealId={screen.mealId}
                autoScan={screen.scan}
                autoFocusSearch={screen.focus}
                autoManual={screen.manual}
                onClose={() => setScreen({ name: 'diary' })}
              />
            </div>
          )}
          {screen.name === 'history' && (
            <div className="fixed inset-0 z-20 overflow-y-auto overscroll-contain bg-stone-100">
              <HistoryScreen onBack={() => setScreen({ name: 'diary' })} />
            </div>
          )}
          <div inert={screen.name !== 'diary' ? '' : undefined}>
            <DiaryScreen
              date={date}
              onDateChange={setDate}
              onAdd={(mealId, focus) => setScreen({ name: 'add', mealId, focus: !!focus })}
              onScan={() => setScreen({ name: 'add', mealId: null, scan: true })}
              onCreateProduct={() => setScreen({ name: 'add', mealId: null, manual: true })}
              onHistory={() => setScreen({ name: 'history' })}
              user={user}
              onLogout={handleLogout}
            />
          </div>
        </>
      )}
      <Toasts />
    </div>
  );
}
