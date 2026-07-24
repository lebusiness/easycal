import { bestScore, buildQueryPlan, normText, switchLayout, textForms, translit } from './searchText.js';
import { correctSearchQuery } from './basicFoods.js';

const TIMEOUT_MS = 8000;

// На localhost (dev/preview) ходим через прокси Vite — у search-a-licious сломан CORS,
// а legacy-поиск блокирует прямые запросы. Для деплоя с такими же rewrite'ами
// (netlify.toml / vercel.json) сборка делается с VITE_OFF_PROXY=1.
// «?.» — чтобы модуль импортировался и вне Vite (юнит-тесты в Node).
const useLocalProxy =
  import.meta.env?.VITE_OFF_PROXY === '1' ||
  (typeof location !== 'undefined' && ['localhost', '127.0.0.1'].includes(location.hostname));

const SEARCH_HOST = useLocalProxy ? '/off-search' : 'https://search.openfoodfacts.org';
const RU_HOST = useLocalProxy ? '/off-ru' : 'https://ru.openfoodfacts.org';
const WORLD_HOST = useLocalProxy ? '/off-world' : 'https://world.openfoodfacts.org';

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Не бросает на HTTP-ошибках (нужно читать тело 404 у баркод-API), бросает на сети/таймауте.
async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new ApiError(e?.name === 'AbortError' ? 'Таймаут запроса' : 'Ошибка сети');
  } finally {
    clearTimeout(timer);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, ok: res.ok, body };
}

// Мультиязычные поля OFF встречаются как строка, объект {ru: ...} или массив [{lang, text}]
function textFrom(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t || null;
  }
  if (Array.isArray(v)) {
    const byLang = (lang) => v.find((i) => i && i.lang === lang);
    const item = byLang('ru') || byLang('main') || byLang('en') || v.find((i) => i && i.text);
    return item ? textFrom(item.text) : null;
  }
  if (typeof v === 'object') {
    return textFrom(v.ru ?? v.main ?? v.en ?? Object.values(v)[0]);
  }
  return null;
}

function pickName(p) {
  return (
    textFrom(p.product_name_ru) ||
    textFrom(p.product_name) ||
    textFrom(p.generic_name_ru) ||
    textFrom(p.generic_name) ||
    textFrom(p.abbreviated_product_name) ||
    null
  );
}

function normalizeBrand(v) {
  if (!v) return null;
  if (Array.isArray(v)) return v.filter(Boolean).join(', ') || null;
  if (typeof v === 'string') return v.trim() || null;
  return null;
}

function toNumber(v) {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function normalizeOffProduct(p) {
  const nutr = p.nutriments || {};
  return {
    source: 'off',
    name: pickName(p),
    brand: normalizeBrand(p.brands),
    barcode: p.code != null ? String(p.code) : p._id != null ? String(p._id) : null,
    kcal100: toNumber(nutr['energy-kcal_100g']),
    protein100: toNumber(nutr.proteins_100g),
    fat100: toNumber(nutr.fat_100g),
    carbs100: toNumber(nutr.carbohydrates_100g),
  };
}

// Релевантность search-a-licious для русских запросов слабая: «Творог 2%» по запросу
// «творог простоквашино» приходит 49-м, выше — кефир и молоко того же бренда.
// Поэтому забираем 50 результатов и пересортировываем сами через общий движок
// searchText.js: точные/префиксные совпадения выше нечётких (опечатки, транслит,
// раскладка), бонусы за покрытие всех слов запроса и наличие ккал.
export function rankProducts(products, query) {
  const plan = buildQueryPlan(query);
  if (!plan) return products;
  return products
    .map((p, i) => {
      const forms = textForms(`${p.name ?? ''} ${p.brand ?? ''}`);
      let score = p.kcal100 != null ? 0.5 : 0;
      let full = true;
      for (let k = 0; k < plan.variants.length; k++) {
        const s = bestScore(plan.variants[k], forms);
        if (s === 0 && !plan.soft[k]) full = false;
        score += s;
      }
      if (full) score += 1.5; // нашлись все слова запроса — сильный сигнал
      if (!full && plan.joined) {
        const js = bestScore(plan.joined, forms); // «просто квашино» → «простоквашино»
        if (js >= 1.3) score += js;
      }
      return { p, i, score };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((s) => s.p);
}

const PAGE_SIZE = 50;
const MAX_RESULTS = 15;

// Каскад: search-a-licious → legacy-поиск. Бросает ApiError, если оба недоступны.
// Запрос расширяем транслитом, исправленной раскладкой и исправлением опечаток по
// словарю справочника: у поиска OFF OR-семантика, лишние слова не сужают выдачу
// (ранжируем всё равно сами), а «малоко»/«vjkjrj» сервер иначе не найдёт.
export async function searchOpenFoodFacts(query) {
  const original = query.trim();
  const qNorm = normText(original);
  const variants = new Set([original]);
  const lat = translit(qNorm);
  if (lat !== qNorm) variants.add(lat);
  const sw = switchLayout(qNorm);
  if (sw) {
    variants.add(sw);
    const swLat = translit(sw);
    if (swLat !== sw) variants.add(swLat);
  }
  const corrected = correctSearchQuery(original);
  if (corrected) {
    variants.add(corrected);
    const corrLat = translit(corrected);
    if (corrLat !== corrected) variants.add(corrLat);
  }
  const q = encodeURIComponent([...variants].join(' '));
  let products;
  try {
    const { ok, body } = await fetchJson(
      `${SEARCH_HOST}/search?q=${q}&page_size=${PAGE_SIZE}&langs=ru`
    );
    if (!ok || !Array.isArray(body?.hits)) throw new ApiError('Некорректный ответ search-a-licious');
    products = body.hits.map(normalizeOffProduct);
  } catch {
    const { ok, body } = await fetchJson(
      `${RU_HOST}/cgi/search.pl?search_terms=${q}&search_simple=1&action=process&json=1&page_size=${PAGE_SIZE}`
    );
    if (!ok || !Array.isArray(body?.products)) throw new ApiError('Поиск недоступен');
    products = body.products.map(normalizeOffProduct);
  }
  return rankProducts(products.filter((p) => p.name), original).slice(0, MAX_RESULTS);
}

// null → продукт не найден (status = 0). ApiError → проблема сети/сервиса.
export async function fetchProductByBarcode(barcode) {
  const { body } = await fetchJson(
    `${WORLD_HOST}/api/v2/product/${encodeURIComponent(barcode)}.json`
  );
  if (body && body.status === 1 && body.product) {
    const product = normalizeOffProduct(body.product);
    if (!product.barcode) product.barcode = barcode;
    return product;
  }
  if (body && body.status === 0) return null;
  throw new ApiError('Сервис проверки штрихкодов недоступен');
}
