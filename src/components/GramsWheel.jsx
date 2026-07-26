import { useEffect, useMemo, useRef, useState } from 'react';
import { parseNum } from '../utils.js';

const ITEM_H = 40; // px, высота пункта барабана
const WHEEL_H = 120; // 3 видимых пункта
const PAD = (WHEEL_H - ITEM_H) / 2; // отступы, чтобы крайние значения вставали по центру

// Вертикальный барабан выбора значения: крутится пальцем, значение фиксируется по центру.
// Крутится по целым, но точные значения вне сетки (7,7 из базы, 600 с клавиатуры)
// не теряются: такое значение становится отдельным пунктом барабана и остаётся
// выбранным, пока его не сменили прокруткой.
export default function GramsWheel({ value, onChange, min = 1, max = 500, step = 1, unit = 'г', ariaLabel = 'Выбор веса порции' }) {
  const grid = useMemo(() => {
    const arr = [];
    for (let v = min; v <= max; v += step) arr.push(v);
    return arr;
  }, [min, max, step]);

  const ref = useRef(null);
  const fromScrollRef = useRef(null);
  const current = parseNum(String(value)) ?? 0;

  const offGrid = (v) => Number.isFinite(v) && v >= min && !grid.includes(v);

  // Пункты вне сетки живут до закрытия экрана: индексы стабильны, и к своему
  // точному значению можно вернуться прокруткой
  const [extras, setExtras] = useState(() => (offGrid(current) ? [current] : []));
  useEffect(() => {
    if (offGrid(current)) {
      setExtras((xs) => (xs.includes(current) ? xs : [...xs, current]));
    }
  }, [current, grid]); // eslint-disable-line react-hooks/exhaustive-deps

  const values = useMemo(() => [...grid, ...extras].sort((a, b) => a - b), [grid, extras]);

  const nearestIndex = (v) => {
    let best = 0;
    let bestDist = Infinity;
    values.forEach((x, i) => {
      const d = Math.abs(x - v);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  };

  // Подкрутка к внешнему значению (пресеты, первый рендер). Изменения, пришедшие
  // от прокрутки самого барабана, пропускаем — иначе он дёргается под пальцем.
  useEffect(() => {
    if (fromScrollRef.current === current) {
      fromScrollRef.current = null;
      return;
    }
    const el = ref.current;
    if (!el) return;
    // Значение ещё не попало в список пунктов (ждём extras) — не крутим, иначе
    // прокрутка к «ближайшему» пункту перезапишет точное значение
    const idx = values.indexOf(current);
    if (idx === -1) return;
    const target = idx * ITEM_H;
    if (Math.abs(el.scrollTop - target) > 1) {
      try {
        if (typeof el.scrollTo === 'function') el.scrollTo({ top: target });
        else el.scrollTop = target;
      } catch {
        el.scrollTop = target;
      }
    }
  }, [current, values]);

  function handleScroll() {
    const el = ref.current;
    if (!el) return;
    const idx = Math.max(0, Math.min(values.length - 1, Math.round(el.scrollTop / ITEM_H)));
    const v = values[idx];
    if (v !== current) {
      fromScrollRef.current = v;
      onChange(String(v));
    }
  }

  // Подсвечиваем точное значение, а если его нет в списке — ближайший пункт
  const exactIdx = values.indexOf(current);
  const activeIdx = exactIdx !== -1 ? exactIdx : nearestIndex(current);

  const labelOf = (v) => String(v).replace('.', ',');

  return (
    <div className="relative h-[120px] overflow-hidden rounded-xl bg-stone-50">
      <div className="pointer-events-none absolute inset-x-2 top-1/2 z-0 h-[40px] -translate-y-1/2 rounded-lg border border-emerald-200 bg-emerald-50/80" />
      <div
        ref={ref}
        onScroll={handleScroll}
        aria-label={ariaLabel}
        className="no-scrollbar relative z-[1] h-full snap-y snap-mandatory overflow-y-auto overscroll-contain"
        style={{ paddingTop: PAD, paddingBottom: PAD }}
      >
        {values.map((v, i) => (
          <button
            type="button"
            key={v}
            onClick={() => onChange(String(v))}
            className={`flex h-[40px] w-full snap-center items-center justify-center transition-colors ${
              i === activeIdx ? 'text-xl font-bold text-emerald-700' : 'text-base text-stone-400'
            }`}
          >
            {unit ? `${labelOf(v)} ${unit}` : labelOf(v)}
          </button>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[2] h-8 bg-gradient-to-b from-stone-50 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-8 bg-gradient-to-t from-stone-50 to-transparent" />
    </div>
  );
}
