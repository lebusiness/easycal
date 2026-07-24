import Dexie from 'dexie';
import { round1 } from './utils.js';
import { api } from './api-client.js';

export const DEFAULT_MEALS = ['Завтрак', 'Обед', 'Ужин', 'На ночь'];

// У каждого аккаунта своя база (имя приходит из auth.js). Модульная переменная —
// живой ES-биндинг: после openUserDb все импортёры видят актуальную БД.
// Открывается до монтирования основных экранов, закрывается при выходе.
export let db = null;

export function openUserDb(dbName) {
  const d = new Dexie(dbName);

  d.version(1).stores({
    diary: '++id, date',
    myProducts: '++id, name, barcode',
  });

  // v2: приёмы пищи, цели БЖУ, избранное, патчи API-продуктов.
  // В записи дневника хранится снапшот продукта (КБЖУ на 100 г, штрихкод и т. д.) —
  // из него строятся «часто употребляемые» и повторное добавление.
  d.version(2)
    .stores({
      diary: '++id, date, mealId, productKey',
      myProducts: '++id, name, barcode, favorite',
      meals: '++id, order',
      favorites: '++id, barcode',
      overrides: 'barcode',
      settings: 'key',
    })
    .upgrade(async (tx) => {
      const mealIds = [];
      for (let i = 0; i < DEFAULT_MEALS.length; i++) {
        mealIds.push(await tx.table('meals').add({ name: DEFAULT_MEALS[i], order: i }));
      }
      await tx.table('diary').toCollection().modify((e) => {
        e.mealId = mealIds[0];
        e.mealLabel = DEFAULT_MEALS[0];
        e.addedAt = null;
        e.productName = e.name;
        e.brand = null;
        e.barcode = null;
        e.myProductId = null;
        e.productKey = 'nm:' + (e.name || '').trim().toLowerCase();
        if (e.grams > 0) {
          e.kcal100 = round1(((e.kcal || 0) / e.grams) * 100);
          e.protein100 = round1(((e.protein || 0) / e.grams) * 100);
          e.fat100 = round1(((e.fat || 0) / e.grams) * 100);
          e.carbs100 = round1(((e.carbs || 0) / e.grams) * 100);
        }
      });
      await tx.table('myProducts').toCollection().modify((p) => {
        p.favorite = 0;
        p.description = p.description ?? null;
      });
    });

  db = d;
  return d;
}

// Полный снимок с сервера → локальное зеркало. Источник истины — Postgres;
// Dexie нужен для мгновенных реактивных чтений и офлайн-просмотра.
export async function pullSnapshot() {
  const snap = await api.get('/snapshot');
  await db.transaction(
    'rw',
    [db.diary, db.myProducts, db.meals, db.favorites, db.overrides, db.settings],
    async () => {
      await Promise.all([
        db.diary.clear(),
        db.myProducts.clear(),
        db.meals.clear(),
        db.favorites.clear(),
        db.overrides.clear(),
        db.settings.clear(),
      ]);
      await Promise.all([
        db.diary.bulkPut(snap.diary ?? []),
        db.myProducts.bulkPut(snap.myProducts ?? []),
        db.meals.bulkPut(snap.meals ?? []),
        db.favorites.bulkPut(snap.favorites ?? []),
        db.overrides.bulkPut(snap.overrides ?? []),
        db.settings.bulkPut(snap.settings ?? []),
      ]);
    }
  );
}

// ---------- Дневник ----------

export async function addDiaryEntry(entry) {
  const row = await api.post('/diary', entry);
  await db.diary.put(row);
  return row;
}

export async function updateDiaryEntry(id, changes) {
  const row = await api.put(`/diary/${id}`, changes);
  await db.diary.put(row);
  return row;
}

export async function deleteDiaryEntry(id) {
  await api.del(`/diary/${id}`);
  await db.diary.delete(id);
}

export function closeUserDb() {
  if (db) {
    try {
      db.close();
    } catch {
      /* уже закрыта */
    }
    db = null;
  }
}

// ---------- Продукты ----------

export function productKeyOf(p) {
  if (p.barcode) return 'bc:' + p.barcode;
  if (p.source === 'mine' && p.id != null) return 'my:' + p.id;
  return 'nm:' + (p.name ?? '').trim().toLowerCase();
}

function myProductToResult(p) {
  return {
    source: 'mine',
    id: p.id,
    name: p.name,
    brand: null,
    description: p.description ?? null,
    barcode: p.barcode ?? null,
    favorite: !!p.favorite,
    presets: p.presets ?? null,
    kcal100: p.kcal100 ?? null,
    protein100: p.protein100 ?? null,
    fat100: p.fat100 ?? null,
    carbs100: p.carbs100 ?? null,
  };
}

