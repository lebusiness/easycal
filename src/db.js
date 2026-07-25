import Dexie from 'dexie';
import { round1 } from './utils.js';
import { api, ServerError } from './api-client.js';
import { toast } from './toast.js';
import { buildQueryPlan, normText, scorePlan, textForms } from './searchText.js';

export const DEFAULT_MEALS = ['Завтрак', 'Обед', 'Ужин', 'На ночь'];

// У каждого аккаунта своя база (имя приходит из auth.js). Модульная переменная —
// живой ES-биндинг: после openUserDb все импортёры видят актуальную БД.
// Открывается до монтирования основных экранов, закрывается при выходе.
export let db = null;

export function openUserDb(dbName) {
  // Кэш Dexie 4 умеет отдавать несвежие результаты индексных запросов внутри
  // rw-транзакций (гонка с оптимистичными обновлениями кэша) — работаем без него
  const d = new Dexie(dbName, { cache: 'disabled' });

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

  session += 1;
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

// ---------- Оптимистичные мутации ----------
//
// Каждое изменение сразу пишется в локальное зеркало — UI (через liveQuery)
// обновляется мгновенно, — а запрос к серверу уходит в фоновую последовательную
// очередь: сервер видит операции в том порядке, в котором их сделал пользователь
// (создание — раньше зависимого изменения). Если запрос провалился, локальное
// изменение откатывается и поверх экрана показывается мини-уведомление.
//
// Созданные записи до ответа сервера живут под временным строковым id: строковые
// ключи не пересекаются ни со счётчиком автоинкремента IndexedDB, ни с числовыми
// id Postgres (префикс случайный — на случай «зомби»-строк от прервавшейся сессии).
// После ответа временная запись атомарно заменяется серверной, а правки, успевшие
// лечь поверх временной, переносятся.

let session = 0; // поколение аккаунта: после выхода чужие откаты и тосты не нужны
const tempPrefix = `tmp-${Math.random().toString(36).slice(2, 7)}-`;
let tempSeq = 0;
const newTempId = () => tempPrefix + ++tempSeq;
const isTempId = (id) => typeof id === 'string' && id.startsWith('tmp-');
const tempPromises = new Map(); // временный id → промис настоящего id (null — создание провалилось)
const tempResolved = new Map(); // временный id → настоящий id (после ответа сервера)

// Ключ записи в зеркале прямо сейчас: временный, пока создание не подтверждено
const localId = (id) => tempResolved.get(id) ?? id;

// id для запроса на сервер: для временного ждём исход создания (очередь гарантирует,
// что к моменту зависимого запроса оно уже завершилось)
async function serverId(id) {
  if (!isTempId(id)) return id;
  const real = tempResolved.get(id) ?? (await tempPromises.get(id));
  if (real == null) throw new ServerError('запись не была создана');
  return real;
}

let chain = Promise.resolve();

// Ставит запрос в фоновую очередь; при ошибке — откат и мини-уведомление. Не бросает.
function background(label, request, revert) {
  const startedIn = session;
  const run = chain.then(async () => {
    // Аккаунт сменился, пока запрос ждал в очереди, — не отправляем его с чужим токеном
    if (startedIn !== session) return null;
    try {
      return await request();
    } catch (e) {
      if (startedIn === session) {
        if (revert) await revert().catch(() => {});
        const reason = e instanceof ServerError ? e.message : '';
        toast(
          `Не удалось ${label}${reason ? ` — ${reason.charAt(0).toLowerCase()}${reason.slice(1)}` : ''}`
        );
      }
      return null;
    }
  });
  chain = run.then(() => {});
  return run;
}

// Создание: запись уже лежит в зеркале под временным id. После ответа сервера она
// атомарно заменяется настоящей вместе с правками, успевшими лечь поверх временной.
// Сбой обновления зеркала после успешного запроса глотаем: данные на сервере целы,
// а зеркало могло закрыться (выход из аккаунта) — синхронизирует ближайший pullSnapshot.
function backgroundCreate(label, table, tempRow, request, { extraTables = [], onReconciled } = {}) {
  const run = background(
    label,
    async () => {
      const row = await request();
      tempResolved.set(tempRow.id, row.id);
      try {
        await table.db.transaction('rw', [table, ...extraTables], async () => {
          const current = await table.get(tempRow.id);
          await table.delete(tempRow.id);
          const edits = {};
          if (current) {
            for (const k of Object.keys(current)) {
              if (k !== 'id' && current[k] !== tempRow[k]) edits[k] = current[k];
            }
          }
          await table.put({ ...row, ...edits });
          if (onReconciled) await onReconciled(row);
        });
      } catch {
        /* зеркало недоступно */
      }
      return row;
    },
    () => table.delete(tempRow.id)
  );
  tempPromises.set(
    tempRow.id,
    run.then((row) => row?.id ?? null)
  );
}

// Обновление: старые значения изменяемых полей запоминаются для отката.
// prepareBody (необязателен) готовит тело запроса — подменяет временные id ссылок.
async function backgroundUpdate(label, table, path, id, changes, prepareBody) {
  const before = await table.get(localId(id));
  const prev = {};
  if (before) {
    for (const k of Object.keys(changes)) prev[k] = before[k];
    await table.update(localId(id), changes);
  }
  background(
    label,
    async () => {
      const body = prepareBody ? await prepareBody() : changes;
      const row = await api.put(`${path}/${await serverId(id)}`, body);
      try {
        await table.put(row);
      } catch {
        /* зеркало недоступно */
      }
      return row;
    },
    async () => {
      if (!before) return;
      if (await table.get(localId(id))) await table.update(localId(id), prev);
    }
  );
}

// Удаление: запись пропадает из зеркала сразу; при ошибке возвращается на место.
// Если создание записи само не прошло, на сервере удалять нечего — тихий успех.
async function backgroundDelete(label, table, path, id) {
  const before = await table.get(localId(id));
  if (before) await table.delete(localId(id));
  background(
    label,
    async () => {
      let sid;
      try {
        sid = await serverId(id);
      } catch {
        return null;
      }
      return api.del(`${path}/${sid}`);
    },
    () => (before ? table.put({ ...before, id: localId(before.id) }) : Promise.resolve())
  );
}

// ---------- Дневник ----------

export async function addDiaryEntry(entry) {
  const local = { ...entry, id: newTempId() };
  await db.diary.put(local);
  backgroundCreate('добавить запись', db.diary, local, async () => {
    // ссылки на ещё не подтверждённые приём/продукт подменяем настоящими id
    const body = { ...entry, mealId: await serverId(entry.mealId) };
    if (isTempId(entry.myProductId)) {
      body.myProductId = await serverId(entry.myProductId);
      body.productKey = `my:${body.myProductId}`;
    }
    return api.post('/diary', body);
  });
  return local;
}

export async function updateDiaryEntry(id, changes) {
  await backgroundUpdate('изменить запись', db.diary, '/diary', id, changes, async () =>
    changes.mealId != null ? { ...changes, mealId: await serverId(changes.mealId) } : changes
  );
}

export async function deleteDiaryEntry(id) {
  await backgroundDelete('удалить запись', db.diary, '/diary', id);
}

export function closeUserDb() {
  session += 1;
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

export function myProductToResult(p) {
  return {
    source: 'mine',
    id: p.id,
    name: p.name,
    brand: null,
    description: p.description ?? null,
    barcode: p.barcode ?? null,
    favorite: !!p.favorite,
    presets: p.presets ?? null,
    ingredients: p.ingredients ?? null,
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

// Поиск по своим продуктам и избранным снапшотам через общий движок searchText.js:
// опечатки, раскладка, транслит, ё/й — как в справочнике. Вхождение подстрокой
// (прежнее поведение) оставлено запасным путём, результаты ранжируются.
export async function searchLocalProducts(query) {
  const plan = buildQueryPlan(query);
  if (!plan) return [];
  const scoreOf = (name, extra) => {
    const hay = `${name ?? ''} ${extra ?? ''}`;
    let s = scorePlan(plan, textForms(hay));
    if (!s && normText(hay).includes(plan.qNorm)) s = 0.3;
    if (s && name && normText(name).startsWith(plan.qNorm)) s += 2;
    return s;
  };
  const [mine, snaps] = await Promise.all([db.myProducts.toArray(), db.favorites.toArray()]);
  return [
    ...mine.map((p) => ({ r: myProductToResult(p), s: scoreOf(p.name, p.description) })),
    ...snaps.map((f) => ({ r: favSnapshotToResult(f), s: scoreOf(f.name, f.brand) })),
  ]
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 30)
    .map((x) => x.r);
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

export async function addMyProduct({ name, description, barcode, kcal100, protein100, fat100, carbs100, favorite = false, presets = null, ingredients = null }) {
  const body = {
    name,
    description: description || null,
    barcode: barcode || null,
    kcal100,
    protein100,
    fat100,
    carbs100,
    favorite: favorite ? 1 : 0,
    presets,
    ingredients,
  };
  const local = { ...body, id: newTempId() };
  await db.myProducts.put(local);
  backgroundCreate('сохранить продукт', db.myProducts, local, () => api.post('/myProducts', body));
  return myProductToResult(local);
}

export async function updateMyProduct(id, changes) {
  await backgroundUpdate('изменить продукт', db.myProducts, '/myProducts', id, changes);
}

export async function deleteMyProduct(id) {
  await backgroundDelete('удалить продукт', db.myProducts, '/myProducts', id);
}

// ---------- Избранное ----------

export async function toggleMyProductFavorite(id) {
  const p = await db.myProducts.get(localId(id));
  if (!p) return;
  await backgroundUpdate('изменить избранное', db.myProducts, '/myProducts', id, {
    favorite: p.favorite ? 0 : 1,
  });
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
      await backgroundUpdate('сохранить в избранное', db.favorites, '/favorites', existing.id, rec);
      return existing.id;
    }
  }
  const local = { ...rec, id: newTempId() };
  await db.favorites.put(local);
  backgroundCreate('сохранить в избранное', db.favorites, local, () => api.post('/favorites', rec));
  return local.id;
}

export async function removeFavorite(product) {
  if (product.source === 'mine' && product.id != null) {
    await backgroundUpdate('убрать из избранного', db.myProducts, '/myProducts', product.id, {
      favorite: 0,
    });
    return;
  }
  let favId = product.favId ?? null;
  if (favId == null && product.barcode) {
    const existing = await db.favorites.where('barcode').equals(product.barcode).first();
    favId = existing?.id ?? null;
  }
  if (favId != null) await backgroundDelete('убрать из избранного', db.favorites, '/favorites', favId);
}

export async function getFavoriteProducts() {
  const mine = await db.myProducts.where('favorite').equals(1).toArray();
  const snaps = await db.favorites.toArray();
  return [...mine.map(myProductToResult), ...snaps.map(favSnapshotToResult)];
}

// Данные избранного для продукта (флаг + пресеты граммов) — по своему id или штрихкоду.
// У своих продуктов пресеты живут на самой записи и работают и без звёздочки.
export async function getFavoriteFor(product) {
  if (product.source === 'mine' && product.id != null) {
    const p = await db.myProducts.get(product.id);
    return p ? { favorite: !!p.favorite, presets: p.presets ?? null } : null;
  }
  if (product.barcode) {
    const s = await db.favorites.where('barcode').equals(product.barcode).first();
    if (s) return { favorite: true, favId: s.id, presets: s.presets ?? null };
  }
  return null;
}

export async function updateFavoritePresets(product, presets) {
  if (product.source === 'mine' && product.id != null) {
    await backgroundUpdate('сохранить пресеты', db.myProducts, '/myProducts', product.id, { presets });
    return;
  }
  let favId = product.favId ?? null;
  if (favId == null && product.barcode) {
    const s = await db.favorites.where('barcode').equals(product.barcode).first();
    favId = s?.id ?? null;
  }
  if (favId != null) {
    await backgroundUpdate('сохранить пресеты', db.favorites, '/favorites', favId, { presets });
  }
}

// ---------- Патчи (override) API-продуктов ----------

export async function saveOverride(barcode, { kcal100, protein100, fat100, carbs100 }) {
  const row = { barcode, kcal100, protein100, fat100, carbs100 };
  const before = await db.overrides.get(barcode);
  await db.overrides.put(row);
  background(
    'сохранить БЖУ продукта',
    () => api.put(`/overrides/${encodeURIComponent(barcode)}`, row),
    () => (before ? db.overrides.put(before) : db.overrides.delete(barcode))
  );
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
  const meals = db.meals;
  const diary = db.diary;
  const count = await meals.count();
  const local = { id: newTempId(), name, order: count };
  await meals.put(local);
  backgroundCreate('добавить приём', meals, local, () => api.post('/meals', { name, order: count }), {
    // записи дневника, успевшие сослаться на временный id приёма, переводим на настоящий
    extraTables: [diary],
    onReconciled: (row) =>
      diary.where('mealId').equals(local.id).modify((e) => {
        e.mealId = row.id;
      }),
  });
  return local.id;
}

export async function renameMeal(id, name) {
  const meals = db.meals;
  const diary = db.diary;
  const before = await meals.get(localId(id));
  if (!before) return;
  const prevName = before.name;
  // Название приёма скопировано в записях дневника — синхронизируем зеркало, сервер их не трогает
  const relabel = (label) =>
    meals.db.transaction('rw', [meals, diary], async () => {
      if (await meals.get(localId(id))) await meals.update(localId(id), { name: label });
      await diary.where('mealId').equals(localId(id)).modify((e) => {
        e.mealLabel = label;
      });
    });
  await relabel(name);
  background(
    'переименовать приём',
    async () => {
      const row = await api.put(`/meals/${await serverId(id)}`, { name });
      try {
        await meals.put(row);
      } catch {
        /* зеркало недоступно */
      }
      return row;
    },
    () => relabel(prevName)
  );
}

export async function moveMeal(id, dir) {
  const table = db.meals;
  const meals = await table.orderBy('order').toArray();
  const i = meals.findIndex((m) => m.id === localId(id));
  const j = i + dir;
  if (i < 0 || j < 0 || j >= meals.length) return;
  const a = { id: meals[i].id, order: meals[i].order };
  const b = { id: meals[j].id, order: meals[j].order };
  // swap(x, y): x получает порядок y и наоборот; откат — обратный вызов
  const swap = (x, y) =>
    table.db.transaction('rw', table, async () => {
      await table.update(localId(x.id), { order: y.order });
      await table.update(localId(y.id), { order: x.order });
    });
  await swap(a, b);
  background(
    'изменить порядок приёмов',
    async () =>
      api.post('/meals/reorder', {
        orders: [
          { id: await serverId(a.id), order: b.order },
          { id: await serverId(b.id), order: a.order },
        ],
      }),
    () => swap(b, a)
  );
}

// Записи удаляемого приёма (за все дни) переносятся в первый оставшийся — зеркало
// повторяет логику сервера, поэтому снимок перечитывать не нужно
export async function deleteMeal(id) {
  const mealsTable = db.meals;
  const diary = db.diary;
  const all = await mealsTable.orderBy('order').toArray();
  if (all.length <= 1) return;
  const meal = all.find((m) => m.id === localId(id));
  const target = all.find((m) => m.id !== localId(id));
  if (!meal || !target) return;
  const movedIds = [];
  await mealsTable.db.transaction('rw', [mealsTable, diary], async () => {
    await diary.where('mealId').equals(meal.id).modify((e) => {
      movedIds.push(e.id);
      e.mealId = target.id;
      e.mealLabel = target.name;
    });
    await mealsTable.delete(meal.id);
  });
  background(
    'удалить приём',
    async () => {
      let sid;
      try {
        sid = await serverId(id);
      } catch {
        return null; // приёма на сервере и не было
      }
      return api.del(`/meals/${sid}`);
    },
    () =>
      mealsTable.db.transaction('rw', [mealsTable, diary], async () => {
        await mealsTable.put({ ...meal, id: localId(meal.id) });
        for (const eid of movedIds) {
          if (await diary.get(localId(eid))) {
            await diary.update(localId(eid), { mealId: localId(meal.id), mealLabel: meal.name });
          }
        }
      })
  );
}

// Цели приёма: { protein, fat, carbs } или null — снять цель
export async function setMealGoals(id, goals) {
  await backgroundUpdate('сохранить цели приёма', db.meals, '/meals', id, { goals });
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
  const settings = db.settings;
  const before = await settings.get('goals');
  await settings.put({ key: 'goals', value: goals });
  background(
    'сохранить цели',
    () => api.put('/settings/goals', { value: goals }),
    () => (before ? settings.put(before) : settings.delete('goals'))
  );
}

export async function clearGoals() {
  const settings = db.settings;
  const before = await settings.get('goals');
  if (before) await settings.delete('goals');
  background(
    'убрать цели',
    () => api.del('/settings/goals'),
    () => (before ? settings.put(before) : Promise.resolve())
  );
}

// ---------- Часто употребляемые ----------

// Снапшот записи дневника → продукт для карточки/списков
export function entryToProduct(e) {
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
