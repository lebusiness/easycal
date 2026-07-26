import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, deleteDiaryEntry, updateDiaryEntry, entryToProduct, getFavoriteFor } from '../db.js';
import { toISODate, formatDateLabel, formatDateFull, shiftDate, fmt0, fmt1, round3, formatTime, kcalFromMacros, notifyError } from '../utils.js';
import { toast } from '../toast.js';
import GoalsEditor from './GoalsEditor.jsx';
import MealsEditor from './MealsEditor.jsx';
import ProductDetail from './ProductDetail.jsx';
import CompositeProductForm from './CompositeProductForm.jsx';
import { IconChevronLeft, IconChevronRight, IconChevronDown, IconTrash, IconPlus, IconBarcode, IconSearch, IconSwap, IconPencil, IconClose, Spinner } from './Icons.jsx';

export default function DiaryScreen({ date, onDateChange, onAdd, onScan, onHistory, onCreateProduct, user, onLogout }) {
  const meals = useLiveQuery(() => db.meals.orderBy('order').toArray(), []);
  const entries = useLiveQuery(() => db.diary.where('date').equals(date).toArray(), [date]);
  const goalsRec = useLiveQuery(() => db.settings.get('goals'), []);
  const goals = goalsRec?.value ?? null;

  const [collapsed, setCollapsed] = useState(() => new Set());
  const [showGoals, setShowGoals] = useState(false);
  const [showMeals, setShowMeals] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  // Режим сборки блюда: записи дня отмечаются галочками и превращаются
  // в состав нового составного продукта
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [composing, setComposing] = useState(null); // ингредиенты для формы блюда

  // Перетаскивание записи между приёмами: долгое нажатие поднимает запись,
  // отпускание над другим приёмом переносит её туда
  const [drag, setDrag] = useState(null); // { entry, fromMealId, x, y, targetMealId }
  const dragRef = useRef(null); // то же, что drag, но для обработчиков без ре-рендера
  const mealRefs = useRef(new Map()); // meal.id → DOM-узел секции (для хит-теста)
  const pressRef = useRef(null); // ожидание long-press: { timer, startX, startY }
  const didDragRef = useRef(false); // подавить click, который придёт после драга
  // Режим карточки итогов: сколько съедено или сколько осталось до цели
  const [totalsMode, setTotalsMode] = useState(() => {
    try {
      return localStorage.getItem('totalsMode') || 'eaten';
    } catch {
      return 'eaten';
    }
  });

  function toggleTotalsMode() {
    const next = totalsMode === 'eaten' ? 'left' : 'eaten';
    setTotalsMode(next);
    try {
      localStorage.setItem('totalsMode', next);
    } catch {
      /* приватный режим */
    }
  }

  // Прогресс приёмов можно спрятать: тап по полоске скрывает, тап по цифрам в шапке возвращает
  const [showMealBars, setShowMealBars] = useState(() => {
    try {
      return localStorage.getItem('mealBars') !== 'off';
    } catch {
      return true;
    }
  });

  function toggleMealBars() {
    const next = !showMealBars;
    setShowMealBars(next);
    try {
      localStorage.setItem('mealBars', next ? 'on' : 'off');
    } catch {
      /* приватный режим */
    }
  }

  const isToday = date === toISODate(new Date());
  const list = entries ?? [];
  const totals = list.reduce(
    (a, e) => ({
      kcal: a.kcal + (e.kcal || 0),
      protein: a.protein + (e.protein || 0),
      fat: a.fat + (e.fat || 0),
      carbs: a.carbs + (e.carbs || 0),
    }),
    { kcal: 0, protein: 0, fat: 0, carbs: 0 }
  );

  const byMeal = new Map();
  if (meals?.length) {
    for (const e of list) {
      const mealId = meals.some((m) => m.id === e.mealId) ? e.mealId : meals[0].id;
      if (!byMeal.has(mealId)) byMeal.set(mealId, []);
      byMeal.get(mealId).push(e);
    }
  }

  const anyMealGoals = (meals ?? []).some((m) => m.goals);
  const mealBarsLabel = showMealBars ? 'Скрыть прогресс приёмов' : 'Показать прогресс приёмов';

  function toggleCollapsed(id) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelected(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  // Запись дневника → ингредиент-снапшот; у старых записей КБЖУ на 100 г
  // восстанавливаем из порции
  function entryToIngredient(e) {
    const per =
      e.kcal100 != null
        ? { kcal: e.kcal100, protein: e.protein100 ?? 0, fat: e.fat100 ?? 0, carbs: e.carbs100 ?? 0 }
        : e.grams > 0
          ? {
              kcal: ((e.kcal || 0) / e.grams) * 100,
              protein: ((e.protein || 0) / e.grams) * 100,
              fat: ((e.fat || 0) / e.grams) * 100,
              carbs: ((e.carbs || 0) / e.grams) * 100,
            }
          : { kcal: 0, protein: 0, fat: 0, carbs: 0 };
    return {
      name: e.name,
      g: round3(e.grams),
      kcal100: round3(per.kcal),
      protein100: round3(per.protein),
      fat100: round3(per.fat),
      carbs100: round3(per.carbs),
    };
  }

  function startCompose() {
    // Отмеченные записи собираем в порядке отображения на экране
    const picked = [];
    for (const meal of meals ?? []) {
      for (const e of byMeal.get(meal.id) ?? []) {
        if (selectedIds.has(e.id)) picked.push(entryToIngredient(e));
      }
    }
    if (picked.length === 0) return;
    setComposing(picked);
  }

  // ---- Перетаскивание записей между приёмами ----

  function mealAtPoint(y) {
    for (const [id, el] of mealRefs.current) {
      const r = el.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) return id;
    }
    return null;
  }

  function handleEntryPointerDown(ev, entry, fromMealId) {
    if (selectMode) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    const target = ev.currentTarget;
    const { pointerId, clientX, clientY } = ev;
    didDragRef.current = false;
    pressRef.current = {
      startX: clientX,
      startY: clientY,
      timer: setTimeout(() => {
        pressRef.current = null;
        try {
          // захват указателя — события идут в строку, даже когда палец над другим приёмом
          target.setPointerCapture(pointerId);
        } catch {
          /* указатель уже отпущен */
        }
        navigator.vibrate?.(15);
        didDragRef.current = true;
        const d = { entry, fromMealId, x: clientX, y: clientY, targetMealId: fromMealId };
        dragRef.current = d;
        setDrag(d);
      }, 350),
    };
  }

  function handleEntryPointerMove(ev) {
    const d = dragRef.current;
    if (d) {
      d.x = ev.clientX;
      d.y = ev.clientY;
      d.targetMealId = mealAtPoint(ev.clientY) ?? d.targetMealId;
      setDrag({ ...d });
      return;
    }
    // палец поехал до срабатывания long-press — это прокрутка, не драг
    const p = pressRef.current;
    if (p && (Math.abs(ev.clientX - p.startX) > 8 || Math.abs(ev.clientY - p.startY) > 8)) {
      clearTimeout(p.timer);
      pressRef.current = null;
    }
  }

  function cancelPress() {
    if (pressRef.current) {
      clearTimeout(pressRef.current.timer);
      pressRef.current = null;
    }
  }

  function handleEntryPointerUp() {
    cancelPress();
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    setDrag(null);
    if (d.targetMealId != null && d.targetMealId !== d.fromMealId) {
      const meal = (meals ?? []).find((m) => m.id === d.targetMealId);
      if (meal) {
        updateDiaryEntry(d.entry.id, { mealId: meal.id, mealLabel: meal.name }).catch(notifyError);
      }
    }
  }

  function handleEntryPointerCancel() {
    cancelPress();
    if (dragRef.current) {
      dragRef.current = null;
      setDrag(null);
    }
  }

  // Пока запись «в руке»: не даём странице скроллиться под пальцем и глушим
  // контекстное меню долгого нажатия; у краёв экрана — авто-прокрутка
  useEffect(() => {
    if (!drag) return undefined;
    const prevent = (ev) => ev.preventDefault();
    document.addEventListener('touchmove', prevent, { passive: false });
    document.addEventListener('contextmenu', prevent);
    let raf;
    const step = () => {
      const d = dragRef.current;
      if (d) {
        const edge = 110;
        if (d.y < edge) window.scrollBy(0, -Math.ceil((edge - d.y) / 6));
        else if (d.y > window.innerHeight - edge) {
          window.scrollBy(0, Math.ceil((d.y - (window.innerHeight - edge)) / 6));
        }
        // после прокрутки под неподвижным пальцем оказывается другой приём
        const id = mealAtPoint(d.y);
        if (id != null && id !== d.targetMealId) {
          d.targetMealId = id;
          setDrag({ ...d });
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      document.removeEventListener('touchmove', prevent);
      document.removeEventListener('contextmenu', prevent);
      cancelAnimationFrame(raf);
    };
  }, [drag != null]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto w-full max-w-md pb-28">
      {/* Без backdrop-blur: в iOS Safari sticky + backdrop-filter иногда не отрисовывается */}
      <header className="sticky top-0 z-10 bg-stone-100 px-3 pb-1.5 pt-2">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => onDateChange(shiftDate(date, -1))}
            aria-label="Предыдущий день"
            className="rounded-full bg-white p-2 text-stone-600 shadow-sm active:bg-stone-200"
          >
            <IconChevronLeft className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => onDateChange(toISODate(new Date()))} className="min-w-0 truncate px-2 py-1">
            <span className={`text-[0.9375rem] font-semibold ${isToday ? 'text-emerald-600' : ''}`}>
              {formatDateLabel(date)}
            </span>
            <span className="ml-1.5 text-[0.6875rem] text-stone-400">{formatDateFull(date)}</span>
          </button>
          <button
            type="button"
            onClick={() => onDateChange(shiftDate(date, 1))}
            aria-label="Следующий день"
            className="rounded-full bg-white p-2 text-stone-600 shadow-sm active:bg-stone-200"
          >
            <IconChevronRight className="h-5 w-5" />
          </button>
        </div>
      </header>

      <section className="mx-3 rounded-2xl bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between">
          {goals ? (
            <button
              type="button"
              onClick={toggleTotalsMode}
              className="flex items-center gap-1 whitespace-nowrap text-xs font-medium text-stone-500 active:text-stone-700"
            >
              {totalsMode === 'eaten' ? 'Итого' : 'Осталось'}
              <IconSwap className="h-3.5 w-3.5 text-stone-400" />
            </button>
          ) : (
            <span className="whitespace-nowrap text-xs font-medium text-stone-500">Итого</span>
          )}
          <span className="flex shrink-0 gap-3">
            <button type="button" onClick={onHistory} className="whitespace-nowrap py-0.5 text-xs font-semibold text-emerald-700 active:text-emerald-800">
              История
            </button>
            <button
              type="button"
              onClick={() => setShowGoals(true)}
              className="whitespace-nowrap py-0.5 text-xs font-semibold text-emerald-700 active:text-emerald-800"
            >
              Цели
            </button>
            <button
              type="button"
              onClick={() => setShowMeals(true)}
              className="whitespace-nowrap py-0.5 text-xs font-semibold text-emerald-700 active:text-emerald-800"
            >
              Приёмы
            </button>
          </span>
        </div>

        {goals ? (
          (() => {
            const goalKcal = kcalFromMacros(goals.protein, goals.fat, goals.carbs);
            const kcalLeft = goalKcal - totals.kcal;
            // Тап по дневному прогрессу прячет/возвращает прогресс-полоски приёмов
            return (
              <button
                type="button"
                onClick={toggleMealBars}
                disabled={!anyMealGoals}
                aria-label={mealBarsLabel}
                className="mt-1.5 block w-full space-y-2 text-left active:opacity-70"
              >
                <div>
                  <div className="flex items-baseline justify-between text-[0.9375rem] leading-tight">
                    {totalsMode === 'eaten' ? (
                      <span className="font-semibold">
                        {fmt1(totals.kcal)}
                        <span className="font-normal text-stone-400"> / {fmt1(goalKcal)} ккал</span>
                      </span>
                    ) : (
                      <span className="font-semibold">
                        {fmt1(Math.max(0, kcalLeft))}
                        <span className="font-normal text-stone-400"> ккал осталось</span>
                        {kcalLeft < 0 && (
                          <span className="font-semibold text-red-600"> · перебор {fmt1(-kcalLeft)}</span>
                        )}
                      </span>
                    )}
                  </div>
                  <Bar value={totals.kcal} goal={goalKcal} color="bg-emerald-500" h="h-1.5" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <MiniProgress label="Б" value={totals.protein} goal={goals.protein} color="bg-sky-500" mode={totalsMode} />
                  <MiniProgress label="Ж" value={totals.fat} goal={goals.fat} color="bg-amber-500" mode={totalsMode} />
                  <MiniProgress label="У" value={totals.carbs} goal={goals.carbs} color="bg-rose-500" mode={totalsMode} />
                </div>
              </button>
            );
          })()
        ) : (
          <button
            type="button"
            onClick={toggleMealBars}
            disabled={!anyMealGoals}
            aria-label={mealBarsLabel}
            className="mt-0.5 flex w-full flex-wrap items-baseline justify-between gap-x-3 text-left active:opacity-70"
          >
            <span className="text-xl font-bold tracking-tight">
              {fmt1(totals.kcal)} <span className="text-xs font-normal text-stone-500">ккал</span>
            </span>
            <span className="text-xs text-stone-600">
              Б <b>{fmt1(totals.protein)}</b> · Ж <b>{fmt1(totals.fat)}</b> · У <b>{fmt1(totals.carbs)}</b>
            </span>
          </button>
        )}
      </section>

      <div className="mx-3 mt-2 space-y-2">
        {(meals ?? []).map((meal) => {
          const mealEntries = byMeal.get(meal.id) ?? [];
          const mealTotals = mealEntries.reduce(
            (a, e) => ({
              kcal: a.kcal + (e.kcal || 0),
              protein: a.protein + (e.protein || 0),
              fat: a.fat + (e.fat || 0),
              carbs: a.carbs + (e.carbs || 0),
            }),
            { kcal: 0, protein: 0, fat: 0, carbs: 0 }
          );
          const isCollapsed = collapsed.has(meal.id);
          const goalKcal = meal.goals
            ? kcalFromMacros(meal.goals.protein, meal.goals.fat, meal.goals.carbs)
            : null;
          const isDropTarget =
            drag != null && drag.targetMealId === meal.id && drag.fromMealId !== meal.id;
          return (
            <section
              key={meal.id}
              ref={(el) => {
                if (el) mealRefs.current.set(meal.id, el);
                else mealRefs.current.delete(meal.id);
              }}
              className={`rounded-2xl bg-white shadow-sm ${isDropTarget ? 'ring-2 ring-emerald-500' : ''}`}
            >
              <div className="flex items-center gap-1 py-1 pl-2.5 pr-1.5">
                <button
                  type="button"
                  onClick={() => toggleCollapsed(meal.id)}
                  aria-label={isCollapsed ? `Развернуть «${meal.name}»` : `Свернуть «${meal.name}»`}
                  className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left"
                >
                  <IconChevronDown
                    className={`h-4 w-4 shrink-0 text-stone-400 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                  />
                  <span className="truncate text-[0.9375rem] font-semibold">{meal.name}</span>
                  {meal.goals && !showMealBars ? (
                    <span className="ml-auto shrink-0 whitespace-nowrap pl-2 pr-1 text-xs text-stone-500">
                      {fmt0(mealTotals.kcal)}/{fmt0(goalKcal)} ккал
                    </span>
                  ) : !meal.goals && mealEntries.length > 0 ? (
                    <span className="ml-auto shrink-0 pl-2 pr-1 text-xs text-stone-500">
                      {fmt1(mealTotals.kcal)} ккал
                    </span>
                  ) : null}
                </button>
                <div className="-my-0.5 flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => onAdd(meal.id, true)}
                    aria-label={`Найти и добавить в «${meal.name}»`}
                    className="rounded-full bg-emerald-50 p-2.5 text-emerald-700 active:bg-emerald-100"
                  >
                    <IconSearch className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onAdd(meal.id)}
                    aria-label={`Добавить в «${meal.name}»`}
                    className="rounded-full bg-emerald-50 p-2.5 text-emerald-700 active:bg-emerald-100"
                  >
                    <IconPlus className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {meal.goals && showMealBars && (
                <MealGoalStrip totals={mealTotals} goals={meal.goals} onHide={toggleMealBars} />
              )}

              {!isCollapsed && mealEntries.length > 0 && (
                <ul className="divide-y divide-stone-100 border-t border-stone-100">
                  {mealEntries.map((e) => {
                    const checked = selectedIds.has(e.id);
                    return (
                      <li key={e.id} className="flex items-center gap-1 pl-3 pr-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            // клик, прилетевший после драга, — не открытие карточки
                            if (didDragRef.current) {
                              didDragRef.current = false;
                              return;
                            }
                            if (selectMode) toggleSelected(e.id);
                            else setEditingEntry(e);
                          }}
                          onPointerDown={(ev) => handleEntryPointerDown(ev, e, meal.id)}
                          onPointerMove={handleEntryPointerMove}
                          onPointerUp={handleEntryPointerUp}
                          onPointerCancel={handleEntryPointerCancel}
                          onContextMenu={(ev) => {
                            if (dragRef.current) ev.preventDefault();
                          }}
                          style={{ WebkitTouchCallout: 'none' }}
                          className={`flex min-w-0 flex-1 select-none items-center gap-2 py-2 text-left active:opacity-70 ${
                            drag?.entry.id === e.id ? 'opacity-40' : ''
                          }`}
                        >
                          {selectMode && (
                            <span
                              aria-hidden="true"
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                                checked
                                  ? 'border-emerald-600 bg-emerald-600 text-white'
                                  : 'border-stone-300 text-transparent'
                              }`}
                            >
                              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="m5 12 5 5L20 7" />
                              </svg>
                            </span>
                          )}
                          <span className="min-w-0 flex-1 truncate text-sm leading-snug">{e.name}</span>
                          {formatTime(e.addedAt) && (
                            <span className="shrink-0 text-[0.6875rem] text-stone-400">{formatTime(e.addedAt)}</span>
                          )}
                          <span className="shrink-0 text-xs text-stone-500">{fmt1(e.grams)} г</span>
                          <span className="shrink-0 text-[0.9375rem] font-semibold">{fmt1(e.kcal)}</span>
                        </button>
                        {!selectMode && (
                          <button
                            type="button"
                            onClick={() => deleteDiaryEntry(e.id).catch(notifyError)}
                            aria-label={`Удалить «${e.name}»`}
                            className="shrink-0 rounded-full p-2 text-stone-300 active:bg-red-50 active:text-red-600"
                          >
                            <IconTrash className="h-[1.125rem] w-[1.125rem]" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {entries !== undefined && list.length === 0 && (
        <p className="mx-3 mt-2 text-center text-[0.6875rem] text-stone-400">
          Записей пока нет — добавьте еду кнопкой «+» у приёма пищи
        </p>
      )}

      {list.length > 0 &&
        (selectMode ? (
          <p className="mx-3 mt-2.5 text-center text-[0.6875rem] text-stone-400">
            Отметьте записи галочками — из них соберётся составное блюдо
          </p>
        ) : (
          <button
            type="button"
            onClick={() => {
              setSelectedIds(new Set());
              setSelectMode(true);
            }}
            className="mx-auto mt-2.5 block px-3 py-1 text-[0.6875rem] font-semibold text-stone-400 active:text-emerald-700"
          >
            Собрать блюдо из добавленного
          </button>
        ))}

      {user && (
        <p className="mx-3 mt-4 text-center text-[0.6875rem] text-stone-400">
          {user.email} ·{' '}
          <button
            type="button"
            onClick={onLogout}
            className="py-1 font-semibold text-stone-500 active:text-red-600"
          >
            Выйти
          </button>
        </p>
      )}

      {selectMode ? (
        <div className="fixed inset-x-0 bottom-0 z-10 mx-auto flex w-full max-w-md gap-2 bg-gradient-to-t from-stone-100 via-stone-100/90 to-transparent px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
          <button
            type="button"
            onClick={startCompose}
            disabled={selectedIds.size === 0}
            className="min-w-0 flex-1 rounded-full bg-emerald-600 py-3.5 text-base font-semibold text-white shadow-lg shadow-emerald-600/25 active:bg-emerald-700 disabled:opacity-50"
          >
            Создать блюдо{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
          </button>
          <button
            type="button"
            onClick={exitSelectMode}
            aria-label="Отменить сборку блюда"
            className="shrink-0 rounded-full bg-white px-4 text-stone-500 shadow-lg shadow-stone-900/10 active:bg-stone-100"
          >
            <IconClose className="h-5 w-5" />
          </button>
        </div>
      ) : (
      <div className="fixed inset-x-0 bottom-0 z-10 mx-auto flex w-full max-w-md gap-2 bg-gradient-to-t from-stone-100 via-stone-100/90 to-transparent px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
        <div className="flex min-w-0 flex-1 overflow-hidden rounded-full bg-emerald-600 shadow-lg shadow-emerald-600/25">
          <button
            type="button"
            onClick={() => onAdd(null)}
            className="min-w-0 flex-1 py-3.5 text-base font-semibold text-white active:bg-emerald-700"
          >
            + Добавить
          </button>
          <button
            type="button"
            onClick={() => onAdd(null, true)}
            aria-label="Добавить через поиск"
            className="border-l border-emerald-500/60 px-5 text-white active:bg-emerald-700"
          >
            <IconSearch className="h-6 w-6" />
          </button>
        </div>
        <button
          type="button"
          onClick={onCreateProduct}
          aria-label="Создать свой продукт"
          className="shrink-0 rounded-full bg-white px-4 text-emerald-600 shadow-lg shadow-stone-900/10 active:bg-stone-100"
        >
          <IconPencil className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={onScan}
          aria-label="Сканировать штрихкод"
          className="shrink-0 rounded-full bg-white px-4 text-emerald-600 shadow-lg shadow-stone-900/10 active:bg-stone-100"
        >
          <IconBarcode className="h-6 w-6" />
        </button>
      </div>
      )}

      {drag && (
        <div
          className="pointer-events-none fixed z-50 flex max-w-[75vw] -translate-x-1/2 items-center gap-2 rounded-xl bg-white px-3.5 py-2.5 shadow-xl ring-1 ring-stone-200"
          style={{ left: drag.x, top: drag.y - 56 }}
        >
          <span className="min-w-0 truncate text-sm">{drag.entry.name}</span>
          <span className="shrink-0 text-xs text-stone-500">{fmt1(drag.entry.grams)} г</span>
          {drag.targetMealId !== drag.fromMealId && (
            <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-emerald-700">
              → {(meals ?? []).find((m) => m.id === drag.targetMealId)?.name}
            </span>
          )}
        </div>
      )}

      {showGoals && <GoalsEditor goals={goals} onClose={() => setShowGoals(false)} />}
      {showMeals && <MealsEditor onClose={() => setShowMeals(false)} />}
      {editingEntry && (
        <EntryDetail entry={editingEntry} meals={meals ?? []} onClose={() => setEditingEntry(null)} />
      )}
      {composing && (
        <div className="fixed inset-0 z-40 overflow-y-auto overscroll-contain bg-stone-100">
          <CompositeProductForm
            initialIngredients={composing}
            onBack={() => setComposing(null)}
            onSaved={(p) => {
              setComposing(null);
              exitSelectMode();
              toast(`«${p.name}» сохранено в «Свои продукты»`);
            }}
          />
        </div>
      )}
    </div>
  );
}

// Карточка записи дневника — тот же UI, что при добавлении продукта (избранное,
// пресеты, правка БЖУ), но с сохранением в существующую запись
function EntryDetail({ entry, meals, onClose }) {
  const [product, setProduct] = useState(null);
  const [mealId, setMealId] = useState(entry.mealId);

  // Продукт строится из снапшота записи + флаг избранного и пресеты граммов
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const base = entryToProduct(entry);
      const fav = await getFavoriteFor(base).catch(() => null);
      if (!cancelled) setProduct(fav ? { ...base, ...fav } : base);
    })();
    return () => {
      cancelled = true;
    };
  }, [entry]);

  const meal = meals.find((m) => m.id === mealId) ?? meals[0] ?? null;

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto overscroll-contain bg-stone-100">
      {product ? (
        <ProductDetail
          product={product}
          entry={entry}
          date={entry.date}
          meal={meal}
          meals={meals}
          onMealChange={setMealId}
          onBack={onClose}
          onAdded={onClose}
          onDeleted={onClose}
        />
      ) : (
        <div className="flex min-h-dvh items-center justify-center">
          <Spinner className="h-8 w-8 text-emerald-600" />
        </div>
      )}
    </div>
  );
}

