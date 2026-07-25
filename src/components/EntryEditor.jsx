import { useEffect, useState } from 'react';
import { updateDiaryEntry, deleteDiaryEntry, getFavoriteFor } from '../db.js';
import { parseNum, round1, fmt1, formatTime, notifyError } from '../utils.js';
import Header from './Header.jsx';
import PortionPicker from './PortionPicker.jsx';
import { useBackClose } from '../navigation.js';

// Редактирование записи дневника: граммы, приём, время добавления
export default function EntryEditor({ entry, meals, onClose }) {
  useBackClose(onClose);
  const [grams, setGrams] = useState(String(entry.grams));
  const [mealId, setMealId] = useState(entry.mealId);
  const [time, setTime] = useState(() => formatTime(entry.addedAt) ?? '');
  const [error, setError] = useState(null);
  const [presets, setPresets] = useState(null);

  // Пресеты граммов из избранного, если продукт там есть
  useEffect(() => {
    let cancelled = false;
    getFavoriteFor({
      source: entry.myProductId != null ? 'mine' : 'off',
      id: entry.myProductId ?? undefined,
      barcode: entry.barcode ?? null,
    })
      .then((fav) => {
        if (!cancelled && fav?.presets?.length) setPresets(fav.presets);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [entry]);

  // Снапшот на 100 г; для старых записей восстанавливаем из порции
  const per100 =
    entry.kcal100 != null
      ? {
          kcal: entry.kcal100,
          protein: entry.protein100 ?? 0,
          fat: entry.fat100 ?? 0,
          carbs: entry.carbs100 ?? 0,
        }
      : entry.grams > 0
        ? {
            kcal: ((entry.kcal || 0) / entry.grams) * 100,
            protein: ((entry.protein || 0) / entry.grams) * 100,
            fat: ((entry.fat || 0) / entry.grams) * 100,
            carbs: ((entry.carbs || 0) / entry.grams) * 100,
          }
        : { kcal: 0, protein: 0, fat: 0, carbs: 0 };

  const g = parseNum(grams);
  const portion = (v) => (g == null || g <= 0 ? null : round1((v * g) / 100));

  async function handleSave() {
    setError(null);
    if (g == null || g <= 0) {
      setError('Укажите вес порции в граммах');
      return;
    }
    const meal = meals.find((m) => m.id === mealId) ?? meals[0];
    let addedAt = entry.addedAt ?? null;
    if (time) {
      const [y, mo, d] = entry.date.split('-').map(Number);
      const [hh, mm] = time.split(':').map(Number);
      addedAt = new Date(y, mo - 1, d, hh, mm).toISOString();
    }
    try {
      await updateDiaryEntry(entry.id, {
      grams: round1(g),
      mealId: meal.id,
      mealLabel: meal.name,
      addedAt,
      kcal: round1((per100.kcal * g) / 100),
      protein: round1((per100.protein * g) / 100),
      fat: round1((per100.fat * g) / 100),
      carbs: round1((per100.carbs * g) / 100),
        kcal100: round1(per100.kcal),
        protein100: round1(per100.protein),
        fat100: round1(per100.fat),
        carbs100: round1(per100.carbs),
      });
      onClose();
    } catch {
      setError('Не удалось сохранить — проверьте связь с сервером.');
    }
  }

  async function handleDelete() {
    try {
      await deleteDiaryEntry(entry.id);
      onClose();
    } catch (e) {
      notifyError(e);
    }
  }

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-stone-100">
      <div className="mx-auto w-full max-w-md pb-8">
        <Header title={entry.name} onBack={onClose} />
        <div className="px-3">
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            {meals.length > 0 && (
              <div className="mb-3">
                <div className="mb-1.5 text-xs font-medium text-stone-500">Приём пищи</div>
                <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                  {meals.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMealId(m.id)}
                      className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                        mealId === m.id
                          ? 'bg-emerald-600 text-white'
                          : 'bg-stone-100 text-stone-600 active:bg-stone-200'
                      }`}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <PortionPicker grams={grams} onChange={setGrams} presets={presets} />

            <label className="mt-2.5 block">
              <span className="mb-1 block text-xs font-medium text-stone-500">Время добавления</span>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-center text-base font-semibold outline-none focus:border-emerald-500"
              />
            </label>

            <div className="mt-3 rounded-xl bg-emerald-50 px-3.5 py-2 text-[0.9375rem] text-emerald-900">
              <b>{fmt1(portion(per100.kcal))}</b> ккал · Б <b>{fmt1(portion(per100.protein))}</b> · Ж{' '}
              <b>{fmt1(portion(per100.fat))}</b> · У <b>{fmt1(portion(per100.carbs))}</b>
            </div>

            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

            <button
              type="button"
              onClick={handleSave}
              className="mt-3 w-full rounded-full bg-emerald-600 py-3 text-[0.9375rem] font-semibold text-white active:bg-emerald-700"
            >
              Сохранить
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="mt-1.5 w-full rounded-full py-2.5 text-sm font-semibold text-red-600 active:bg-red-50"
            >
              Удалить запись
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
