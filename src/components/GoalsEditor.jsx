import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, saveGoals, clearGoals, setMealGoals } from '../db.js';
import { parseNum, kcalFromMacros, round3, fmt1 } from '../utils.js';
import Header from './Header.jsx';
import { useBackClose } from '../navigation.js';

const toForm = (g) => ({
  protein: g?.protein != null ? String(g.protein) : '',
  fat: g?.fat != null ? String(g.fat) : '',
  carbs: g?.carbs != null ? String(g.carbs) : '',
});

// Все три поля пустые → null (цели нет); все три — числа ≥ 0 → объект; иначе — 'invalid'
function parseGoal(form) {
  if (!form.protein.trim() && !form.fat.trim() && !form.carbs.trim()) return null;
  const p = parseNum(form.protein);
  const f = parseNum(form.fat);
  const c = parseNum(form.carbs);
  if (p == null || f == null || c == null || p < 0 || f < 0 || c < 0) return 'invalid';
  return { protein: p, fat: f, carbs: c };
}

const sameGoal = (a, b) =>
  (a?.protein ?? null) === (b?.protein ?? null) &&
  (a?.fat ?? null) === (b?.fat ?? null) &&
  (a?.carbs ?? null) === (b?.carbs ?? null);

export default function GoalsEditor({ goals, onClose }) {
  useBackClose(onClose);
  const meals = useLiveQuery(() => db.meals.orderBy('order').toArray(), []);
  const [form, setForm] = useState(toForm(goals));
  // Правки по приёмам; пока приём не трогали — форма строится из его сохранённых целей
  const [mealForms, setMealForms] = useState({});
  const [error, setError] = useState(null);

  const list = meals ?? [];
  const mealFormOf = (m) => mealForms[m.id] ?? toForm(m.goals);

  const day = parseGoal(form);
  const dayKcal = day && day !== 'invalid' ? kcalFromMacros(day.protein, day.fat, day.carbs) : null;

  const parsedMeals = list.map((m) => ({ m, goal: parseGoal(mealFormOf(m)) }));
  const setGoals = parsedMeals.filter((x) => x.goal && x.goal !== 'invalid').map((x) => x.goal);
  const sum = setGoals.length
    ? setGoals.reduce(
        (a, g) => ({
          protein: round3(a.protein + g.protein),
          fat: round3(a.fat + g.fat),
          carbs: round3(a.carbs + g.carbs),
        }),
        { protein: 0, fat: 0, carbs: 0 }
      )
    : null;

  const set = (key) => (e) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
    setError(null);
  };

  const setMealField = (meal, key) => (e) => {
    const cur = mealFormOf(meal);
    setMealForms((prev) => ({ ...prev, [meal.id]: { ...cur, [key]: e.target.value } }));
    setError(null);
  };

  async function handleSave(e) {
    e.preventDefault();
    if (day === 'invalid') {
      setError('Цели дня: заполните Б/Ж/У числами не меньше 0 — или оставьте все поля пустыми');
      return;
    }
    const bad = parsedMeals.find((x) => x.goal === 'invalid');
    if (bad) {
      setError(`«${bad.m.name}»: заполните Б/Ж/У полностью — или оставьте все поля пустыми`);
      return;
    }
    try {
      if (day) await saveGoals(day);
      else if (goals) await clearGoals();
      for (const { m, goal } of parsedMeals) {
        if (!sameGoal(goal, m.goals ?? null)) await setMealGoals(m.id, goal);
      }
      onClose();
    } catch {
      setError('Не удалось сохранить — проверьте связь с сервером.');
    }
  }

  async function handleClearAll() {
    try {
      if (goals) await clearGoals();
      for (const m of list) {
        if (m.goals) await setMealGoals(m.id, null);
      }
      onClose();
    } catch {
      setError('Не удалось сохранить — проверьте связь с сервером.');
    }
  }

  const hasAnyGoals = !!goals || list.some((m) => m.goals);

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-stone-100">
      <div className="mx-auto w-full max-w-md pb-10">
        <Header title="Цели" onBack={onClose} />
        <form onSubmit={handleSave} className="px-3">
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-sm text-stone-500">Дневные Б/Ж/У в граммах</p>
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
            <div className="mt-2.5 rounded-xl bg-emerald-50 px-3 py-2 text-center text-sm text-emerald-900">
              Итого: <b className="text-lg">{dayKcal != null ? `${fmt1(dayKcal)} ккал` : '—'}</b>
            </div>
          </div>

          <div className="mt-2 rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-sm text-stone-500">Цели по приёмам — не обязательно</p>
            <div className="mt-2 flex items-center gap-1.5 text-center text-[0.6875rem] font-medium text-stone-400">
              <span className="min-w-0 flex-1" />
              <span className="w-14 shrink-0">Б</span>
              <span className="w-14 shrink-0">Ж</span>
              <span className="w-14 shrink-0">У</span>
              <span className="w-11 shrink-0 text-right">ккал</span>
            </div>
            <div className="mt-1 space-y-1.5">
              {list.map((m) => {
                const mf = mealFormOf(m);
                const g = parseGoal(mf);
                const kcal = g && g !== 'invalid' ? kcalFromMacros(g.protein, g.fat, g.carbs) : null;
                return (
                  <div key={m.id} className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium">{m.name}</span>
                    <input value={mf.protein} onChange={setMealField(m, 'protein')} inputMode="decimal" aria-label={`Белки «${m.name}»`} className={miniInputCls} />
                    <input value={mf.fat} onChange={setMealField(m, 'fat')} inputMode="decimal" aria-label={`Жиры «${m.name}»`} className={miniInputCls} />
                    <input value={mf.carbs} onChange={setMealField(m, 'carbs')} inputMode="decimal" aria-label={`Углеводы «${m.name}»`} className={miniInputCls} />
                    <span className="w-11 shrink-0 text-right text-xs font-semibold text-stone-500">
                      {kcal != null ? fmt1(kcal) : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
            {sum && (
              <button
                type="button"
                onClick={() => setForm(toForm(sum))}
                className="mt-2.5 w-full rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600 active:bg-stone-100"
              >
                Сумма по приёмам: Б {fmt1(sum.protein)} · Ж {fmt1(sum.fat)} · У {fmt1(sum.carbs)} ·{' '}
                <b>{fmt1(kcalFromMacros(sum.protein, sum.fat, sum.carbs))} ккал</b>
                <span className="ml-1.5 font-semibold text-emerald-700">→ в день</span>
              </button>
            )}
          </div>

          {error && <p className="mt-3 px-1 text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            className="mt-3 w-full rounded-full bg-emerald-600 py-3.5 text-base font-semibold text-white active:bg-emerald-700"
          >
            Сохранить
          </button>

          {hasAnyGoals && (
            <button
              type="button"
              onClick={handleClearAll}
              className="mt-3 w-full rounded-full py-3 text-sm font-semibold text-stone-500 active:text-red-600"
            >
              Убрать все цели
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded-xl border border-stone-200 bg-stone-50 px-2 py-2.5 text-center text-lg font-semibold outline-none placeholder:text-stone-400 focus:border-emerald-500';

const miniInputCls =
  'w-14 shrink-0 rounded-lg border border-stone-200 bg-stone-50 px-1 py-2 text-center text-sm font-semibold outline-none focus:border-emerald-500';

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-stone-500">{label}</span>
      {children}
    </label>
  );
}
