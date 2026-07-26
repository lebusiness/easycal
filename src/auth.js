import { api, setToken, getToken } from './api-client.js';

// Аккаунты живут на сервере (Express + Postgres). Токен и копия профиля —
// в localStorage, чтобы после перезагрузки не входить заново.

function cacheUser(user) {
  try {
    localStorage.setItem('authUser', JSON.stringify(user));
  } catch {
    /* приватный режим */
  }
}

export function cachedUser() {
  try {
    const raw = localStorage.getItem('authUser');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function registerUser(email, password) {
  const { token, user } = await api.post('/auth/register', { email, password });
  setToken(token);
  cacheUser(user);
  return user;
}

export async function loginUser(email, password) {
  const { token, user } = await api.post('/auth/login', { email, password });
  setToken(token);
  cacheUser(user);
  return user;
}

export async function getSessionUser() {
  if (!getToken()) return null;
  try {
    const { user, token } = await api.get('/auth/me');
    // Скользящая сессия: сервер выдаёт свежий токен — активный пользователь
    // никогда не разлогинивается по истечении срока старого
    if (token) setToken(token);
    cacheUser(user);
    return user;
  } catch (e) {
    // Сессию сбрасываем только если сервер ЯВНО отверг токен (401).
    // Сбой сети, 5xx при рестарте сервера, 429 от rate-limit — не повод
    // терять аккаунт: работаем с кэшированным профилем и локальным зеркалом.
    if (e.status === 401) {
      clearSession();
      return null;
    }
    return cachedUser();
  }
}

export function saveSession() {
  // Токен и профиль уже сохранены при входе/регистрации
}

export function clearSession() {
  setToken(null);
  try {
    localStorage.removeItem('authUser');
  } catch {
    /* приватный режим */
  }
}