function Bar({ value, goal, color, overColor = 'bg-red-500', h = 'h-1' }) {
  const pct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0;
  const over = goal > 0 && value > goal;
  return (
    <div className={`mt-0.5 ${h} overflow-hidden rounded-full bg-stone-100`}>
      <div
        className={`h-full rounded-full ${over ? overColor : color} transition-[width] duration-300`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// Компактная строка прогресса приёма: ккал + Б/Ж/У одной линией микро-баров.
// В цель приёма ровно не попасть, поэтому перебор не красим в красный — при
// переполнении бар лишь чуть темнеет. Тап по полоске прячет прогресс у всех
// приёмов; вернуть — тапом по дневному прогрессу в карточке «Итого».
function MealGoalStrip({ totals, goals, onHide }) {
  const goalKcal = kcalFromMacros(goals.protein, goals.fat, goals.carbs);
  return (
    <button
      type="button"
      onClick={onHide}
      aria-label="Скрыть прогресс приёмов"
      className="grid w-full grid-cols-4 gap-2 border-t border-stone-100 px-3 pb-2 pt-1.5 text-left active:opacity-70"
    >
      <Micro label="ккал" value={totals.kcal} goal={goalKcal} color="bg-emerald-500" overColor="bg-emerald-600" fmt={fmt0} />
      <Micro label="Б" value={totals.protein} goal={goals.protein} color="bg-sky-500" overColor="bg-sky-600" />
      <Micro label="Ж" value={totals.fat} goal={goals.fat} color="bg-amber-500" overColor="bg-amber-600" />
      <Micro label="У" value={totals.carbs} goal={goals.carbs} color="bg-rose-500" overColor="bg-rose-600" />
    </button>
  );
}

function Micro({ label, value, goal, color, overColor, fmt = fmt1 }) {
  const over = goal > 0 && value > goal;
  return (
    <div>
      <div className="flex items-baseline justify-between text-[0.625rem] leading-tight">
        <span className="text-stone-400">{label}</span>
        <span className={`font-medium ${over ? 'text-stone-800' : 'text-stone-600'}`}>
          {fmt(value)}
          <span className="font-normal text-stone-400">/{fmt(goal)}</span>
        </span>
      </div>
      <Bar value={value} goal={goal} color={color} overColor={overColor} />
    </div>
  );
}

function MiniProgress({ label, value, goal, color, mode = 'eaten' }) {
  const over = goal > 0 && value > goal;
  const left = goal - value;
  return (
    <div>
      <div className="flex items-baseline justify-between text-[0.6875rem] leading-tight">
        <span className="text-stone-500">{label}</span>
        {mode === 'eaten' ? (
          <span className={over ? 'font-semibold text-red-600' : 'font-semibold'}>
            {fmt1(value)}
            <span className="font-normal text-stone-400">/{fmt1(goal)}</span>
          </span>
        ) : (
          <span className={over ? 'font-semibold text-red-600' : 'font-semibold'}>
            {over ? `+${fmt1(-left)}` : fmt1(left)}
            <span className="font-normal text-stone-400"> {over ? 'сверх' : 'ост.'}</span>
          </span>
        )}
      </div>
      <Bar value={value} goal={goal} color={color} />
    </div>
  );
}
