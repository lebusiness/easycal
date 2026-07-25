// Клиент API нашего сервера (Express + Postgres). Токен — в localStorage.
const BASE = '/api';

export function getToken() {
  try {
    return localStorage.getItem('authToken');
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem('authToken', token);
    else localStorage.removeItem('authToken');
  } catch {
    /* приватный режим */
  }
}

export class ServerError extends Error {
  constructor(message, { status = 0, network = false } = {}) {
    super(message);
    this.name = 'ServerError';
    this.status = status;
    this.network = network;
  }
}

const TIMEOUT_MS = 12000;

async function request(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  // Таймаут: фоновая очередь мутаций не должна вечно ждать зависший запрос
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    throw new ServerError(e?.name === 'AbortError' ? 'Сервер не отвечает' : 'Нет связи с сервером', {
      network: true,
    });
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ServerError(data?.error || `Ошибка сервера (${res.status})`, { status: res.status });
  }
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  del: (path) => request('DELETE', path),
};
