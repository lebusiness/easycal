import { useState } from 'react';
import { saveGoals, clearGoals } from '../db.js';
import { parseNum, kcalFromMacros, fmt0 } from '../utils.js';
import Header from './Header.jsx';
import { useBackClose } from '../navigation.js';

export default function GoalsEditor({ goals, onClose }) {
  useBackClose(onClose);
  const [form, setForm] = useState({
    protein: goals?.protein != null ? String(goals.protein) : '',
    fat: goals?.fat != null ? String(goals.fat) : '',
    carbs: goals?.carbs != null ? String(goals.carbs) : '',
  });
  const [error, setError] = useState(null);

  const p = parseNum(form.protein);
  const f = parseNum(form.fat);
  const c = parseNum(form.carbs);
  const kcal = p != null && f != null && c != null ? kcalFromMacros(p, f, c) : null;

  const set = (key) => (e) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
    setError(null);
  };

  async function handleSave(e) {
    e.preventDefault();
    if (p == null || f == null || c == null || p < 0 || f < 0 || c < 0) {
      setError('Заполните белки, жиры и углеводы числами не меньше 0');
      return;
    }
    try {
      await saveGoals({ protein: p, fat: f, carbs: c });
      onClose();
    } catch {
      setError('Не удалось сохранить — проверьте связь с сервером.');
    }
  }

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-stone-100">
      <div className="mx-auto w-full max-w-md pb-10">
        <Header title="Цели на день" onBack={onClose} />
        <form onSubmit={handleSave} className="px-3">
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-sm text-stone-500">
              Задайте дневные Б/Ж/У в граммах — калории посчитаются автоматически (4/9/4 ккал на грамм).
            </p>
            <div className="mt-2.5 grid grid-cols-3 gap-2">
              <Field label="Белки, г">
                <input value={form.protein} onChange={set('protein')} inputMode="decimal" placeholder="120" className={inputCls} autoFocus />
              </Field>
              <Field label="Жиры, г">
                <input value={form.fat} onChange={set('fat')} inputMode="decimal" placeholder="70" className={inputCls} />
              </Field>
              <Field label="Углеводы, г">
                <input value={form.carbs} onChange={set('carbs')} inputMode="decimal" placeholder="250" className={inputCls} />
              </Field>
            </div>
            <div className="mt-2.5 rounded-xl bg-emerald-50 px-3 py-2 text-center">
              <div className="text-sm text-emerald-900">Калорийность цели</div>
              <div className="text-xl font-bold text-emerald-900">
                {kcal != null ? `${fmt0(kcal)} ккал` : '—'}
              </div>
            </div>
          </div>

          {error && <p className="mt-3 px-1 text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            className="mt-3 w-full rounded-full bg-emerald-600 py-3.5 text-base font-semibold text-white active:bg-emerald-700"
          >
            Сохранить
          </button>

          {goals && (
            <button
              type="button"
              onClick={async () => {
                try {
                  await clearGoals();
                  onClose();
                } catch {
                  setError('Не удалось сохранить — проверьте связь с сервером.');
                }
              }}
              className="mt-3 w-full rounded-full py-3 text-sm font-semibold text-stone-500 active:text-red-600"
            >
              Убрать цели
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded-xl border border-stone-200 bg-stone-50 px-2 py-2.5 text-center text-lg font-semibold outline-none placeholder:text-stone-400 focus:border-emerald-500';

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-stone-500">{label}</span>
      {children}
    </label>
  );
}
