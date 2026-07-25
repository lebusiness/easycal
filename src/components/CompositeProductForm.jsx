import { useState } from 'react';
import { addMyProduct, updateMyProduct, deleteMyProduct } from '../db.js';
import { parseNum, round1, fmt1, kcalFromMacros, notifyError } from '../utils.js';
import Header from './Header.jsx';
import AddFoodScreen from './AddFoodScreen.jsx';
import { ToggleRow } from './ManualProductForm.jsx';
import { IconStar, IconClose } from './Icons.jsx';
import { useBackClose, useScrollToAction } from '../navigation.js';

// Составной продукт: блюдо из нескольких продуктов (например, молоко + банан).
// Ингредиенты — снапшоты КБЖУ на 100 г + вес; итоговые КБЖУ на 100 г считаются
// из суммы, поэтому дальше продукт живёт как обычный «свой» (поиск, избранное,
// дневник). product задан — редактирование, иначе создание; initialIngredients —
// создание с готовым составом (сборка блюда из записей дневника).
export default function CompositeProductForm({ product, initialIngredients, onBack, onSaved, onDeleted }) {
  useBackClose(onBack);
  const editing = product != null;
  // При редактировании докручиваем до кнопки «Сохранить изменения»; при создании
  // (в т. ч. из записей дневника) вверху пустое имя с автофокусом — скролл не нужен
  const actionRef = useScrollToAction();
  const [name, setName] = useState(product?.name ?? '');
  // Вес храним строкой — это живое поле ввода
  const [ingredients, setIngredients] = useState(() =>
    (product?.ingredients ?? initialIngredients ?? []).map((ing) => ({ ...ing, g: String(ing.g) }))
  );
  const [pinFavorite, setPinFavorite] = useState(!!product?.favorite);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const rows = ingredients.map((ing) => ({ ...ing, gNum: parseNum(ing.g) }));
  const totalG = rows.reduce((s, r) => s + (r.gNum > 0 ? r.gNum : 0), 0);
  const total = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  for (const r of rows) {
    if (!(r.gNum > 0)) continue;
    total.kcal += (r.kcal100 * r.gNum) / 100;
    total.protein += (r.protein100 * r.gNum) / 100;
    total.fat += (r.fat100 * r.gNum) / 100;
    total.carbs += (r.carbs100 * r.gNum) / 100;
  }
  const per100 = (v) => (totalG > 0 ? round1((v / totalG) * 100) : 0);

  // Выбранный в пикере продукт + вес → снапшот-ингредиент
  function handlePick(p, g) {
    const label =
      p.brand && !p.name.toLowerCase().includes(p.brand.toLowerCase())
        ? `${p.name} (${p.brand})`
        : p.name;
    setIngredients((list) => [
      ...list,
      {
        name: label,
        g: String(round1(g)),
        kcal100: round1(p.kcal100 ?? kcalFromMacros(p.protein100 ?? 0, p.fat100 ?? 0, p.carbs100 ?? 0)),
        protein100: round1(p.protein100 ?? 0),
        fat100: round1(p.fat100 ?? 0),
        carbs100: round1(p.carbs100 ?? 0),
      },
    ]);
    setPicking(false);
    setError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setError('Введите название блюда');
      return;
    }
    if (ingredients.length === 0) {
      setError('Добавьте хотя бы один ингредиент');
      return;
    }
    const list = [];
    for (const r of rows) {
      if (!(r.gNum > 0)) {
        setError(`У «${r.name}» укажите вес в граммах (число больше 0)`);
        return;
      }
      list.push({
        name: r.name,
        g: round1(r.gNum),
        kcal100: r.kcal100,
        protein100: r.protein100,
        fat100: r.fat100,
        carbs100: r.carbs100,
      });
    }

    const data = {
      name: trimmed,
      // Состав в описании: виден в списках и карточке, а поиск находит блюдо
      // по названиям ингредиентов
      description: list.map((ing) => `${ing.name} ${ing.g} г`).join(' + '),
      kcal100: per100(total.kcal),
      protein100: per100(total.protein),
      fat100: per100(total.fat),
      carbs100: per100(total.carbs),
      presets: [{ g: round1(totalG), label: 'вся порция' }],
      ingredients: list,
    };

    setSaving(true);
    try {
      if (editing) {
        await updateMyProduct(product.id, { ...data, favorite: pinFavorite ? 1 : 0 });
        onSaved({ ...product, ...data, favorite: pinFavorite });
      } else {
        onSaved(await addMyProduct({ ...data, favorite: pinFavorite }));
      }
    } catch {
      setSaving(false);
      setError('Не удалось сохранить продукт. Попробуйте ещё раз.');
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Удалить «${product.name}» из своих продуктов?`)) return;
    try {
      await deleteMyProduct(product.id);
      onDeleted?.();
    } catch (err) {
      notifyError(err);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md pb-8">
      <Header title={editing ? 'Редактировать блюдо' : 'Составной продукт'} onBack={onBack} />

      <form onSubmit={handleSubmit} ref={editing ? actionRef : undefined} className="px-3">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stone-500">Название *</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например, молоко с бананом"
              autoFocus={!name}
              className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5 text-[0.9375rem] outline-none placeholder:text-stone-400 focus:border-emerald-500"
            />
          </label>

          <div className="mt-3">
            <span className="text-xs font-medium text-stone-500">Состав</span>
            {ingredients.length === 0 && (
              <p className="mt-0.5 text-[0.6875rem] text-stone-400">
                Соберите блюдо из продуктов: поиск, частые, избранное, свои или штрихкод
              </p>
            )}

            {rows.map((r, i) => (
              <div key={i} className="mt-1.5 flex items-center gap-1.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm leading-snug">{r.name}</p>
                  <p className="text-[0.6875rem] leading-snug text-stone-500">
                    {r.gNum > 0
                      ? `${fmt1((r.kcal100 * r.gNum) / 100)} ккал · Б ${fmt1((r.protein100 * r.gNum) / 100)} · Ж ${fmt1((r.fat100 * r.gNum) / 100)} · У ${fmt1((r.carbs100 * r.gNum) / 100)}`
                      : `${fmt1(r.kcal100)} ккал на 100 г`}
                  </p>
                </div>
                <input
                  value={ingredients[i].g}
                  onChange={(e) =>
                    setIngredients((list) => list.map((ing, j) => (j === i ? { ...ing, g: e.target.value } : ing)))
                  }
                  inputMode="decimal"
                  placeholder="вес, г"
                  aria-label={`Вес «${r.name}» в граммах`}
                  className="w-[4.25rem] shrink-0 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2 text-center text-sm outline-none placeholder:text-stone-400 focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => setIngredients((list) => list.filter((_, j) => j !== i))}
                  aria-label={`Убрать «${r.name}»`}
                  className="-mx-1 shrink-0 rounded-full p-1.5 text-stone-300 active:bg-red-50 active:text-red-600"
                >
                  <IconClose className="h-4 w-4" />
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={() => setPicking(true)}
              className="mt-2 w-full rounded-xl border-2 border-dashed border-stone-300 py-2.5 text-sm font-medium text-stone-500 active:border-emerald-500 active:text-emerald-700"
            >
              + Добавить ингредиент
            </button>
          </div>

          {totalG > 0 && (
            <div className="mt-3 rounded-xl bg-emerald-50 px-3.5 py-2 text-sm text-emerald-900">
              <p>
                Итого {fmt1(totalG)} г: <b className="text-lg">{fmt1(total.kcal)}</b> ккал · Б{' '}
                <b>{fmt1(total.protein)}</b> · Ж <b>{fmt1(total.fat)}</b> · У <b>{fmt1(total.carbs)}</b>
              </p>
              <p className="mt-0.5 text-xs text-emerald-800/80">
                На 100 г: {fmt1(per100(total.kcal))} ккал · Б {fmt1(per100(total.protein))} · Ж{' '}
                {fmt1(per100(total.fat))} · У {fmt1(per100(total.carbs))}
              </p>
            </div>
          )}

          <div className="mt-2.5">
            <ToggleRow
              checked={pinFavorite}
              onChange={setPinFavorite}
              label={
                <span className="flex items-center gap-1">
                  Закрепить в избранном
                  <IconStar className={`h-4 w-4 ${pinFavorite ? 'text-amber-400' : 'text-stone-300'}`} filled={pinFavorite} />
                </span>
              }
              hint="Будет всегда под рукой во вкладке «Избранное»"
            />
          </div>
        </div>

        {error && <p className="mt-3 px-1 text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="mt-3 w-full rounded-full bg-emerald-600 py-3.5 text-base font-semibold text-white active:bg-emerald-700 disabled:opacity-60"
        >
          {editing ? 'Сохранить изменения' : 'Сохранить продукт'}
        </button>

        {editing && (
          <button
            type="button"
            onClick={handleDelete}
            className="mt-1.5 w-full rounded-full py-2.5 text-sm font-semibold text-red-600 active:bg-red-50"
          >
            Удалить продукт
          </button>
        )}
      </form>

      {picking && (
        <div className="fixed inset-0 z-40 overflow-y-auto overscroll-contain bg-stone-100">
          <AddFoodScreen pickMode onPick={handlePick} onClose={() => setPicking(false)} />
        </div>
      )}
    </div>
  );
}
