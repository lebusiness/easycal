import { useState } from 'react';
import { registerUser, loginUser } from '../auth.js';
import { IconEye, IconEyeOff, Spinner } from './Icons.jsx';

// Вход/регистрация: локальные аккаунты, без писем и подтверждений
export default function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState('login'); // login | register
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Введите корректную почту');
      return;
    }
    if (password.length < 6) {
      setError('Пароль — минимум 6 символов');
      return;
    }
    setBusy(true);
    try {
      const user =
        mode === 'register' ? await registerUser(email, password) : await loginUser(email, password);
      onAuthed(user);
    } catch (err) {
      setError(err?.message || 'Что-то пошло не так, попробуйте ещё раз');
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-8">
      <div className="mb-6 text-center">
        <img src="/icon-192.png" alt="" className="mx-auto h-16 w-16 rounded-2xl shadow-sm" />
        <h1 className="mt-3 text-xl font-bold">Трекер калорий</h1>
        <p className="mt-1 text-sm text-stone-500">Дневник питания на этом устройстве</p>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-stone-200/70 p-1">
          {[
            ['login', 'Вход'],
            ['register', 'Регистрация'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setMode(key);
                setError(null);
              }}
              className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                mode === key ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 active:text-stone-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="mt-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stone-500">Почта</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
              className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5 text-[0.9375rem] outline-none placeholder:text-stone-400 focus:border-emerald-500"
            />
          </label>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-medium text-stone-500">Пароль</span>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Минимум 6 символов"
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                className="w-full rounded-xl border border-stone-200 bg-stone-50 py-2.5 pl-3.5 pr-11 text-[0.9375rem] outline-none placeholder:text-stone-400 focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-2 text-stone-400 active:bg-stone-200 active:text-stone-600"
              >
                {showPassword ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
          </label>

          {error && <p className="mt-2.5 text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-emerald-600 py-3.5 text-base font-semibold text-white active:bg-emerald-700 disabled:opacity-60"
          >
            {busy && <Spinner className="h-4 w-4" />}
            {mode === 'register' ? 'Создать аккаунт' : 'Войти'}
          </button>
        </form>
      </div>

      <p className="mt-4 text-center text-xs leading-relaxed text-stone-400">
        Без писем и подтверждений. Данные хранятся на сервере под вашим аккаунтом — можно входить с
        любого устройства.
      </p>
    </div>
  );
}
