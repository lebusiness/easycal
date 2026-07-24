import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, deleteDiaryEntry } from '../db.js';
import { toISODate, formatDateLabel, formatDateFull, shiftDate, fmt0, fmt1, formatTime, kcalFromMacros, notifyError } from '../utils.js';
import GoalsEditor from './GoalsEditor.jsx';
import MealsEditor from './MealsEditor.jsx';
import EntryEditor from './EntryEditor.jsx';
import { IconChevronLeft, IconChevronRight, IconChevronDown, IconTrash, IconPlus, IconBarcode } from './Icons.jsx';

export default function DiaryScreen({ date, onDateChange, onAdd, onScan, onHistory, user, onLogout }) {
  const meals = useLiveQuery(() => db.meals.orderBy('order').toArray(), []);
  const entries = useLiveQuery(() => db.diary.where('date').equals(date).toArray(), [date]);
  const goalsRec = useLiveQuery(() => db.settings.get('goals'), []);
  const goals = goalsRec?.value ?? null;

  const [collapsed, setCollapsed] = useState(() => new Set());
  const [showGoals, setShowGoals] = useState(false);
  const [showMeals, setShowMeals] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);

  const isToday = date === toISODate(new Date());
  const list = entries ?? [];
  const totals = list.reduce(
    (a, e) => ({
      kcal: a.kcal + (e.kcal || 0),
      protein: a.protein + (e.protein || 0),
      fat: a.fat + (e.fat || 0),
      carbs: a.carbs + (e.carbs || 0),
    }),
    { kcal: 0, protein: 0, fat: 0, carbs: 0 }
  );

  const byMeal = new Map();
  if (meals?.length) {
    for (const e of list) {
      const mealId = meals.some((m) => m.id === e.mealId) ? e.mealId : meals[0].id;
      if (!byMeal.has(mealId)) byMeal.set(mealId, []);
      byMeal.get(mealId).push(e);
    }
  }

  function toggleCollapsed(id) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="mx-auto w-full max-w-md pb-20">
      <header className="sticky top-0 z-10 bg-stone-100/90 px-3 pb-1.5 pt-2 backdrop-blur">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => onDateChange(shiftDate(date, -1))}
            aria-label="Предыдущий день"
            className="rounded-full bg-white p-2 text-stone-600 shadow-sm active:bg-stone-200"
          >
            <IconChevronLeft className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => onDateChange(toISODate(new Date()))} className="min-w-0 truncate px-2 py-1">
            <span className={`text-[15px] font-semibold ${isToday ? 'text-emerald-600' : ''}`}>
              {formatDateLabel(date)}
            </span>
            <span className="ml-1.5 text-[11px] text-stone-400">{formatDateFull(date)}</span>
          </button>
          <button
            type="button"
            onClick={() => onDateChange(shiftDate(date, 1))}
            aria-label="Следующий день"
            className="rounded-full bg-white p-2 text-stone-600 shadow-sm active:bg-stone-200"
          >
            <IconChevronRight className="h-5 w-5" />
          </button>
        </div>
      </header>

      <section className="mx-3 rounded-2xl bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-stone-500">Итого за день</span>
          <span className="flex gap-3">
            <button type="button" onClick={onHistory} className="py-0.5 text-xs font-semibold text-emerald-700 active:text-emerald-800">
              История
            </button>
            <button
              type="button"
              onClick={() => setShowGoals(true)}
              className="py-0.5 text-xs font-semibold text-emerald-700 active:text-emerald-800"
            >
              {goals ? 'Цели' : 'Задать цели'}
            </button>
            <button
              type="button"
              onClick={() => setShowMeals(true)}
              className="py-0.5 text-xs font-semibold text-emerald-700 active:text-emerald-800"
            >
              Приёмы
            </button>
          </span>
        </div>

        {goals ? (
          <div className="mt-1.5 space-y-2">
            <div>
              <div className="flex items-baseline justify-between text-[15px] leading-tight">
                <span className="font-semibold">
                  {fmt0(totals.kcal)}
                  <span className="font-normal text-stone-400">
                    {' '}/ {fmt0(kcalFromMacros(goals.protein, goals.fat, goals.carbs))} ккал
                  </span>
                </span>
              </div>
              <Bar value={totals.kcal} goal={kcalFromMacros(goals.protein, goals.fat, goals.carbs)} color="bg-emerald-500" h="h-1.5" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <MiniProgress label="Б" value={totals.protein} goal={goals.protein} color="bg-sky-500" />
              <MiniProgress label="Ж" value={totals.fat} goal={goals.fat} color="bg-amber-500" />
              <MiniProgress label="У" value={totals.carbs} goal={goals.carbs} color="bg-rose-500" />
            </div>
          </div>
        ) : (
          <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-xl font-bold tracking-tight">
              {fmt0(totals.kcal)} <span className="text-xs font-normal text-stone-500">ккал</span>
            </span>
            <span className="text-xs text-stone-600">
              Б <b>{fmt0(totals.protein)}</b> · Ж <b>{fmt0(totals.fat)}</b> · У <b>{fmt0(totals.carbs)}</b>
            </span>
          </div>
        )}
      </section>

      <div className="mx-3 mt-2 space-y-2">
        {(meals ?? []).map((meal) => {
          const mealEntries = byMeal.get(meal.id) ?? [];
          const mealKcal = mealEntries.reduce((s, e) => s + (e.kcal || 0), 0);
          const isCollapsed = collapsed.has(meal.id);
          return (
            <section key={meal.id} className="rounded-2xl bg-white shadow-sm">
              <div className="flex items-center gap-1 py-1 pl-2.5 pr-1.5">
                <button
                  type="button"
                  onClick={() => toggleCollapsed(meal.id)}
                  aria-label={isCollapsed ? `Развернуть «${meal.name}»` : `Свернуть «${meal.name}»`}
                  className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left"
                >
                  <IconChevronDown
                    className={`h-4 w-4 shrink-0 text-stone-400 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                  />
                  <span className="truncate text-[15px] font-semibold">{meal.name}</span>
                  <span className="ml-auto shrink-0 pl-2 text-xs text-stone-500">
                    {mealEntries.length > 0 ? `${fmt0(mealKcal)} ккал` : '—'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onAdd(meal.id)}
                  aria-label={`Добавить в «${meal.name}»`}
                  className="-my-0.5 shrink-0 rounded-full bg-emerald-50 p-2.5 text-emerald-700 active:bg-emerald-100"
                >
                  <IconPlus className="h-5 w-5" />
                </button>
              </div>

              {!isCollapsed && mealEntries.length > 0 && (
                <ul className="divide-y divide-stone-100 border-t border-stone-100">
                  {mealEntries.map((e) => (
                    <li key={e.id} className="flex items-center gap-1 pl-3 pr-1.5">
                      <button
                        type="button"
                        onClick={() => setEditingEntry(e)}
                        className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left active:opacity-70"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm leading-snug">{e.name}</span>
                        {formatTime(e.addedAt) && (
                          <span className="shrink-0 text-[11px] text-stone-400">{formatTime(e.addedAt)}</span>
                        )}
                        <span className="shrink-0 text-xs text-stone-500">{fmt1(e.grams)} г</span>
                        <span className="shrink-0 text-[15px] font-semibold">{fmt0(e.kcal)}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteDiaryEntry(e.id).catch(notifyError)}
                        aria-label={`Удалить «${e.name}»`}
                        className="shrink-0 rounded-full p-2 text-stone-300 active:bg-red-50 active:text-red-600"
                      >
                        <IconTrash className="h-[18px] w-[18px]" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {entries !== undefined && list.length === 0 && (
        <p className="mx-3 mt-2 text-center text-[11px] text-stone-400">
          Записей пока нет — добавьте еду кнопкой «+» у приёма пищи
        </p>
      )}

      {user && (
        <p className="mx-3 mt-4 text-center text-[11px] text-stone-400">
          {user.email} ·{' '}
          <button
            type="button"
            onClick={onLogout}
            className="py-1 font-semibold text-stone-500 active:text-red-600"
          >
            Выйти
          </button>
        </p>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 mx-auto flex w-full max-w-md gap-2 bg-gradient-to-t from-stone-100 via-stone-100/90 to-transparent px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-4">
        <button
          type="button"
          onClick={() => onAdd(null)}
          className="min-w-0 flex-1 rounded-full bg-emerald-600 py-3.5 text-base font-semibold text-white shadow-lg shadow-emerald-600/25 active:bg-emerald-700"
        >
          + Добавить еду
        </button>
        <button
          type="button"
          onClick={onScan}
          aria-label="Сканировать штрихкод"
          className="shrink-0 rounded-full bg-white px-5 text-emerald-600 shadow-lg shadow-stone-900/10 active:bg-stone-100"
        >
          <IconBarcode className="h-6 w-6" />
        </button>
      </div>

      {showGoals && <GoalsEditor goals={goals} onClose={() => setShowGoals(false)} />}
      {showMeals && <MealsEditor onClose={() => setShowMeals(false)} />}
      {editingEntry && (
        <EntryEditor entry={editingEntry} meals={meals ?? []} onClose={() => setEditingEntry(null)} />
      )}
    </div>
  );
}

function Bar({ value, goal, color, h = 'h-1' }) {
  const pct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0;
  const over = goal > 0 && value > goal;
  return (
    <div className={`mt-0.5 ${h} overflow-hidden rounded-full bg-stone-100`}>
      <div
        className={`h-full rounded-full ${over ? 'bg-red-500' : color} transition-[width] duration-300`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function MiniProgress({ label, value, goal, color }) {
  const over = goal > 0 && value > goal;
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px] leading-tight">
        <span className="text-stone-500">{label}</span>
        <span className={over ? 'font-semibold text-red-600' : 'font-semibold'}>
          {fmt0(value)}
          <span className="font-normal text-stone-400">/{fmt0(goal)}</span>
        </span>
      </div>
      <Bar value={value} goal={goal} color={color} />
    </div>
  );
}
