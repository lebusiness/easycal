import { useState } from 'react';
import { addMyProduct, updateMyProduct, deleteMyProduct } from '../db.js';
import { parseNum, round1, kcalFromMacros, fmt1, notifyError, presetToObj } from '../utils.js';
import { fileToThumb } from '../image.js';
import Header from './Header.jsx';
import GramsWheel from './GramsWheel.jsx';
import PhotoViewer from './PhotoViewer.jsx';
import { IconStar, IconCamera, IconClose } from './Icons.jsx';
import { useBackClose } from '../navigation.js';

const MACROS = [
  { key: 'protein', label: 'Белки' },
  { key: 'fat', label: 'Жиры' },
  { key: 'carbs', label: 'Углеводы' },
];

// product задан — редактирование существующего своего продукта, иначе создание нового
export default function ManualProductForm({ prefill, product, onBack, onSaved, onDeleted }) {
  useBackClose(onBack);
  const editing = product != null;
  const [form, setForm] = useState({
    name: product?.name ?? prefill?.name ?? '',
    description: product?.description ?? '',
    barcode: product?.barcode ?? prefill?.barcode ?? '',
    protein: product?.protein100 != null ? String(product.protein100) : '0',
    fat: product?.fat100 != null ? String(product.fat100) : '0',
    carbs: product?.carbs100 != null ? String(product.carbs100) : '0',
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  // Описание и штрихкод скрыты, пока не нужны, — форма короче на экран
  const [showDescription, setShowDescription] = useState(!!product?.description);
  const [showBarcode, setShowBarcode] = useState(!!(product?.barcode ?? prefill?.barcode));
  // БЖУ: барабан (целые) или клавиатура (с десятыми, например 7,7); режим общий с карточкой продукта
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
  // Сохранять ли продукт в «Свои» (иначе — разовый, только запись в дневник)
  // и закреплять ли его сразу в избранном
  const [saveToMine, setSaveToMine] = useState(true);
  const [pinFavorite, setPinFavorite] = useState(!!product?.favorite);
  // Порции-пресеты с фото: например, «маленький 80 г / средний 110 г / большой 150 г»
  const [portions, setPortions] = useState(() =>
    (product?.presets ?? [])
      .map(presetToObj)
      .map((p) => ({ g: String(p.g), label: p.label ?? '', photo: p.photo ?? null }))
  );
  const [viewPhotoIdx, setViewPhotoIdx] = useState(null); // индекс порции с открытым фото

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setPortion = (i, changes) =>
    setPortions((list) => list.map((r, j) => (j === i ? { ...r, ...changes } : r)));

  async function setPortionPhoto(i, file) {
    try {
      setPortion(i, { photo: await fileToThumb(file) });
    } catch (err) {
      notifyError(err);
    }
  }

  const macros = {
    protein: parseNum(form.protein) ?? 0,
    fat: parseNum(form.fat) ?? 0,
    carbs: parseNum(form.carbs) ?? 0,
  };
  const kcal = kcalFromMacros(macros.protein, macros.fat, macros.carbs);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    const name = form.name.trim();
    if (!name) {
      setError('Введите название продукта');
      return;
    }
    const barcode = form.barcode.trim();
    if (barcode && !/^\d{4,14}$/.test(barcode)) {
      setError('Штрихкод должен состоять только из цифр (4–14 знаков)');
      return;
    }

    // Порции-пресеты: пустые строки пропускаем, дубли граммов схлопываем
    const presets = [];
    for (const row of portions) {
      if (!row.label.trim() && !row.photo && !row.g.trim()) continue;
      const gv = parseNum(row.g);
      if (gv == null || gv <= 0) {
        setError('У порции укажите вес в граммах (число больше 0)');
        return;
      }
      const v = round1(gv);
      if (presets.some((p) => p.g === v)) continue;
      const p = { g: v };
      if (row.label.trim()) p.label = row.label.trim();
      if (row.photo) p.photo = row.photo;
      presets.push(p);
    }
    presets.sort((a, b) => a.g - b.g);

    const data = {
      name,
      description: form.description.trim() || null,
      barcode: barcode || null,
      kcal100: kcal,
      protein100: round1(macros.protein),
      fat100: round1(macros.fat),
      carbs100: round1(macros.carbs),
      presets: presets.length ? presets : null,
    };

    // Разовый продукт: в «Свои» не сохраняем, сразу переходим к добавлению в дневник
    if (!editing && !saveToMine) {
      onSaved({ source: 'manual', ...data, favorite: false });
      return;
    }

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
      <Header title={editing ? 'Редактировать продукт' : 'Новый продукт'} onBack={onBack} />

      <form onSubmit={handleSubmit} className="px-3">
        {prefill?.notice && (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {prefill.notice}
          </div>
        )}

        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <Field label="Название *">
            <input
              value={form.name}
              onChange={set('name')}
              placeholder="Например, творог 5%"
              autoFocus={!form.name}
              className={inputCls}
            />
          </Field>

          {(!showDescription || !showBarcode) && (
            <div className="mt-1.5 flex gap-3">
              {!showDescription && (
                <button
                  type="button"
                  onClick={() => setShowDescription(true)}
                  className="px-1 text-xs font-semibold text-emerald-700 active:text-emerald-800"
                >
                  + Описание
                </button>
              )}
              {!showBarcode && (
                <button
                  type="button"
                  onClick={() => setShowBarcode(true)}
                  className="px-1 text-xs font-semibold text-emerald-700 active:text-emerald-800"
                >
                  + Штрихкод
                </button>
              )}
            </div>
          )}

          {showDescription && (
            <Field label="Описание" className="mt-2.5">
              <textarea
                value={form.description}
                onChange={set('description')}
                placeholder="Заметка: марка, магазин, состав…"
                rows={2}
                autoFocus={!form.description}
                className={`${inputCls} resize-none`}
              />
            </Field>
          )}

          <div className="mt-2.5 grid grid-cols-4 gap-1.5">
            <div className="text-center">
              <span className="mb-1 block whitespace-nowrap text-[0.6875rem] font-medium text-emerald-800">Ккал</span>
              <div className="flex h-[120px] items-center justify-center rounded-xl bg-emerald-50 text-xl font-bold text-emerald-900">
                {fmt1(kcal)}
              </div>
            </div>
            {MACROS.map((m) => (
              <div key={m.key} className="text-center">
                <span className="mb-1 block whitespace-nowrap text-[0.6875rem] font-medium text-stone-500">{m.label}</span>
                {macroKeyboard ? (
                  <input
                    value={form[m.key]}
                    onChange={(e) => setForm((f2) => ({ ...f2, [m.key]: e.target.value }))}
                    inputMode="decimal"
                    onFocus={(e) => e.target.select()}
                    aria-label={`${m.label} на 100 г`}
                    className="h-[120px] w-full rounded-xl border border-stone-200 bg-stone-50 text-center text-xl font-bold outline-none focus:border-emerald-500"
                  />
                ) : (
                  <GramsWheel
                    value={form[m.key]}
                    onChange={(v) => setForm((f2) => ({ ...f2, [m.key]: v }))}
                    min={0}
                    max={100}
                    unit=""
                    ariaLabel={`${m.label} на 100 г`}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="mt-1 flex items-center justify-between">
            <p className="text-[0.6875rem] text-stone-400">На 100 г продукта</p>
            <button
              type="button"
              onClick={toggleMacroMode}
              className="px-1 text-xs font-semibold text-emerald-700 active:text-emerald-800"
            >
              {macroKeyboard ? 'БЖУ барабаном' : 'БЖУ с клавиатуры'}
            </button>
          </div>

          {showBarcode && (
            <Field label="Штрихкод" className="mt-2.5">
              <input
                value={form.barcode}
                onChange={set('barcode')}
                inputMode="numeric"
                placeholder="4600000000000"
                autoFocus={!form.barcode}
                className={inputCls}
              />
            </Field>
          )}

          <div className="mt-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-stone-500">Порции с фото</span>
              <button
                type="button"
                onClick={() => setPortions((list) => [...list, { g: '', label: '', photo: null }])}
                className="px-1 text-xs font-semibold text-emerald-700 active:text-emerald-800"
              >
                + Добавить порцию
              </button>
            </div>
            {portions.length === 0 && (
              <p className="mt-0.5 text-[0.6875rem] text-stone-400">
                Например: маленький 80 г / большой 150 г
              </p>
            )}

            {portions.map((row, i) => (
              <div key={i} className="mt-1.5 flex items-center gap-1.5">
                {row.photo ? (
                  <button
                    type="button"
                    onClick={() => setViewPhotoIdx(i)}
                    aria-label="Открыть фото порции"
                    className="shrink-0 active:opacity-70"
                  >
                    <img src={row.photo} alt="" className="h-9 w-9 rounded-lg object-cover" />
                  </button>
                ) : (
                  <label className="shrink-0 cursor-pointer" aria-label="Добавить фото порции">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-dashed border-stone-300 text-stone-400">
                      <IconCamera className="h-4.5 w-4.5" />
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) setPortionPhoto(i, f);
                      }}
                    />
                  </label>
                )}
                <input
                  value={row.label}
                  onChange={(e) => setPortion(i, { label: e.target.value })}
                  placeholder="Название: большой…"
                  className={`${portionInputCls} min-w-0 flex-1`}
                />
                <input
                  value={row.g}
                  onChange={(e) => setPortion(i, { g: e.target.value })}
                  inputMode="decimal"
                  placeholder="вес, г"
                  className={`${portionInputCls} w-[4.25rem] shrink-0 text-center`}
                />
                <button
                  type="button"
                  onClick={() => setPortions((list) => list.filter((_, j) => j !== i))}
                  aria-label="Убрать порцию"
                  className="-mx-1 shrink-0 rounded-full p-1.5 text-stone-300 active:bg-red-50 active:text-red-600"
                >
                  <IconClose className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-2.5 space-y-1.5">
            {!editing && (
              <ToggleRow
                checked={saveToMine}
                onChange={setSaveToMine}
                label="Сохранить в «Свои продукты»"
                hint={
                  saveToMine
                    ? `Появится во вкладке «Свои» и найдётся поиском${form.barcode.trim() ? ' и по штрихкоду' : ''} даже офлайн`
                    : 'Разовый продукт: попадёт только в дневник'
                }
              />
            )}
            {(editing || saveToMine) && (
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
            )}
          </div>
        </div>

        {error && <p className="mt-3 px-1 text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="mt-3 w-full rounded-full bg-emerald-600 py-3.5 text-base font-semibold text-white active:bg-emerald-700 disabled:opacity-60"
        >
          {editing ? 'Сохранить изменения' : saveToMine ? 'Сохранить продукт' : 'Далее — к порции'}
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

      {viewPhotoIdx != null && portions[viewPhotoIdx]?.photo && (
        <PhotoViewer
          src={portions[viewPhotoIdx].photo}
          onClose={() => setViewPhotoIdx(null)}
          onPickFile={(f) => setPortionPhoto(viewPhotoIdx, f)}
          onRemove={() => setPortion(viewPhotoIdx, { photo: null })}
        />
      )}
    </div>
  );
}

export function ToggleRow({ checked, onChange, label, hint }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 rounded-xl bg-stone-50 px-3 py-2 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-stone-800">{label}</span>
        {hint && <span className="mt-0.5 block text-[0.6875rem] leading-snug text-stone-500">{hint}</span>}
      </span>
      <span
        className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-emerald-500' : 'bg-stone-300'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${
            checked ? 'left-[1.125rem]' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  );
}

const inputCls =
  'w-full rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5 text-[0.9375rem] outline-none placeholder:text-stone-400 focus:border-emerald-500';

// Для строк порций: без w-full (ширину задаёт строка) и компактнее по высоте
const portionInputCls =
  'rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2 text-sm outline-none placeholder:text-stone-400 focus:border-emerald-500';

function Field({ label, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-stone-500">{label}</span>
      {children}
    </label>
  );
}