function favSnapshotToResult(s) {
  return {
    source: 'off',
    favId: s.id,
    name: s.name,
    brand: s.brand ?? null,
    description: null,
    barcode: s.barcode ?? null,
    favorite: true,
    presets: s.presets ?? null,
    kcal100: s.kcal100 ?? null,
    protein100: s.protein100 ?? null,
    fat100: s.fat100 ?? null,
    carbs100: s.carbs100 ?? null,
  };
}

// Поиск по подстроке (название + описание) без учёта регистра: мои продукты + избранные снапшоты
export async function searchLocalProducts(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const mine = await db.myProducts
    .filter((p) => `${p.name ?? ''} ${p.description ?? ''}`.toLowerCase().includes(q))
    .toArray();
  const snaps = await db.favorites
    .filter((s) => `${s.name ?? ''} ${s.brand ?? ''}`.toLowerCase().includes(q))
    .toArray();
  return [...mine.map(myProductToResult), ...snaps.map(favSnapshotToResult)];
}

export function getAllMyProducts() {
  return db.myProducts.orderBy('name').toArray().then((list) => list.map(myProductToResult));
}

export async function findMyProductByBarcode(barcode) {
  const p = await db.myProducts.where('barcode').equals(barcode).first();
  if (p) return myProductToResult(p);
  const snap = await db.favorites.where('barcode').equals(barcode).first();
  return snap ? favSnapshotToResult(snap) : null;
}

export async function addMyProduct({ name, description, barcode, kcal100, protein100, fat100, carbs100 }) {
  const row = await api.post('/myProducts', {
    name,
    description: description || null,
    barcode: barcode || null,
    kcal100,
    protein100,
    fat100,
    carbs100,
    favorite: 0,
  });
  await db.myProducts.put(row);
  return myProductToResult(row);
}

// ---------- Избранное ----------

export async function toggleMyProductFavorite(id) {
  const p = await db.myProducts.get(id);
  if (!p) return;
  const row = await api.put(`/myProducts/${id}`, { favorite: p.favorite ? 0 : 1 });
  await db.myProducts.put(row);
}

// Снапшот API-продукта (в т. ч. с изменёнными БЖУ); по штрихкоду заменяет прежний
export async function saveFavoriteSnapshot(product) {
  const rec = {
    name: product.name,
    brand: product.brand ?? null,
    barcode: product.barcode ?? null,
    presets: product.presets ?? null,
    kcal100: product.kcal100 ?? null,
    protein100: product.protein100 ?? null,
    fat100: product.fat100 ?? null,
    carbs100: product.carbs100 ?? null,
  };
  if (rec.barcode) {
    const existing = await db.favorites.where('barcode').equals(rec.barcode).first();
    if (existing) {
      const row = await api.put(`/favorites/${existing.id}`, rec);
      await db.favorites.put(row);
      return existing.id;
    }
  }
  const row = await api.post('/favorites', rec);
  await db.favorites.put(row);
  return row.id;
}

export async function removeFavorite(product) {
  if (product.source === 'mine' && product.id != null) {
    const row = await api.put(`/myProducts/${product.id}`, { favorite: 0 });
    await db.myProducts.put(row);
    return;
  }
  let favId = product.favId ?? null;
  if (favId == null && product.barcode) {
    const existing = await db.favorites.where('barcode').equals(product.barcode).first();
    favId = existing?.id ?? null;
  }
  if (favId != null) {
    await api.del(`/favorites/${favId}`);
    await db.favorites.delete(favId);
  }
}

export async function getFavoriteProducts() {
  const mine = await db.myProducts.where('favorite').equals(1).toArray();
  const snaps = await db.favorites.toArray();
  return [...mine.map(myProductToResult), ...snaps.map(favSnapshotToResult)];
}

// Данные избранного для продукта (флаг + пресеты граммов) — по своему id или штрихкоду
export async function getFavoriteFor(product) {
  if (product.source === 'mine' && product.id != null) {
    const p = await db.myProducts.get(product.id);
    return p?.favorite ? { favorite: true, presets: p.presets ?? null } : null;
  }
  if (product.barcode) {
    const s = await db.favorites.where('barcode').equals(product.barcode).first();
    if (s) return { favorite: true, favId: s.id, presets: s.presets ?? null };
  }
  return null;
}

export async function updateFavoritePresets(product, presets) {
  if (product.source === 'mine' && product.id != null) {
    const row = await api.put(`/myProducts/${product.id}`, { presets });
    await db.myProducts.put(row);
    return;
  }
  let favId = product.favId ?? null;
  if (favId == null && product.barcode) {
    const s = await db.favorites.where('barcode').equals(product.barcode).first();
    favId = s?.id ?? null;
  }
  if (favId != null) {
    const row = await api.put(`/favorites/${favId}`, { presets });
    await db.favorites.put(row);
  }
}

