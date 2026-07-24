import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  db,
  searchLocalProducts,
  findMyProductByBarcode,
  getAllMyProducts,
  getFavoriteProducts,
  getFrequentProducts,
  getOverridesMap,
  applyOverride,
  toggleMyProductFavorite,
  removeFavorite,
  getFavoriteFor,
  guessMeal,
} from '../db.js';
import { searchOpenFoodFacts, fetchProductByBarcode } from '../api.js';
import { searchBasicFoods, correctSearchQuery } from '../basicFoods.js';
import { useBackClose } from '../navigation.js';
import { fmt0 } from '../utils.js';
import Header from './Header.jsx';
import ProductDetail from './ProductDetail.jsx';
import ManualProductForm from './ManualProductForm.jsx';
import { IconBarcode, IconSearch, IconStar, Spinner } from './Icons.jsx';

// html5-qrcode тяжёлый — загружаем чанк только при открытии сканера
const BarcodeScanner = lazy(() => import('./BarcodeScanner.jsx'));

const TABS = [
  { key: 'frequent', label: 'Частые' },
  { key: 'favorites', label: 'Избранное' },
  { key: 'mine', label: 'Свои' },
];

export default function AddFoodScreen({ date, initialMealId, autoScan, autoFocusSearch, onClose }) {
  const meals = useLiveQuery(() => db.meals.orderBy('order').toArray(), []);

  const [view, setView] = useState('search'); // search | detail | manual
  const [mealId, setMealId] = useState(initialMealId ?? null);
  const [tab, setTab] = useState('frequent');
  const [query, setQuery] = useState('');
  const [retryTick, setRetryTick] = useState(0);
  const [localResults, setLocalResults] = useState([]);
  const [offResults, setOffResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState(false);
  // autoScan — переход с кнопки сканера в дневнике: камера открывается сразу
  const [scannerOpen, setScannerOpen] = useState(!!autoScan);
  const [barcodeState, setBarcodeState] = useState(null); // { status: 'loading' | 'error', barcode }
  const [selected, setSelected] = useState(null);
  const [manualPrefill, setManualPrefill] = useState(null);
  const [tabRefresh, setTabRefresh] = useState(0);

  useBackClose(onClose);

  // Выбранный приём: переданный с кнопки «+» приёма или угаданный по времени суток
  const currentMeal =
    meals?.find((m) => m.id === mealId) ?? (meals?.length ? guessMeal(meals) : null);

  const q = query.trim();

  // Локальные продукты (свои + избранное) — офлайн, поэтому ищем почти сразу,
  // не дожидаясь длинного debounce API-запроса
  useEffect(() => {
    if (q.length < 2) {
      setLocalResults([]);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const local = await searchLocalProducts(q).catch(() => []);
      if (!cancelled) setLocalResults(local);
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  useEffect(() => {
    setSearchError(false);
    if (q.length < 2) {
      setOffResults([]);
      setSearched(false);
      setSearching(false);
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const [off, overrides] = await Promise.all([searchOpenFoodFacts(q), getOverridesMap()]);
        if (!cancelled) setOffResults(off.map((p) => applyOverride(p, overrides)));
      } catch {
        if (!cancelled) {
          setOffResults([]);
          setSearchError(true);
        }
      }
      if (!cancelled) {
        setSearching(false);
        setSearched(true);
      }
      // 600 мс — щадим лимит Open Food Facts (~10 поисковых запросов в минуту)
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, retryTick]);

  // Справочник базовых продуктов (варёные крупы, мясо, овощи…) — локально и мгновенно
  const basicResults = useMemo(() => (q.length >= 2 ? searchBasicFoods(q) : []), [q]);
  // Подсказка «возможно, вы искали»: опечатки и не та раскладка. Исправленный вариант
  // уже участвует в поиске сам — подсказка объясняет выдачу и позволяет заменить запрос.
  const searchHint = useMemo(() => (q.length >= 3 ? correctSearchQuery(q) : null), [q]);

  function openManual(prefill) {
    setManualPrefill(prefill ?? null);
    setBarcodeState(null);
    setView('manual');
  }

  async function openDetail(product) {
    // Подтягиваем флаг избранного и пресеты граммов (по своему id или штрихкоду)
    const fav = await getFavoriteFor(product).catch(() => null);
    setSelected(fav ? { ...product, ...fav } : product);
    setBarcodeState(null);
    setView('detail');
  }

  async function lookupBarcode(barcode) {
    setBarcodeState({ status: 'loading', barcode });
    try {
      const local = await findMyProductByBarcode(barcode);
      if (local) {
        openDetail(local);
        return;
      }
      const off = await fetchProductByBarcode(barcode);
      if (off) {
        const overrides = await getOverridesMap();
        openDetail(applyOverride({ ...off, name: off.name || `Продукт ${barcode}` }, overrides));
      } else {
        openManual({
          barcode,
          notice: `Продукт со штрихкодом ${barcode} не найден. Заполните данные вручную — он сохранится в «Свои продукты» и в следующий раз найдётся по этому штрихкоду.`,
        });
      }
    } catch {
      setBarcodeState({ status: 'error', barcode });
    }
  }

  function handleScan(barcode) {
    setScannerOpen(false);
    lookupBarcode(barcode);
  }

  if (view === 'detail' && selected) {
    return (
      <ProductDetail
        product={selected}
        date={date}
        meal={currentMeal}
        meals={meals ?? []}
        onMealChange={(id) => setMealId(id)}
        onBack={() => {
          setTabRefresh((t) => t + 1);
          setView('search');
        }}
        onAdded={onClose}
      />
    );
  }

  if (view === 'manual') {
    return (
      <ManualProductForm
        prefill={manualPrefill}
        onBack={() => setView('search')}
        onSaved={(p) => openDetail(p)}
      />
    );
  }

  // Дубликаты OFF-результатов, уже сохранённые локально (по штрихкоду), скрываем
  const localBarcodes = new Set(localResults.map((p) => p.barcode).filter(Boolean));
  const off = offResults.filter((p) => !p.barcode || !localBarcodes.has(p.barcode));
  const nothingFound =
    searched &&
    !searching &&
    !searchError &&
    localResults.length === 0 &&
    basicResults.length === 0 &&
    off.length === 0;
  const hasAnyResults = localResults.length > 0 || basicResults.length > 0 || off.length > 0;

  return (
    <div className="mx-auto w-full max-w-md pb-8">
      <Header title="Добавить еду" onBack={onClose} />

      <div className="px-3">
        {meals && meals.length > 0 && (
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5">
            {meals.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMealId(m.id)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  currentMeal?.id === m.id
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white text-stone-600 shadow-sm active:bg-stone-50'
                }`}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-1.5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.currentTarget.querySelector('input')?.blur();
            }}
            className="relative min-w-0 flex-1"
          >
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-stone-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              type="search"
              enterKeyHint="search"
              autoFocus={autoFocusSearch}
              placeholder="Поиск по всем продуктам"
              className="w-full rounded-xl border border-stone-200 bg-white py-3 pl-10 pr-3 text-[0.9375rem] shadow-sm outline-none placeholder:text-stone-400 focus:border-emerald-500"
            />
          </form>
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            aria-label="Сканировать штрихкод"
            className="shrink-0 rounded-xl border border-stone-200 bg-white px-4 text-emerald-600 shadow-sm active:bg-stone-50"
          >
            <IconBarcode className="h-6 w-6" />
          </button>
        </div>

        {searchHint && (
          <button
            type="button"
            onClick={() => setQuery(searchHint)}
            className="mt-1.5 px-1 text-left text-xs text-stone-500 active:text-stone-700"
          >
            Возможно, вы искали:{' '}
            <span className="font-semibold text-emerald-700">{searchHint}</span>
          </button>
        )}

        {barcodeState?.status === 'loading' && (
          <div className="mt-2 flex items-center gap-2.5 rounded-xl bg-white p-3 shadow-sm">
            <Spinner className="h-5 w-5 shrink-0 text-emerald-600" />
            <p className="text-sm text-stone-600">Ищем продукт по штрихкоду {barcodeState.barcode}…</p>
          </div>
        )}

        {barcodeState?.status === 'error' && (
          <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-800">
              Не удалось проверить штрихкод {barcodeState.barcode}: нет связи с базой продуктов.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => lookupBarcode(barcodeState.barcode)}
                className="flex-1 rounded-full bg-white py-2.5 text-sm font-semibold text-stone-700 shadow-sm active:bg-stone-100"
              >
                Повторить
              </button>
              <button
                type="button"
                onClick={() => openManual({ barcode: barcodeState.barcode })}
                className="flex-1 rounded-full bg-emerald-600 py-2.5 text-sm font-semibold text-white active:bg-emerald-700"
              >
                Ввести вручную
              </button>
            </div>
          </div>
        )}

        {q.length < 2 ? (
          <TabsView
            tab={tab}
            onTab={setTab}
            mealLabel={currentMeal?.name ?? null}
            refreshKey={tabRefresh}
            onSelect={openDetail}
            onNewProduct={() => openManual(null)}
          />
        ) : (
          <>
            {localResults.length > 0 && (
              <Section title="Свои и избранное">
                {localResults.map((p) => (
                  <ProductRow key={`local-${p.favId ?? `m${p.id}`}`} product={p} onSelect={openDetail} />
                ))}
              </Section>
            )}

            {basicResults.length > 0 && (
              <Section title="Справочник">
                {basicResults.map((p) => (
                  <ProductRow key={`basic-${p.name}`} product={p} onSelect={openDetail} />
                ))}
              </Section>
            )}

            {(searching || searchError || off.length > 0) && (
              <Section title="Open Food Facts">
                {searching && (
                  <div className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
                    <Spinner className="h-5 w-5 shrink-0 text-emerald-600" />
                    <p className="text-sm text-stone-600">Ищем «{q}»…</p>
                  </div>
                )}
                {!searching && searchError && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm text-amber-900">
                      Не удалось загрузить результаты из Open Food Facts. Проверьте интернет-соединение.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setRetryTick((t) => t + 1)}
                        className="flex-1 rounded-full bg-white py-2.5 text-sm font-semibold text-stone-700 shadow-sm active:bg-stone-100"
                      >
                        Повторить
                      </button>
                      <button
                        type="button"
                        onClick={() => openManual({ name: q })}
                        className="flex-1 rounded-full bg-emerald-600 py-2.5 text-sm font-semibold text-white active:bg-emerald-700"
                      >
                        Ввести вручную
                      </button>
                    </div>
                  </div>
                )}
                {!searching &&
                  !searchError &&
                  off.map((p) => (
                    <ProductRow key={`off-${p.barcode ?? p.name}`} product={p} onSelect={openDetail} />
                  ))}
              </Section>
            )}

            {nothingFound && (
              <div className="mt-5 rounded-2xl bg-white p-5 text-center shadow-sm">
                <p className="font-medium">Ничего не найдено</p>
                <p className="mt-1 text-sm text-stone-500">
                  Добавьте продукт вручную — он сохранится в «Своих продуктах»
                </p>
                <button
                  type="button"
                  onClick={() => openManual({ name: q })}
                  className="mt-4 w-full rounded-full bg-emerald-600 py-3 font-semibold text-white active:bg-emerald-700"
                >
                  Ввести вручную
                </button>
              </div>
            )}

            {hasAnyResults && !searching && (
              <button
                type="button"
                onClick={() => openManual({ name: q })}
                className="mt-2.5 w-full text-center text-xs font-semibold text-emerald-700 active:text-emerald-800"
              >
                Нет нужного продукта? Ввести вручную
              </button>
            )}
          </>
        )}
      </div>

      {scannerOpen && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
              <Spinner className="h-8 w-8 text-white/80" />
            </div>
          }
        >
          <BarcodeScanner onScan={handleScan} onClose={() => setScannerOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}

function TabsView({ tab, onTab, mealLabel, refreshKey, onSelect, onNewProduct }) {
  const [items, setItems] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    (async () => {
      let list = [];
      if (tab === 'frequent') {
        list = (await getFrequentProducts(mealLabel)).map((f) => ({
          product: f.product,
          topMeal: f.topMeal,
          total: f.total,
        }));
      } else if (tab === 'favorites') {
        list = (await getFavoriteProducts()).map((p) => ({ product: p }));
      } else {
        list = (await getAllMyProducts()).map((p) => ({ product: p }));
      }
      if (!cancelled) setItems(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, mealLabel, refreshKey, reload]);

  async function handleToggleFavorite(product) {
    if (product.source === 'mine' && product.id != null) {
      await toggleMyProductFavorite(product.id);
    } else if (product.favorite) {
      await removeFavorite(product);
    }
    setReload((r) => r + 1);
  }

  const emptyText = {
    frequent: 'Здесь появятся продукты, которые вы добавляете чаще всего',
    favorites: 'Избранного пока нет — отметьте продукт звёздочкой или сохраните из карточки продукта',
    mine: 'Своих продуктов пока нет',
  }[tab];

  return (
    <div className="mt-2.5">
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-stone-200/70 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onTab(t.key)}
            className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
              tab === t.key ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 active:text-stone-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-2 space-y-1.5">
        {items === null ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-6 w-6 text-emerald-600" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl bg-white p-3.5 text-center text-xs text-stone-500 shadow-sm">
            {emptyText}
          </div>
        ) : (
          items.map((item, i) => (
            <ProductRow
              key={`${tab}-${i}`}
              product={item.product}
              topMeal={item.topMeal}
              showStar={tab === 'mine' || tab === 'favorites'}
              onToggleFavorite={() => handleToggleFavorite(item.product)}
              onSelect={onSelect}
            />
          ))
        )}

        {tab === 'mine' && (
          <button
            type="button"
            onClick={onNewProduct}
            className="w-full rounded-xl border-2 border-dashed border-stone-300 py-3 text-sm font-medium text-stone-500 active:border-emerald-500 active:text-emerald-700"
          >
            + Новый продукт
          </button>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="mt-2.5">
      <h2 className="mb-1 px-1 text-xs font-medium text-stone-500">{title}</h2>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function ProductRow({ product, topMeal, showStar, onToggleFavorite, onSelect }) {
  const meta = [product.brand ?? product.description, topMeal ? `чаще: ${topMeal}` : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="flex items-center gap-0.5 rounded-xl bg-white pl-3 pr-1.5 shadow-sm">
      <button
        type="button"
        onClick={() => onSelect(product)}
        className="flex min-w-0 flex-1 items-center gap-2 py-2.5 text-left active:opacity-70"
      >
        {product.source === 'mine' && (
          <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[0.625rem] font-medium text-emerald-800">
            Мой
          </span>
        )}
        {product.patched && (
          <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[0.625rem] font-medium text-violet-800">
            изм.
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] leading-snug">
            {product.name}
            {meta && <span className="text-stone-400"> · {meta}</span>}
          </span>
          <span className="block text-xs leading-snug text-stone-500">
            Б <b>{fmt0(product.protein100)}</b> · Ж <b>{fmt0(product.fat100)}</b> · У{' '}
            <b>{fmt0(product.carbs100)}</b>
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-[0.9375rem] font-semibold leading-tight">{fmt0(product.kcal100)}</span>
          <span className="block text-[0.625rem] leading-tight text-stone-400">ккал/100г</span>
        </span>
      </button>
      {showStar && (
        <button
          type="button"
          onClick={onToggleFavorite}
          aria-label={product.favorite ? 'Убрать из избранного' : 'В избранное'}
          className={`shrink-0 rounded-full p-2 active:bg-stone-100 ${
            product.favorite ? 'text-amber-400' : 'text-stone-300'
          }`}
        >
          <IconStar className="h-5 w-5" filled={!!product.favorite} />
        </button>
      )}
    </div>
  );
}
