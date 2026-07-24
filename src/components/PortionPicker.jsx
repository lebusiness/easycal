import { useState } from 'react';
import GramsWheel from './GramsWheel.jsx';
import { parseNum, fmt0 } from '../utils.js';

const GRAM_PRESETS = [50, 100, 150, 200];

// Выбор веса порции: горизонтальный барабан (по умолчанию) или клавиатура; режим запоминается.
// presets — свои пресеты граммов продукта (из избранного), иначе дефолтные.
export default function PortionPicker({ grams, onChange, presets }) {
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem('gramsMode') || 'wheel';
    } catch {
      return 'wheel';
    }
  });

  function switchMode() {
    const next = mode === 'wheel' ? 'input' : 'wheel';
    setMode(next);
    try {
      localStorage.setItem('gramsMode', next);
    } catch {
      /* приватный режим */
    }
  }

  const g = parseNum(grams);

  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor={mode === 'input' ? 'grams' : undefined} className="text-xs font-medium text-stone-500">
          Порция: <b className="text-sm text-stone-900">{g != null ? `${fmt0(g)} г` : '—'}</b>
        </label>
        <button
          type="button"
          onClick={switchMode}
          className="px-1 py-1 text-xs font-semibold text-emerald-700 active:text-emerald-800"
        >
          {mode === 'wheel' ? 'Ввести с клавиатуры' : 'Крутить барабан'}
        </button>
      </div>

      {mode === 'wheel' ? (
        <div className="mt-1.5">
          <GramsWheel value={grams} onChange={onChange} />
        </div>
      ) : (
        <input
          id="grams"
          value={grams}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          autoFocus
          onFocus={(e) => e.target.select()}
          className="mt-1.5 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-center text-xl font-bold outline-none focus:border-emerald-500"
        />
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {(presets?.length ? presets : GRAM_PRESETS).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(String(v))}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium active:bg-stone-100 ${
              g === v
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                : 'border-stone-200 text-stone-600'
            }`}
          >
            {v} г
          </button>
        ))}
      </div>
    </div>
  );
}
