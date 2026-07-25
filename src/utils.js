import { toast } from './toast.js';

export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function shiftDate(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return toISODate(new Date(y, m - 1, d + days));
}

export function formatDateLabel(iso) {
  const today = toISODate(new Date());
  if (iso === today) return 'Сегодня';
  if (iso === shiftDate(today, -1)) return 'Вчера';
  if (iso === shiftDate(today, 1)) return 'Завтра';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: y !== new Date().getFullYear() ? 'numeric' : undefined,
  }).format(dt);
}

export function formatDateFull(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU');
}

// «12,5» → 12.5; пусто/мусор → null
export function parseNum(s) {
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  if (typeof s !== 'string') return null;
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export const round1 = (n) => Math.round(n * 10) / 10;

// Калории из БЖУ: 4/9/4 ккал на грамм; точность — до десятых
export function kcalFromMacros(protein, fat, carbs) {
  return round1((protein ?? 0) * 4 + (fat ?? 0) * 9 + (carbs ?? 0) * 4);
}

// Для действий без своего места под сообщение об ошибке (экспорт, редкие локальные сбои)
export function notifyError(e) {
  toast(e?.message || 'Что-то пошло не так. Проверьте связь с сервером.');
}

export function formatTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

// Пресет порции: старый формат — просто число граммов, новый — объект
// { g, label?, photo? } (photo — маленький data-URL, живёт прямо в данных)
export const presetToObj = (p) => (typeof p === 'number' ? { g: p } : p);

export function fmt0(n) {
  return n == null ? '—' : Math.round(n).toLocaleString('ru-RU');
}

export function fmt1(n) {
  return n == null ? '—' : round1(n).toLocaleString('ru-RU');
}
