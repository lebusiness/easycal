import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db.js';
import { api } from '../api-client.js';
import { toISODate, shiftDate, fmt0, kcalFromMacros, notifyError } from '../utils.js';
import Header from './Header.jsx';
import { useBackClose } from '../navigation.js';

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// CSV с итогами по дням за всю историю — открывается в Excel / Google Таблицах
async function exportCsv() {
  const entries = await db.diary.orderBy('date').toArray();
  const byDate = new Map();
  for (const e of entries) {
    let t = byDate.get(e.date);
    if (!t) {
      t = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
      byDate.set(e.date, t);
    }
    t.kcal += e.kcal || 0;
    t.protein += e.protein || 0;
    t.fat += e.fat || 0;
    t.carbs += e.carbs || 0;
  }
  const lines = ['Дата;Ккал;Белки;Жиры;Углеводы'];
  for (const [date, t] of [...byDate.entries()].sort()) {
    lines.push(`${date};${Math.round(t.kcal)};${Math.round(t.protein)};${Math.round(t.fat)};${Math.round(t.carbs)}`);
  }
  // BOM — чтобы Excel понял кириллицу
  downloadFile(`калории-по-дням-${toISODate(new Date())}.csv`, '﻿' + lines.join('\n'), 'text/csv;charset=utf-8');
}

// Полный бэкап: берём авторитетный снимок с сервера, офлайн — из локального зеркала
async function exportJson() {
  let snap;
  try {
    snap = await api.get('/snapshot');
  } catch {
    snap = {
      diary: await db.diary.toArray(),
      myProducts: await db.myProducts.toArray(),
      meals: await db.meals.orderBy('order').toArray(),
      favorites: await db.favorites.toArray(),
      overrides: await db.overrides.toArray(),
      settings: await db.settings.toArray(),
    };
  }
  const backup = { app: 'calorie-tracker', version: 2, exportedAt: new Date().toISOString(), ...snap };
  downloadFile(
    `калории-бэкап-${toISODate(new Date())}.json`,
    JSON.stringify(backup, null, 2),
    'application/json'
  );
}

// Цвета макросов — те же, что в приложении (палитра проверена валидатором на CVD)
const SERIES = [
  { key: 'protein', label: 'Белки', color: '#0ea5e9', perGram: 4 },
  { key: 'fat', label: 'Жиры', color: '#f59e0b', perGram: 9 },
  { key: 'carbs', label: 'Углеводы', color: '#f43f5e', perGram: 4 },
];

const RANGES = [7, 14, 30];

// Геометрия графика (viewBox; масштабируется на ширину экрана)
const W = 360;
const H = 200;
const M = { l: 34, r: 8, t: 10, b: 20 };

