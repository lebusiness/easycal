import { useEffect, useState } from 'react';
import { onToast } from '../toast.js';

const TTL_MS = 4000;
const MAX_VISIBLE = 3;

// Мини-плашки поверх всего экрана: исчезают сами, тап скрывает сразу
export default function Toasts() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const timers = new Set();
    const off = onToast((t) => {
      setItems((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), t]);
      const timer = setTimeout(() => {
        timers.delete(timer);
        setItems((prev) => prev.filter((x) => x.id !== t.id));
      }, TTL_MS);
      timers.add(timer);
    });
    return () => {
      off();
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  if (!items.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(0.375rem+env(safe-area-inset-top))] z-50 flex flex-col items-center gap-1 px-4">
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
          className="toast-in pointer-events-auto max-w-full rounded-full bg-stone-900/90 px-3.5 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur"
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
