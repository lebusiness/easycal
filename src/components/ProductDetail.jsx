import { useState } from 'react';
import {
  addDiaryEntry,
  productKeyOf,
  saveFavoriteSnapshot,
  toggleMyProductFavorite,
  saveOverride,
  updateFavoritePresets,
} from '../db.js';
import { parseNum, round1, fmt0, kcalFromMacros, notifyError } from '../utils.js';
import Header from './Header.jsx';
import PortionPicker from './PortionPicker.jsx';
import GramsWheel from './GramsWheel.jsx';
import { IconStar } from './Icons.jsx';
import { useBackClose } from '../navigation.js';

const MACROS = [
  { key: 'protein100', label: 'Белки' },
  { key: 'fat100', label: 'Жиры' },
  { key: 'carbs100', label: 'Углеводы' },
];

export default function ProductDetail({ product, date, meal, meals, onMealChange, onBack, onAdded }) {
  useBackClose(onBack);
  // Значения из OFF бывают вида 7.699999809 — приводим к одному знаку
  const [vals, setVals] = useState(() =>
    Object.fromEntries(
      MACROS.map((m) => [m.key, product[m.key] != null ? String(round1(product[m.key])) : ''])
    )
  );
  const [grams, setGrams] = useState('100');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [favSaved, setFavSaved] = useState(!!product.favorite);
  const [favId, setFavId] = useState(product.favId ?? null);
  const [presets, setPresets] = useState(product.presets ?? null);
  const [patchSaved, setPatchSaved] = useState(false);

  const per100 = {
    protein: parseNum(vals.protein100),
    fat: parseNum(vals.fat100),
    carbs: parseNum(vals.carbs100),
  };

  // Изменены ли БЖУ относительно исходного продукта
  const dirty = MACROS.some((m) => {
    const orig = product[m.key] != null ? String(round1(product[m.key])) : '';
    return vals[m.key].trim().replace(',', '.') !== orig;
  });

  // Ккал: исходная из базы, а при любом изменении БЖУ — пересчёт по 4/9/4
  const kcal100 = dirty || product.kcal100 == null
    ? kcalFromMacros(per100.protein, per100.fat, per100.carbs)
    : product.kcal100;

  const g = parseNum(grams);
  const portion = (v) => (v == null || g == null || g <= 0 ? null : (v * g) / 100);

  const anyMissing = MACROS.some((m) => product[m.key] == null);

  function currentProduct() {
    return {
      ...product,
      kcal100,
      protein100: per100.protein ?? 0,
      fat100: per100.fat ?? 0,
      carbs100: per100.carbs ?? 0,
    };
  }

  async function handleAdd() {
    setError(null);
    if (g == null || g <= 0) {
      setError('Укажите вес порции в граммах');
      return;
    }
    if (per100.protein == null && per100.fat == null && per100.carbs == null && product.kcal100 == null) {
      setError('Заполните БЖУ на 100 г');
      return;
    }
    if (!meal) {
      setError('Выберите приём пищи');
      return;
    }
    const p = currentProduct();
    const name =
      product.brand && !product.name.toLowerCase().includes(product.brand.toLowerCase())
        ? `${product.name} (${product.brand})`
        : product.name;
    setSaving(true);
    try {
      await addDiaryEntry({
        date,
        mealId: meal.id,
        mealLabel: meal.name,
        name,
        productName: product.name,
        brand: product.brand ?? null,
        barcode: product.barcode ?? null,
        myProductId: product.source === 'mine' && product.id != null ? product.id : null,
        productKey: productKeyOf(product),
        kcal100: p.kcal100,
        protein100: p.protein100,
        fat100: p.fat100,
        carbs100: p.carbs100,
        grams: round1(g),
        kcal: Math.round((p.kcal100 * g) / 100),
        protein: Math.round((p.protein100 * g) / 100),
        fat: Math.round((p.fat100 * g) / 100),
        carbs: Math.round((p.carbs100 * g) / 100),
        addedAt: new Date().toISOString(),
      });
      onAdded();
    } catch {
      setSaving(false);
      setError('Не удалось сохранить запись — проверьте связь с сервером.');
    }
  }

  async function handleFavorite() {
    try {
      if (product.source === 'mine' && product.id != null) {
        await toggleMyProductFavorite(product.id);
        setFavSaved((s) => !s);
      } else {
        const id = await saveFavoriteSnapshot({ ...currentProduct(), presets });
        setFavId(id);
        setFavSaved(true);
      }
    } catch (e) {
      notifyError(e);
    }
  }

  async function savePresets(next) {
    setPresets(next);
    await updateFavoritePresets({ ...product, favId }, next).catch(notifyError);
  }

  function addCurrentPreset() {
    if (g == null || g <= 0) return;
    const v = Math.round(g);
    const next = [...new Set([...(presets ?? []), v])].sort((a, b) => a - b);
    savePresets(next);
  }

  function removePreset(v) {
    const next = (presets ?? []).filter((x) => x !== v);
    savePresets(next.length ? next : null);
  }

  async function handlePatch() {
    try {
      const p = currentProduct();
      await saveOverride(product.barcode, {
        kcal100: p.kcal100,
        protein100: p.protein100,
        fat100: p.fat100,
        carbs100: p.carbs100,
      });
      setPatchSaved(true);
    } catch (e) {
      notifyError(e);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md pb-8">
      <Header title="Добавить в дневник" onBack={onBack} />

      <div className="px-3">
        <section className="rounded-2xl bg-white p-3.5 shadow-sm">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold leading-snug">
                {product.name}
                {product.source === 'mine' && (
                  <span className="ml-1.5 align-middle rounded-full bg-emerald-100 px-2 py-0.5 text-[0.6875rem] font-medium text-emerald-800">
                    Мой
                  </span>
                )}
                {(product.patched || patchSaved) && (
                  <span className="ml-1.5 align-middle rounded-full bg-violet-100 px-2 py-0.5 text-[0.6875rem] font-medium text-violet-800">
                    изменён
                  </span>
                )}
              </h2>
              {(product.brand || product.description || product.barcode) && (
                <div className="mt-0.5 truncate text-xs text-stone-500">
                  {[product.brand, product.description, product.barcode ? `ШК ${product.barcode}` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={handleFavorite}
              aria-label={favSaved ? 'В избранном' : 'В избранное'}
              className={`-m-1.5 shrink-0 rounded-full p-2.5 active:bg-stone-100 ${
                favSaved ? 'text-amber-400' : 'text-stone-300'
              }`}
            >
              <IconStar className="h-7 w-7" filled={favSaved} />
            </button>
          </div>

          <div className="mt-2.5 grid grid-cols-4 gap-1.5">
            <div className="text-center">
              <span className="mb-1 block whitespace-nowrap text-[0.6875rem] text-emerald-800">Ккал</span>
              <div className="flex h-[120px] items-center justify-center rounded-xl bg-emerald-50 text-xl font-bold text-emerald-900">
                {fmt0(kcal100)}
              </div>
            </div>
            {MACROS.map((m) => (
              <div key={m.key} className="text-center">
                <span className="mb-1 block whitespace-nowrap text-[0.6875rem] text-stone-500">{m.label}</span>
                <div className={product[m.key] == null && !vals[m.key] ? 'rounded-xl ring-1 ring-amber-300' : ''}>
                  <GramsWheel
                    value={vals[m.key]}
                    onChange={(v) => {
                      setVals((prev) => ({ ...prev, [m.key]: v }));
                      setPatchSaved(false);
                    }}
                    min={0}
                    max={100}
                    unit=""
                    ariaLabel={`${m.label} на 100 г`}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="text-[0.6875rem] text-stone-400">
              {anyMissing ? 'Нет части данных — выставьте БЖУ (на 100 г)' : 'На 100 г'}
            </span>
            {dirty && product.barcode && product.source !== 'mine' && (
              <button
                type="button"
                onClick={handlePatch}
                disabled={patchSaved}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold active:bg-stone-50 ${
                  patchSaved
                    ? 'border-violet-300 bg-violet-50 text-violet-700'
                    : 'border-stone-200 text-stone-600'
                }`}
              >
                {patchSaved ? '✓ Всегда с этими БЖУ' : 'Всегда с этими БЖУ'}
              </button>
            )}
          </div>
        </section>

        <section className="mt-2 rounded-2xl bg-white p-3.5 shadow-sm">
          {meals.length > 0 && (
            <div className="no-scrollbar mb-2.5 flex gap-1.5 overflow-x-auto pb-0.5">
              {meals.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onMealChange(m.id)}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    meal?.id === m.id
                      ? 'bg-emerald-600 text-white'
                      : 'bg-stone-100 text-stone-600 active:bg-stone-200'
                  }`}
                >
                  {m.name}
                </button>
              ))}
            </div>
          )}

          <PortionPicker grams={grams} onChange={setGrams} presets={presets} />

          {favSaved && (
            <div className="no-scrollbar mt-2.5 flex items-center gap-1.5 overflow-x-auto">
              <span className="shrink-0 text-xs text-stone-500">Пресеты:</span>
              {(presets ?? []).map((v) => (
                <span
                  key={v}
                  className="flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full bg-amber-50 py-1 pl-3 pr-1 text-sm font-medium text-amber-800"
                >
                  {v} г
                  <button
                    type="button"
                    onClick={() => removePreset(v)}
                    aria-label={`Убрать пресет ${v} г`}
                    className="rounded-full p-1 text-amber-600 active:bg-amber-100"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                </span>
              ))}
              {g != null && g > 0 && !(presets ?? []).includes(Math.round(g)) && (
                <button
                  type="button"
                  onClick={addCurrentPreset}
                  aria-label="Добавить пресет"
                  className="shrink-0 whitespace-nowrap rounded-full border border-dashed border-stone-300 px-3 py-1 text-sm text-stone-500 active:border-emerald-500 active:text-emerald-700"
                >
                  + {fmt0(g)} г
                </button>
              )}
            </div>
          )}

          <div className="mt-2.5 whitespace-nowrap rounded-xl bg-emerald-50 px-3.5 py-2 text-[0.9375rem] text-emerald-900">
            <b className="text-xl">{fmt0(portion(kcal100))}</b> ккал · Б <b>{fmt0(portion(per100.protein))}</b> · Ж{' '}
            <b>{fmt0(portion(per100.fat))}</b> · У <b>{fmt0(portion(per100.carbs))}</b>
          </div>

          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

          <button
            type="button"
            onClick={handleAdd}
            disabled={saving}
            className="mt-2.5 w-full truncate rounded-full bg-emerald-600 py-3 text-base font-semibold text-white active:bg-emerald-700 disabled:opacity-60"
          >
            Добавить в «{meal?.name ?? 'приём'}»
          </button>
        </section>
      </div>
    </div>
  );
}
