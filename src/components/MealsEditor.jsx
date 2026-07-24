import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, addMeal, renameMeal, moveMeal, deleteMeal } from '../db.js';
import { notifyError } from '../utils.js';
import Header from './Header.jsx';
import { IconArrowUp, IconArrowDown, IconTrash } from './Icons.jsx';
import { useBackClose } from '../navigation.js';

export default function MealsEditor({ onClose }) {
  useBackClose(onClose);
  const meals = useLiveQuery(() => db.meals.orderBy('order').toArray(), []);
  const [newName, setNewName] = useState('');

  async function handleDelete(meal) {
    const count = await db.diary.where('mealId').equals(meal.id).count();
    const target = meals.find((m) => m.id !== meal.id);
    const message =
      count > 0
        ? `Удалить «${meal.name}»? ${count} записей будут перенесены в «${target.name}».`
        : `Удалить «${meal.name}»?`;
    if (window.confirm(message)) await deleteMeal(meal.id).catch(notifyError);
  }

  async function handleAdd(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      await addMeal(name);
      setNewName('');
    } catch (e) {
      notifyError(e);
    }
  }

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-stone-100">
      <div className="mx-auto w-full max-w-md pb-10">
        <Header title="Приёмы пищи" onBack={onClose} />
        <div className="px-3">
          <p className="px-1 text-sm text-stone-500">
            Переименуйте, поменяйте порядок стрелками или добавьте свои приёмы.
          </p>

          <ul className="mt-2 space-y-1.5">
            {(meals ?? []).map((meal, i) => (
              <MealRow
                key={meal.id}
                meal={meal}
                isFirst={i === 0}
                isLast={i === meals.length - 1}
                canDelete={meals.length > 1}
                onDelete={() => handleDelete(meal)}
              />
            ))}
          </ul>

          <form onSubmit={handleAdd} className="mt-2.5 flex gap-1.5">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Новый приём (например, Перекус)"
              className="min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-[0.9375rem] shadow-sm outline-none placeholder:text-stone-400 focus:border-emerald-500"
            />
            <button
              type="submit"
              disabled={!newName.trim()}
              className="shrink-0 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white active:bg-emerald-700 disabled:opacity-50"
            >
              Добавить
            </button>
          </form>

          <button
            type="button"
            onClick={onClose}
            className="mt-4 w-full rounded-full bg-emerald-600 py-3 text-[0.9375rem] font-semibold text-white active:bg-emerald-700"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}

function MealRow({ meal, isFirst, isLast, canDelete, onDelete }) {
  const [name, setName] = useState(meal.name);

  function commitName() {
    const trimmed = name.trim();
    if (trimmed && trimmed !== meal.name) renameMeal(meal.id, trimmed).catch(notifyError);
    else setName(meal.name);
  }

  return (
    <li className="flex items-center gap-0.5 rounded-xl bg-white p-1.5 shadow-sm">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        aria-label="Название приёма"
        className="min-w-0 flex-1 rounded-lg px-3 py-2 text-[0.9375rem] font-medium outline-none focus:bg-stone-50"
      />
      <button
        type="button"
        onClick={() => moveMeal(meal.id, -1).catch(notifyError)}
        disabled={isFirst}
        aria-label={`Переместить «${meal.name}» выше`}
        className="rounded-full p-2 text-stone-500 active:bg-stone-100 disabled:opacity-30"
      >
        <IconArrowUp className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={() => moveMeal(meal.id, 1).catch(notifyError)}
        disabled={isLast}
        aria-label={`Переместить «${meal.name}» ниже`}
        className="rounded-full p-2 text-stone-500 active:bg-stone-100 disabled:opacity-30"
      >
        <IconArrowDown className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={!canDelete}
        aria-label={`Удалить «${meal.name}»`}
        className="rounded-full p-2 text-stone-400 active:bg-red-50 active:text-red-600 disabled:opacity-30"
      >
        <IconTrash className="h-5 w-5" />
      </button>
    </li>
  );
}
