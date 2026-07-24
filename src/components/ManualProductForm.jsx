import { useState } from 'react';
import { addMyProduct } from '../db.js';
import { parseNum, kcalFromMacros, fmt0 } from '../utils.js';
import Header from './Header.jsx';
import GramsWheel from './GramsWheel.jsx';
import { useBackClose } from '../navigation.js';

const MACROS = [
  { key: 'protein', label: 'Белки' },
  { key: 'fat', label: 'Жиры' },
  { key: 'carbs', label: 'Углеводы' },
];

export default function ManualProductForm({ prefill, onBack, onSaved }) {
  useBackClose(onBack);
  const [form, setForm] = useState({
    name: prefill?.name ?? '',
    description: '',
    barcode: prefill?.barcode ?? '',
    protein: '0',
    fat: '0',
    carbs: '0',
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

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

    setSaving(true);
    try {
      const product = await addMyProduct({
        name,
        description: form.description.trim() || null,
        barcode: barcode || null,
        kcal100: kcal,
        protein100: macros.protein,
        fat100: macros.fat,
        carbs100: macros.carbs,
      });
      onSaved(product);
    } catch {
      setSaving(false);
      setError('Не удалось сохранить продукт. Попробуйте ещё раз.');
    }
  }

  return (
    <div className="mx-auto w-full max-w-md pb-8">
      <Header title="Новый продукт" onBack={onBack} />

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

          <Field label="Описание (необязательно)" className="mt-2.5">
            <textarea
              value={form.description}
              onChange={set('description')}
              placeholder="Заметка: марка, магазин, состав…"
              rows={2}
              className={`${inputCls} resize-none`}
            />
          </Field>

          <div className="mt-2.5 grid grid-cols-4 gap-1.5">
            <div className="text-center">
              <span className="mb-1 block whitespace-nowrap text-[0.6875rem] font-medium text-emerald-800">Ккал</span>
              <div className="flex h-[120px] items-center justify-center rounded-xl bg-emerald-50 text-xl font-bold text-emerald-900">
                {fmt0(kcal)}
              </div>
            </div>
            {MACROS.map((m) => (
              <div key={m.key} className="text-center">
                <span className="mb-1 block whitespace-nowrap text-[0.6875rem] font-medium text-stone-500">{m.label}</span>
                <GramsWheel
                  value={form[m.key]}
                  onChange={(v) => setForm((f2) => ({ ...f2, [m.key]: v }))}
                  min={0}
                  max={100}
                  unit=""
                  ariaLabel={`${m.label} на 100 г`}
                />
              </div>
            ))}
          </div>
          <p className="mt-1 text-[0.6875rem] text-stone-400">На 100 г продукта</p>

          <Field label="Штрихкод (необязательно)" className="mt-2.5">
            <input
              value={form.barcode}
              onChange={set('barcode')}
              inputMode="numeric"
              placeholder="4600000000000"
              className={inputCls}
            />
          </Field>

          <p className="mt-2 text-[0.6875rem] text-stone-500">
            Продукт появится во вкладке «Свои» и найдётся поиском
            {form.barcode.trim() ? ' и по штрихкоду' : ''} даже офлайн.
          </p>
        </div>

        {error && <p className="mt-3 px-1 text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="mt-3 w-full rounded-full bg-emerald-600 py-3.5 text-base font-semibold text-white active:bg-emerald-700 disabled:opacity-60"
        >
          Сохранить продукт
        </button>
      </form>
    </div>
  );
}

const inputCls =
  'w-full rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5 text-[0.9375rem] outline-none placeholder:text-stone-400 focus:border-emerald-500';

function Field({ label, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-stone-500">{label}</span>
      {children}
    </label>
  );
}
