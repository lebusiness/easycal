import { useState } from 'react';
import GramsWheel from './GramsWheel.jsx';
import PhotoViewer from './PhotoViewer.jsx';
import { parseNum, fmt1, round3, presetToObj } from '../utils.js';

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
  const [viewPhoto, setViewPhoto] = useState(null); // фото пресета на весь экран

  // Повторные тапы по одному пресету суммируют порции: 150 г → 300 г → 450 г.
  // Счёт живёт, пока граммы не изменили другим способом (барабан/клавиатура).
  const [multi, setMulti] = useState(null); // { g, count }

  function tapPreset(pg) {
    const cur = parseNum(grams);
    if (multi && multi.g === pg && cur != null && cur === round3(pg * multi.count)) {
      const count = multi.count + 1;
      setMulti({ g: pg, count });
      onChange(String(round3(pg * count)));
    } else {
      setMulti({ g: pg, count: 1 });
      onChange(String(pg));
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor={mode === 'input' ? 'grams' : undefined} className="text-xs font-medium text-stone-500">
          Порция: <b className="text-sm text-stone-900">{g != null ? `${fmt1(g)} г` : '—'}</b>
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

      <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
        {(presets?.length ? presets : GRAM_PRESETS).map(presetToObj).map((p) => {
          const count =
            multi && multi.g === p.g && g === round3(p.g * multi.count)
              ? multi.count
              : g === p.g
                ? 1
                : 0;
          return (
            <button
              key={p.g}
              type="button"
              onClick={() => tapPreset(p.g)}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border py-1.5 text-sm font-medium active:bg-stone-100 ${
                p.photo ? 'pl-1.5 pr-4' : 'px-4'
              } ${
                count > 0
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                  : 'border-stone-200 text-stone-600'
              }`}
            >
              {p.photo && (
                <img
                  src={p.photo}
                  alt=""
                  onClick={(e) => {
                    // тап по миниатюре — просмотр на весь экран, а не выбор порции
                    e.stopPropagation();
                    setViewPhoto(p.photo);
                  }}
                  className="h-7 w-7 rounded-full object-cover"
                />
              )}
              {p.label ? `${p.label} · ${p.g} г` : `${p.g} г`}
              {count > 1 && <span className="font-bold">×{count}</span>}
            </button>
          );
        })}
      </div>

      {viewPhoto && <PhotoViewer src={viewPhoto} onClose={() => setViewPhoto(null)} />}
    </div>
  );
}