function niceStep(raw) {
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

const shortKcal = (v) => (v >= 1000 ? `${v / 1000}к` : String(v));

export default function HistoryScreen({ onBack }) {
  useBackClose(onBack);
  const [days, setDays] = useState(14);
  const today = toISODate(new Date());
  const start = shiftDate(today, -(days - 1));
  const [selected, setSelected] = useState(today);

  const goalsRec = useLiveQuery(() => db.settings.get('goals'), []);
  const goals = goalsRec?.value ?? null;
  const goalKcal = goals ? kcalFromMacros(goals.protein, goals.fat, goals.carbs) : null;

  const entries = useLiveQuery(
    () => db.diary.where('date').between(start, today, true, true).toArray(),
    [start, today]
  );

  const daysList = useMemo(() => {
    const byDate = new Map();
    for (const e of entries ?? []) {
      let t = byDate.get(e.date);
      if (!t) {
        t = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
        byDate.set(e.date, t);
      }
      t.kcal += e.kcal || 0;
      t.protein += e.protein || 0;
      t.fat += e.fat || 0;
      t.carbs += e.carbs || 0;
    }
    return Array.from({ length: days }, (_, i) => {
      const date = shiftDate(start, i);
      return { date, ...(byDate.get(date) ?? { kcal: 0, protein: 0, fat: 0, carbs: 0 }) };
    });
  }, [entries, start, days]);

  const hasData = daysList.some((d) => d.kcal > 0);
  const selectedDay = daysList.find((d) => d.date === selected) ?? daysList[daysList.length - 1];

  // Шкала: по максимуму дня либо цели, тики круглыми числами
  const maxVal = Math.max(
    400,
    goalKcal ?? 0,
    ...daysList.map((d) => SERIES.reduce((s, m) => s + d[m.key] * m.perGram, 0))
  );
  const step = niceStep(maxVal / 4);
  const top = step * 4;
  const innerW = W - M.l - M.r;
  const innerH = H - M.t - M.b;
  const y = (v) => M.t + innerH - (v / top) * innerH;
  const band = innerW / days;
  const barW = Math.min(24, Math.max(4, band - 2));
  const labelEvery = Math.ceil(days / 7);

  const fmtDay = (iso) => {
    const [, m, d] = iso.split('-').map(Number);
    return `${d}.${String(m).padStart(2, '0')}`;
  };

  return (
    <div className="mx-auto w-full max-w-md pb-8">
      <Header title="История" onBack={onBack} />

      <div className="px-3">
        <div className="flex gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setDays(r)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                days === r ? 'bg-emerald-600 text-white' : 'bg-white text-stone-600 shadow-sm active:bg-stone-50'
              }`}
            >
              {r} дней
            </button>
          ))}
        </div>

        <div className="mt-1.5 rounded-2xl bg-white p-2.5 shadow-sm">
          {!hasData && entries !== undefined ? (
            <p className="py-10 text-center text-sm text-stone-500">
              За этот период записей нет
            </p>
          ) : (
            <>
              <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Калории и БЖУ по дням">
                {/* сетка и тики */}
                {Array.from({ length: 5 }, (_, i) => i * step).map((v) => (
                  <g key={v}>
                    <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke="#e7e5e4" strokeWidth="1" />
                    <text x={M.l - 5} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#a8a29e">
                      {shortKcal(v)}
                    </text>
                  </g>
                ))}

                {/* столбцы: стек Б (низ) → Ж → У, ккал по 4/9/4 */}
                {daysList.map((d, i) => {
                  const cx = M.l + band * i + band / 2;
                  const x = cx - barW / 2;
                  const isSel = d.date === selectedDay?.date;
                  let cum = 0;
                  const segs = SERIES.map((m) => {
                    const val = d[m.key] * m.perGram;
                    const y1 = y(cum + val);
                    const y0 = y(cum);
                    cum += val;
                    return { color: m.color, y1, y0 };
                  }).filter((s) => s.y0 - s.y1 > 0.5);
                  return (
                    <g key={d.date} onClick={() => setSelected(d.date)} style={{ cursor: 'pointer' }}>
                      {isSel && (
                        <rect x={M.l + band * i} y={M.t} width={band} height={innerH} fill="#f5f5f4" rx="4" />
                      )}
                      {segs.map((s, j) => {
                        const isTop = j === segs.length - 1;
                        // 2px зазор поверх нижних сегментов; верхний — со скруглённым торцом
                        const yTop = Math.min(s.y0 - 0.5, s.y1 + (isTop ? 0 : 2));
                        const r = isTop ? Math.min(4, (s.y0 - yTop) / 2, barW / 2) : 0;
                        return (
                          <path
                            key={j}
                            d={`M${x},${s.y0} L${x},${yTop + r} Q${x},${yTop} ${x + r},${yTop} L${x + barW - r},${yTop} Q${x + barW},${yTop} ${x + barW},${yTop + r} L${x + barW},${s.y0} Z`}
                            fill={s.color}
                          />
                        );
                      })}
                      {/* прозрачная зона нажатия на весь день */}
                      <rect x={M.l + band * i} y={M.t} width={band} height={innerH} fill="transparent" />
                      {i % labelEvery === 0 && (
                        <text x={cx} y={H - 6} textAnchor="middle" fontSize="8.5" fill="#a8a29e">
                          {fmtDay(d.date)}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* линия цели */}
                {goalKcal != null && goalKcal <= top && (
                  <g>
                    <line x1={M.l} x2={W - M.r} y1={y(goalKcal)} y2={y(goalKcal)} stroke="#059669" strokeWidth="1.5" />
                    <text x={W - M.r} y={y(goalKcal) - 3} textAnchor="end" fontSize="9" fill="#059669" fontWeight="600">
                      цель {fmt0(goalKcal)}
                    </text>
                  </g>
                )}
              </svg>

              {/* легенда */}
              <div className="mt-1 flex justify-center gap-4">
                {SERIES.map((m) => (
                  <span key={m.key} className="flex items-center gap-1.5 text-xs text-stone-600">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: m.color }} />
                    {m.label}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        {/* выбранный день — точные значения */}
        {selectedDay && (
          <div className="mt-1.5 rounded-2xl bg-white p-2.5 shadow-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold">{fmtDay(selectedDay.date)}</span>
              <span className="text-sm">
                <b>{fmt0(selectedDay.kcal)}</b> <span className="text-xs text-stone-500">ккал</span>
              </span>
            </div>
            <div className="mt-1 flex gap-3 text-xs text-stone-600">
              {SERIES.map((m) => (
                <span key={m.key} className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: m.color }} />
                  {m.label} <b>{fmt0(selectedDay[m.key])}</b> г
                </span>
              ))}
            </div>

          </div>
        )}

        {/* экспорт: страховочная копия данных */}
        <div className="mt-1.5 flex gap-2">
          <button
            type="button"
            onClick={() => exportCsv().catch(notifyError)}
            className="flex-1 rounded-full border border-stone-200 bg-white py-2.5 text-xs font-semibold text-stone-600 shadow-sm active:bg-stone-100"
          >
            Скачать CSV по дням
          </button>
          <button
            type="button"
            onClick={() => exportJson().catch(notifyError)}
            className="flex-1 rounded-full border border-stone-200 bg-white py-2.5 text-xs font-semibold text-stone-600 shadow-sm active:bg-stone-100"
          >
            Полный бэкап (JSON)
          </button>
        </div>
        <p className="mt-1.5 px-1 text-center text-[0.6875rem] text-stone-400">
          CSV открывается в Excel и Google Таблицах — итоги ккал и БЖУ за каждый день. JSON — полная
          копия всех данных аккаунта.
        </p>
      </div>
    </div>
  );
}
