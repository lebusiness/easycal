import { useEffect, useState } from 'react';
import DiaryScreen from './components/DiaryScreen.jsx';
import AddFoodScreen from './components/AddFoodScreen.jsx';
import HistoryScreen from './components/HistoryScreen.jsx';
import AuthScreen from './components/AuthScreen.jsx';
import { Spinner } from './components/Icons.jsx';
import { openUserDb, closeUserDb, pullSnapshot } from './db.js';
import { getSessionUser, clearSession } from './auth.js';
import { toISODate } from './utils.js';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined — проверяем сессию, null — не вошёл
  const [date, setDate] = useState(() => toISODate(new Date()));
  const [screen, setScreen] = useState({ name: 'diary' }); // diary | add | history

  useEffect(() => {
    getSessionUser()
      .then(async (u) => {
        if (u) {
          openUserDb(`calorie-tracker-u${u.id}`);
          // Сервер недоступен — покажем последнее локальное зеркало
          await pullSnapshot().catch(() => {});
        }
        setUser(u ?? null);
      })
      .catch(() => setUser(null));
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
      ) : screen.name === 'add' ? (
        <AddFoodScreen
          date={date}
          initialMealId={screen.mealId}
          autoScan={screen.scan}
          onClose={() => setScreen({ name: 'diary' })}
        />
      ) : screen.name === 'history' ? (
        <HistoryScreen onBack={() => setScreen({ name: 'diary' })} />
      ) : (
        <DiaryScreen
          date={date}
          onDateChange={setDate}
          onAdd={(mealId) => setScreen({ name: 'add', mealId })}
          onScan={() => setScreen({ name: 'add', mealId: null, scan: true })}
          onHistory={() => setScreen({ name: 'history' })}
          user={user}
          onLogout={handleLogout}
        />
      )}
    </div>
  );
}
