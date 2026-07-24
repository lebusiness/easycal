import { useState } from 'react';
import { addMyProduct } from '../db.js';
import { parseNum, kcalFromMacros, fmt0 } from '../utils.js';
import Header from './Header.jsx';

export default function ManualProductForm({ prefill, onBack, onSaved }) {
  const [form, setForm] = useState({
    name: prefill?.name ?? '',
    description: '',
    barcode: prefill?.barcode ?? '',
    protein: '',
    fat: '',
    carbs: '',
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const p = parseNum(form.protein);
  const f = parseNum(form.fat);
  const c = parseNum(form.carbs);
  const kcal = p != null || f != null || c != null ? kcalFromMacros(p, f, c) : null;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    const name = form.name.trim();
    if (!name) {
      setError('Введите название продукта');
      return;
    }
    const macros = {};
    for (const [key, value, label] of [
      ['protein', p, 'белков'],
      ['fat', f, 'жиров'],
      ['carbs', c, 'углеводов'],
    ]) {
      const raw = form[key].trim();
      const n = raw ? value : 0;
      if (n == null || n < 0) {
        setError(`Некорректное значение ${label} — введите число не меньше 0`);
        return;
      }
      macros[key] = n;
    }
    if (!form.protein.trim() && !form.fat.trim() && !form.carbs.trim()) {
      setError('Заполните хотя бы одно из полей Б/Ж/У (можно нулями)');
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
        kcal100: kcalFromMacros(macros.protein, macros.fat, macros.carbs),
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

          <div className="mt-2.5 grid grid-cols-3 gap-2">
            <Field label="Белки, г *">
              <input value={form.protein} onChange={set('protein')} inputMode="decimal" placeholder="0" className={inputCls} />
            </Field>
            <Field label="Жиры, г *">
              <input value={form.fat} onChange={set('fat')} inputMode="decimal" placeholder="0" className={inputCls} />
            </Field>
            <Field label="Углеводы, г *">
              <input value={form.carbs} onChange={set('carbs')} inputMode="decimal" placeholder="0" className={inputCls} />
            </Field>
          </div>

          <div className="mt-2.5 rounded-xl bg-emerald-50 px-3 py-1.5 text-center text-sm text-emerald-900">
            Калорийность: <b className="text-base">{kcal != null ? `${fmt0(kcal)} ккал / 100 г` : '—'}</b>{' '}
            <span className="text-emerald-700">(считается из БЖУ автоматически)</span>
          </div>

          <Field label="Штрихкод (необязательно)" className="mt-2.5">
            <input
              value={form.barcode}
              onChange={set('barcode')}
              inputMode="numeric"
              placeholder="4600000000000"
              className={inputCls}
            />
          </Field>

          <p className="mt-2 text-[11px] text-stone-500">
            Значения указываются на 100 г. Продукт появится во вкладке «Свои», будет находиться поиском
            {form.barcode.trim() ? ' и по штрихкоду' : ''} даже офлайн, и его можно добавить в избранное.
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
  'w-full rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5 text-[15px] outline-none placeholder:text-stone-400 focus:border-emerald-500';

function Field({ label, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-stone-500">{label}</span>
      {children}
    </label>
  );
}
