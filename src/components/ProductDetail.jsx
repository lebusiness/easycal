import { useState } from 'react';
import {
  addDiaryEntry,
  updateDiaryEntry,
  deleteDiaryEntry,
  productKeyOf,
  saveFavoriteSnapshot,
  toggleMyProductFavorite,
  saveOverride,
  updateFavoritePresets,
  updateMyProduct,
} from '../db.js';
import { parseNum, round1, fmt1, formatTime, kcalFromMacros, notifyError, presetToObj } from '../utils.js';
import { fileToThumb } from '../image.js';
import Header from './Header.jsx';
import PortionPicker from './PortionPicker.jsx';
import GramsWheel from './GramsWheel.jsx';
import PhotoViewer from './PhotoViewer.jsx';
import { IconStar, IconCamera, IconTrash } from './Icons.jsx';
import { useBackClose } from '../navigation.js';

const MACROS = [
  { key: 'protein100', label: 'Белки' },
  { key: 'fat100', label: 'Жиры' },
  { key: 'carbs100', label: 'Углеводы' },
];

// entry задан — карточка открыта по записи дневника: тот же UI (избранное,
// пресеты, БЖУ), но кнопка сохраняет изменения в записи, а не создаёт новую
export default function ProductDetail({ product, entry, date, meal, meals, onMealChange, onEdit, onBack, onAdded, onDeleted }) {
  useBackClose(onBack);
  // Значения из OFF бывают вида 7.699999809 — приводим к одному знаку
  const [vals, setVals] = useState(() =>
    Object.fromEntries(
      MACROS.map((m) => [m.key, product[m.key] != null ? String(round1(product[m.key])) : ''])
    )
  );
  // У составного продукта порция по умолчанию — всё блюдо целиком
  const [grams, setGrams] = useState(() => {
    if (entry) return String(entry.grams);
    const total = product.ingredients?.reduce((s, ing) => s + (ing.g > 0 ? ing.g : 0), 0);
    return total > 0 ? String(round1(total)) : '100';
  });
  const [time, setTime] = useState(() => (entry ? formatTime(entry.addedAt) ?? '' : ''));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [favSaved, setFavSaved] = useState(!!product.favorite);
  const [favId, setFavId] = useState(product.favId ?? null);
  // Пресеты нормализуем к объектам { g, label?, photo? } (старый формат — числа)
  const [presets, setPresets] = useState(() =>
    product.presets?.length ? product.presets.map(presetToObj) : null
  );
  const [editingPresetG, setEditingPresetG] = useState(null); // граммы редактируемого пресета
  const [patchSaved, setPatchSaved] = useState(false);
  const [productSaved, setProductSaved] = useState(false); // БЖУ записаны в свой продукт
  // БЖУ: барабан (целые) или клавиатура (с десятыми, например 7,7); режим общий с формой продукта
  const [macroKeyboard, setMacroKeyboard] = useState(() => {
    try {
      return localStorage.getItem('macroMode') === 'input';
    } catch {
      return false;
    }
  });
  function toggleMacroMode() {
    const next = !macroKeyboard;
    setMacroKeyboard(next);
    try {
      localStorage.setItem('macroMode', next ? 'input' : 'wheel');
    } catch {
      /* приватный режим */
    }
  }

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

  const isMine = product.source === 'mine' && product.id != null;

  // Управление пресетами прямо в карточке — только для избранных продуктов из базы
  // (у них нет формы редактирования) и только при редактировании записи дневника:
  // при обычном добавлении строка дублировала бы чипы выбора порции. Свои продукты
  // настраиваются через «Редактировать».
  const canEditPresets = entry != null && favSaved && !isMine;

  function currentProduct() {
    return {
      ...product,
      kcal100: round1(kcal100),
      protein100: round1(per100.protein ?? 0),
      fat100: round1(per100.fat ?? 0),
      carbs100: round1(per100.carbs ?? 0),
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
    const portionOf = {
      grams: round1(g),
      kcal: round1((p.kcal100 * g) / 100),
      protein: round1((p.protein100 * g) / 100),
      fat: round1((p.fat100 * g) / 100),
      carbs: round1((p.carbs100 * g) / 100),
    };
    setSaving(true);
    try {
      if (entry) {
        // Редактирование существующей записи: обновляем порцию, приём, время и снапшот БЖУ
        let addedAt = entry.addedAt ?? null;
        if (time) {
          const [y, mo, d] = entry.date.split('-').map(Number);
          const [hh, mm] = time.split(':').map(Number);
          addedAt = new Date(y, mo - 1, d, hh, mm).toISOString();
        }
        await updateDiaryEntry(entry.id, {
          ...portionOf,
          mealId: meal.id,
          mealLabel: meal.name,
          addedAt,
          kcal100: p.kcal100,
          protein100: p.protein100,
          fat100: p.fat100,
          carbs100: p.carbs100,
        });
        onAdded();
        return;
      }
      const name =
        product.brand && !product.name.toLowerCase().includes(product.brand.toLowerCase())
          ? `${product.name} (${product.brand})`
          : product.name;
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
        ...portionOf,
        addedAt: new Date().toISOString(),
      });
      onAdded();
    } catch {
      setSaving(false);
      setError('Не удалось сохранить запись — проверьте связь с сервером.');
    }
  }

  async function handleDeleteEntry() {
    try {
      await deleteDiaryEntry(entry.id);
      onDeleted?.();
    } catch (e) {
      notifyError(e);
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
    const v = round1(g);
    if ((presets ?? []).some((p) => p.g === v)) return;
    const next = [...(presets ?? []), { g: v }].sort((a, b) => a.g - b.g);
    savePresets(next);
  }

  function removePreset(gv) {
    const next = (presets ?? []).filter((p) => p.g !== gv);
    savePresets(next.length ? next : null);
  }

  // Подпись и фото пресета (например, «большой банан» + снимок)
  function updatePreset(gv, changes) {
    const next = (presets ?? []).map((p) => {
      if (p.g !== gv) return p;
      const merged = { g: p.g, ...changes };
      if (!merged.label) delete merged.label;
      if (!merged.photo) delete merged.photo;
      return merged;
    });
    savePresets(next);
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

  // Записать изменённые БЖУ в сам свой продукт (по умолчанию они действуют
  // только на текущую запись дневника)
  async function handleSaveToProduct() {
    try {
      const p = currentProduct();
      await updateMyProduct(product.id, {
        kcal100: p.kcal100,
        protein100: p.protein100,
        fat100: p.fat100,
        carbs100: p.carbs100,
      });
      setProductSaved(true);
    } catch (e) {
      notifyError(e);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md pb-8">
      <Header title={entry ? 'Запись в дневнике' : 'Добавить в дневник'} onBack={onBack} />

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
                {fmt1(kcal100)}
              </div>
            </div>
            {MACROS.map((m) => (
              <div key={m.key} className="text-center">
                <span className="mb-1 block whitespace-nowrap text-[0.6875rem] text-stone-500">{m.label}</span>
                <div className={product[m.key] == null && !vals[m.key] ? 'rounded-xl ring-1 ring-amber-300' : ''}>
                  {macroKeyboard ? (
                    <input
                      value={vals[m.key]}
                      onChange={(e) => {
                        setVals((prev) => ({ ...prev, [m.key]: e.target.value }));
                        setPatchSaved(false);
                        setProductSaved(false);
                      }}
                      inputMode="decimal"
                      onFocus={(e) => e.target.select()}
                      aria-label={`${m.label} на 100 г`}
                      className="h-[120px] w-full rounded-xl border border-stone-200 bg-stone-50 text-center text-xl font-bold outline-none focus:border-emerald-500"
                    />
                  ) : (
                    <GramsWheel
                      value={vals[m.key]}
                      onChange={(v) => {
                        setVals((prev) => ({ ...prev, [m.key]: v }));
                        setPatchSaved(false);
                        setProductSaved(false);
                      }}
                      min={0}
                      max={100}
                      unit=""
                      ariaLabel={`${m.label} на 100 г`}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="text-[0.6875rem] text-stone-400">
              {anyMissing
                ? 'Нет части данных — выставьте БЖУ (на 100 г)'
                : dirty
                  ? 'БЖУ изменены — только для этой записи'
                  : 'На 100 г'}
            </span>
            <button
              type="button"
              onClick={toggleMacroMode}
              className="px-1 text-xs font-semibold text-emerald-700 active:text-emerald-800"
            >
              {macroKeyboard ? 'БЖУ барабаном' : 'БЖУ с клавиатуры'}
            </button>
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
            {isMine &&
              (dirty ? (
                <button
                  type="button"
                  onClick={handleSaveToProduct}
                  disabled={productSaved}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold active:bg-stone-50 ${
                    productSaved
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border-stone-200 text-stone-600'
                  }`}
                >
                  {productSaved ? '✓ Сохранено в продукт' : 'Сохранить в продукт'}
                </button>
              ) : (
                onEdit && (
                  <button
                    type="button"
                    onClick={() => onEdit({ ...product, presets, favorite: favSaved })}
                    className="rounded-full border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-600 active:bg-stone-50"
                  >
                    Редактировать
                  </button>
                )
              ))}
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

          {canEditPresets && (
            <div className="no-scrollbar mt-2.5 flex items-center gap-1.5 overflow-x-auto">
              <span className="shrink-0 text-xs text-stone-500">Пресеты:</span>
              {(presets ?? []).map((p) => (
                <span
                  key={p.g}
                  className="flex shrink-0 items-center whitespace-nowrap rounded-full bg-amber-50 py-1 pr-1 text-sm font-medium text-amber-800"
                >
                  <button
                    type="button"
                    onClick={() => setEditingPresetG(p.g)}
                    aria-label={`Настроить пресет ${p.g} г — фото и подпись`}
                    className={`flex items-center gap-1.5 active:opacity-70 ${p.photo ? 'pl-1' : 'pl-3'}`}
                  >
                    {p.photo ? (
                      <img src={p.photo} alt="" className="h-6 w-6 rounded-full object-cover" />
                    ) : (
                      <IconCamera className="h-3.5 w-3.5 text-amber-500" />
                    )}
                    {p.label ? `${p.label} · ${p.g} г` : `${p.g} г`}
                  </button>
                  <button
                    type="button"
                    onClick={() => removePreset(p.g)}
                    aria-label={`Убрать пресет ${p.g} г`}
                    className="ml-0.5 rounded-full p-1 text-amber-600 active:bg-amber-100"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                </span>
              ))}
              {g != null && g > 0 && !(presets ?? []).some((p) => p.g === round1(g)) && (
                <button
                  type="button"
                  onClick={addCurrentPreset}
                  aria-label="Добавить пресет"
                  className="shrink-0 whitespace-nowrap rounded-full border border-dashed border-stone-300 px-3 py-1 text-sm text-stone-500 active:border-emerald-500 active:text-emerald-700"
                >
                  + {fmt1(g)} г
                </button>
              )}
            </div>
          )}

          {entry && (
            <label className="mt-2.5 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-stone-500">Время добавления</span>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-28 shrink-0 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-center text-sm font-semibold outline-none focus:border-emerald-500"
              />
            </label>
          )}

          <div className="mt-2.5 rounded-xl bg-emerald-50 px-3.5 py-2 text-[0.9375rem] text-emerald-900">
            <b className="text-xl">{fmt1(portion(kcal100))}</b> ккал · Б <b>{fmt1(portion(per100.protein))}</b> · Ж{' '}
            <b>{fmt1(portion(per100.fat))}</b> · У <b>{fmt1(portion(per100.carbs))}</b>
          </div>

          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

          <button
            type="button"
            onClick={handleAdd}
            disabled={saving}
            className="mt-2.5 w-full truncate rounded-full bg-emerald-600 py-3 text-base font-semibold text-white active:bg-emerald-700 disabled:opacity-60"
          >
            {entry ? 'Сохранить' : `Добавить в «${meal?.name ?? 'приём'}»`}
          </button>

          {entry && (
            <button
              type="button"
              onClick={handleDeleteEntry}
              className="mt-1.5 w-full rounded-full py-2.5 text-sm font-semibold text-red-600 active:bg-red-50"
            >
              Удалить запись
            </button>
          )}
        </section>
      </div>

      {editingPresetG != null && (
        <PresetEditor
          preset={(presets ?? []).find((p) => p.g === editingPresetG) ?? { g: editingPresetG }}
          onSave={(changes) => updatePreset(editingPresetG, changes)}
          onClose={() => setEditingPresetG(null)}
        />
      )}
    </div>
  );
}

// Настройка пресета порции: подпись («большой банан») и фото-миниатюра
function PresetEditor({ preset, onSave, onClose }) {
  useBackClose(onClose);
  const [label, setLabel] = useState(preset.label ?? '');
  const [photo, setPhoto] = useState(preset.photo ?? null);
  const [processing, setProcessing] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);

  async function applyFile(file) {
    setProcessing(true);
    try {
      setPhoto(await fileToThumb(file));
    } catch (err) {
      notifyError(err);
    }
    setProcessing(false);
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) applyFile(file);
  }

  function handleSave() {
    onSave({ label: label.trim(), photo });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold">Пресет {preset.g} г</h3>
        <p className="mt-0.5 text-xs text-stone-500">
          Подпись и фото помогут узнавать порцию — например, «большой банан»
        </p>

        <div className="mt-3 flex items-center gap-3">
          {photo ? (
            // Тап по фото — просмотр на весь экран (там же замена и удаление)
            <button type="button" onClick={() => setViewerOpen(true)} className="relative shrink-0 active:opacity-70">
              <img src={photo} alt="Фото пресета" className="h-20 w-20 rounded-xl object-cover" />
              {processing && <ProcessingOverlay />}
            </button>
          ) : (
            <label className="relative shrink-0 cursor-pointer">
              <span className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-stone-300 text-stone-400">
                <IconCamera className="h-6 w-6" />
                <span className="text-[0.625rem] font-medium">Фото</span>
              </span>
              <input type="file" accept="image/*" onChange={handleFile} className="sr-only" />
              {processing && <ProcessingOverlay />}
            </label>
          )}

          <div className="min-w-0 flex-1">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-stone-500">Подпись</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Например, большой"
                className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-[0.9375rem] outline-none placeholder:text-stone-400 focus:border-emerald-500"
              />
            </label>
            {photo && (
              <button
                type="button"
                onClick={() => setPhoto(null)}
                className="mt-1.5 flex items-center gap-1 px-1 text-xs font-semibold text-stone-500 active:text-red-600"
              >
                <IconTrash className="h-3.5 w-3.5" />
                Убрать фото
              </button>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={processing}
          className="mt-4 w-full rounded-full bg-emerald-600 py-3 text-[0.9375rem] font-semibold text-white active:bg-emerald-700 disabled:opacity-60"
        >
          Сохранить
        </button>
      </div>

      {viewerOpen && photo && (
        <PhotoViewer
          src={photo}
          onClose={() => setViewerOpen(false)}
          onPickFile={applyFile}
          onRemove={() => setPhoto(null)}
        />
      )}
    </div>
  );
}

function ProcessingOverlay() {
  return (
    <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/60">
      <svg viewBox="0 0 24 24" className="h-6 w-6 animate-spin text-emerald-600" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
        <path d="M22 12A10 10 0 0 0 12 2" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      </svg>
    </span>
  );
}
