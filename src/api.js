const TIMEOUT_MS = 8000;

// На localhost (dev/preview) ходим через прокси Vite — у search-a-licious сломан CORS,
// а legacy-поиск блокирует прямые запросы. Для деплоя с такими же rewrite'ами
// (netlify.toml / vercel.json) сборка делается с VITE_OFF_PROXY=1.
const useLocalProxy =
  import.meta.env.VITE_OFF_PROXY === '1' ||
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
// Поэтому забираем 50 результатов и пересортировываем сами: точное совпадение слова
// запроса с названием/брендом — 2 балла, вхождение подстрокой — 1, наличие ккал — +0,5.
const NOISE_WORDS = new Set(['процент', 'процента', 'процентов', 'проц', 'жирность', 'жирности']);

function tokenize(s) {
  return s
    .toLowerCase()
    .replace(/%/g, ' ')
    .split(/[\s,.;:()\-–—/]+/)
    .filter(Boolean);
}

// Русские бренды в OFF часто записаны латиницей (Nemoloko, Prostokvashino),
// поэтому кириллический запрос дублируем транслитом и сравниваем слова через него.
const RU_TO_LAT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y',
  ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function translit(s) {
  return s.toLowerCase().replace(/[а-яё]/g, (ch) => RU_TO_LAT[ch] ?? ch);
}

export function rankProducts(products, query) {
  const qTokens = tokenize(query).filter((t) => !NOISE_WORDS.has(t));
  if (!qTokens.length) return products;
  const qCanon = qTokens.map(translit);
  return products
    .map((p, i) => {
      const hayCanon = translit(`${p.name ?? ''} ${p.brand ?? ''}`);
      const hayTokens = new Set(tokenize(hayCanon));
      let score = p.kcal100 != null ? 0.5 : 0;
      for (const t of qCanon) {
        if (hayTokens.has(t)) score += 2;
        else if (hayCanon.includes(t)) score += 1;
      }
      return { p, i, score };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((s) => s.p);
}

const PAGE_SIZE = 50;
const MAX_RESULTS = 15;

// Каскад: search-a-licious → legacy-поиск. Бросает ApiError, если оба недоступны.
// Кириллический запрос расширяем транслитом (у поиска OFF OR-семантика,
// лишние слова не сужают выдачу — ранжируем всё равно сами).
export async function searchOpenFoodFacts(query) {
  const original = query.trim();
  const lat = translit(original);
  const expanded = lat !== original.toLowerCase() ? `${original} ${lat}` : original;
  const q = encodeURIComponent(expanded);
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