// ---------- Патчи (override) API-продуктов ----------

export async function saveOverride(barcode, { kcal100, protein100, fat100, carbs100 }) {
  const row = await api.put(`/overrides/${encodeURIComponent(barcode)}`, {
    kcal100,
    protein100,
    fat100,
    carbs100,
  });
  await db.overrides.put(row);
}

export async function getOverridesMap() {
  const list = await db.overrides.toArray();
  return new Map(list.map((o) => [o.barcode, o]));
}

export function applyOverride(product, overridesMap) {
  const o = product.barcode ? overridesMap.get(product.barcode) : null;
  if (!o) return product;
  return {
    ...product,
    kcal100: o.kcal100,
    protein100: o.protein100,
    fat100: o.fat100,
    carbs100: o.carbs100,
    patched: true,
  };
}

// ---------- Приёмы пищи ----------

export async function addMeal(name) {
  const count = await db.meals.count();
  const row = await api.post('/meals', { name, order: count });
  await db.meals.put(row);
  return row.id;
}

export async function renameMeal(id, name) {
  const row = await api.put(`/meals/${id}`, { name });
  await db.meals.put(row);
  // Название приёма скопировано в записях дневника — синхронизируем зеркало и сервер не трогаем
  await db.diary.where('mealId').equals(id).modify((e) => {
    e.mealLabel = name;
  });
}

export async function moveMeal(id, dir) {
  const meals = await db.meals.orderBy('order').toArray();
  const i = meals.findIndex((m) => m.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= meals.length) return;
  const orders = [
    { id: meals[i].id, order: meals[j].order },
    { id: meals[j].id, order: meals[i].order },
  ];
  await api.post('/meals/reorder', { orders });
  await db.transaction('rw', db.meals, async () => {
    for (const { id: mid, order } of orders) await db.meals.update(mid, { order });
  });
}

// Записи удаляемого приёма (за все дни) переносятся в первый оставшийся — на сервере,
// затем перечитываем снимок
export async function deleteMeal(id) {
  const count = await db.meals.count();
  if (count <= 1) return;
  await api.del(`/meals/${id}`);
  await pullSnapshot();
}

// Приём по умолчанию: по времени суток, если имена совпадают с дефолтными
export function guessMeal(meals, now = new Date()) {
  if (!meals?.length) return null;
  const h = now.getHours();
  const wanted = h >= 21 || h < 4 ? 'На ночь' : h >= 16 ? 'Ужин' : h >= 11 ? 'Обед' : 'Завтрак';
  return meals.find((m) => m.name === wanted) ?? meals[0];
}

// ---------- Цели БЖУ ----------

export async function getGoals() {
  const rec = await db.settings.get('goals');
  return rec?.value ?? null;
}

export async function saveGoals(goals) {
  await api.put('/settings/goals', { value: goals });
  await db.settings.put({ key: 'goals', value: goals });
}

export async function clearGoals() {
  await api.del('/settings/goals');
  await db.settings.delete('goals');
}

// ---------- Часто употребляемые ----------

function entryToProduct(e) {
  return {
    source: e.myProductId != null ? 'mine' : 'off',
    id: e.myProductId ?? undefined,
    name: e.productName ?? e.name,
    brand: e.brand ?? null,
    description: null,
    barcode: e.barcode ?? null,
    kcal100: e.kcal100 ?? null,
    protein100: e.protein100 ?? null,
    fat100: e.fat100 ?? null,
    carbs100: e.carbs100 ?? null,
  };
}

// Агрегация по последним записям дневника: сколько раз продукт добавлялся и в какие приёмы.
// Продукты, частые в текущем приёме (mealLabel), выдаются первыми.
export async function getFrequentProducts(mealLabel, limit = 30) {
  const entries = await db.diary.orderBy('date').reverse().limit(600).toArray();
  const map = new Map();
  for (const e of entries) {
    const key = e.productKey || 'nm:' + (e.name || '').trim().toLowerCase();
    let s = map.get(key);
    if (!s) {
      s = { total: 0, byMeal: {}, entry: e };
      map.set(key, s);
    }
    s.total += 1;
    if (e.mealLabel) s.byMeal[e.mealLabel] = (s.byMeal[e.mealLabel] || 0) + 1;
  }
  const items = [...map.values()].map((s) => {
    const topMeal = Object.entries(s.byMeal).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return { product: entryToProduct(s.entry), total: s.total, byMeal: s.byMeal, topMeal };
  });
  items.sort((a, b) => {
    const am = (mealLabel && a.byMeal[mealLabel]) || 0;
    const bm = (mealLabel && b.byMeal[mealLabel]) || 0;
    if (am !== bm) return bm - am;
    return b.total - a.total;
  });
  return items.slice(0, limit);
}
