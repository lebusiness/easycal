// Крошечные уведомления поверх экрана (ошибки фоновых запросов).
// Модуль без React: db.js публикует сообщения, компонент Toasts подписан.
const listeners = new Set();
let seq = 0;

export function toast(message) {
  const item = { id: ++seq, message };
  for (const fn of listeners) fn(item);
}

export function onToast(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
