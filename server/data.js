import { Router } from 'express';
import { pool } from './db.js';

// Таблицы, доступные через общий CRUD; поля — в camelCase, как на клиенте
const TABLES = {
  diary: {
    table: 'diary',
    fields: [
      'date', 'mealId', 'mealLabel', 'name', 'productName', 'brand', 'barcode',
      'myProductId', 'productKey', 'kcal100', 'protein100', 'fat100', 'carbs100',
      'grams', 'kcal', 'protein', 'fat', 'carbs', 'addedAt',
    ],
  },
  myProducts: {
    table: 'my_products',
    fields: ['name', 'description', 'barcode', 'favorite', 'presets', 'kcal100', 'protein100', 'fat100', 'carbs100'],
  },
  meals: {
    table: 'meals',
    fields: ['name', 'order'],
  },
  favorites: {
    table: 'favorites',
    fields: ['name', 'brand', 'barcode', 'presets', 'kcal100', 'protein100', 'fat100', 'carbs100'],
  },
};

const camelToSnake = (s) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
const snakeToCamel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

function rowToClient(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'user_id') continue;
    out[snakeToCamel(k)] = v;
  }
  return out;
}

const quoteCol = (field) => `"${camelToSnake(field)}"`;

function pickFields(body, fields) {
  const cols = [];
  const values = [];
  for (const f of fields) {
    if (body[f] !== undefined) {
      cols.push(quoteCol(f));
      values.push(f === 'presets' && body[f] != null ? JSON.stringify(body[f]) : body[f]);
    }
  }
  return { cols, values };
}

export const dataRouter = Router();

// Полный снимок данных пользователя — клиент кладёт его в локальное зеркало
dataRouter.get('/snapshot', async (req, res, next) => {
  try {
    const u = req.userId;
    const [diary, myProducts, meals, favorites, overrides, settings] = await Promise.all([
      pool.query('SELECT * FROM diary WHERE user_id = $1 ORDER BY id', [u]),
      pool.query('SELECT * FROM my_products WHERE user_id = $1 ORDER BY id', [u]),
      pool.query('SELECT * FROM meals WHERE user_id = $1 ORDER BY "order"', [u]),
      pool.query('SELECT * FROM favorites WHERE user_id = $1 ORDER BY id', [u]),
      pool.query('SELECT * FROM overrides WHERE user_id = $1', [u]),
      pool.query('SELECT * FROM settings WHERE user_id = $1', [u]),
    ]);
    res.json({
      diary: diary.rows.map(rowToClient),
      myProducts: myProducts.rows.map(rowToClient),
      meals: meals.rows.map(rowToClient),
      favorites: favorites.rows.map(rowToClient),
      overrides: overrides.rows.map(rowToClient),
      settings: settings.rows.map(rowToClient),
    });
  } catch (e) {
    next(e);
  }
});

// Перестановка приёмов местами
dataRouter.post('/meals/reorder', async (req, res, next) => {
  try {
    const orders = Array.isArray(req.body?.orders) ? req.body.orders : [];
    for (const { id, order } of orders) {
      await pool.query('UPDATE meals SET "order" = $1 WHERE id = $2 AND user_id = $3', [
        order, id, req.userId,
      ]);
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// Удаление приёма: записи за все дни переносятся в первый оставшийся
dataRouter.delete('/meals/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const u = req.userId;
    const id = Number(req.params.id);
    await client.query('BEGIN');
    const others = await client.query(
      'SELECT id, name FROM meals WHERE user_id = $1 AND id <> $2 ORDER BY "order" LIMIT 1',
      [u, id]
    );
    if (!others.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Нельзя удалить последний приём' });
    }
    const target = others.rows[0];
    await client.query(
      'UPDATE diary SET meal_id = $1, meal_label = $2 WHERE user_id = $3 AND meal_id = $4',
      [target.id, target.name, u, id]
    );
    await client.query('DELETE FROM meals WHERE user_id = $1 AND id = $2', [u, id]);
    await client.query('COMMIT');
    res.json({ ok: true, targetId: target.id, targetName: target.name });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    next(e);
  } finally {
    client.release();
  }
});

// Настройки (цели) и патчи продуктов — upsert по ключу
dataRouter.put('/settings/:key', async (req, res, next) => {
  try {
    await pool.query(
      `INSERT INTO settings (user_id, key, value) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, key) DO UPDATE SET value = $3`,
      [req.userId, req.params.key, JSON.stringify(req.body?.value ?? null)]
    );
    res.json({ key: req.params.key, value: req.body?.value ?? null });
  } catch (e) {
    next(e);
  }
});

dataRouter.delete('/settings/:key', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM settings WHERE user_id = $1 AND key = $2', [req.userId, req.params.key]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

dataRouter.put('/overrides/:barcode', async (req, res, next) => {
  try {
    const { kcal100 = null, protein100 = null, fat100 = null, carbs100 = null } = req.body ?? {};
    await pool.query(
      `INSERT INTO overrides (user_id, barcode, kcal100, protein100, fat100, carbs100)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, barcode) DO UPDATE SET kcal100 = $3, protein100 = $4, fat100 = $5, carbs100 = $6`,
      [req.userId, req.params.barcode, kcal100, protein100, fat100, carbs100]
    );
    res.json({ barcode: req.params.barcode, kcal100, protein100, fat100, carbs100 });
  } catch (e) {
    next(e);
  }
});

// Общий CRUD по вайтлисту таблиц
dataRouter.post('/:table', async (req, res, next) => {
  try {
    const cfg = TABLES[req.params.table];
    if (!cfg) return res.status(404).json({ error: 'Неизвестная таблица' });
    const { cols, values } = pickFields(req.body ?? {}, cfg.fields);
    const placeholders = values.map((_, i) => `$${i + 2}`);
    const r = await pool.query(
      `INSERT INTO ${cfg.table} (user_id${cols.length ? ', ' + cols.join(', ') : ''})
       VALUES ($1${placeholders.length ? ', ' + placeholders.join(', ') : ''}) RETURNING *`,
      [req.userId, ...values]
    );
    res.json(rowToClient(r.rows[0]));
  } catch (e) {
    next(e);
  }
});

dataRouter.put('/:table/:id', async (req, res, next) => {
  try {
    const cfg = TABLES[req.params.table];
    if (!cfg) return res.status(404).json({ error: 'Неизвестная таблица' });
    const { cols, values } = pickFields(req.body ?? {}, cfg.fields);
    if (!cols.length) return res.status(400).json({ error: 'Нет полей для обновления' });
    const sets = cols.map((c, i) => `${c} = $${i + 3}`);
    const r = await pool.query(
      `UPDATE ${cfg.table} SET ${sets.join(', ')} WHERE user_id = $1 AND id = $2 RETURNING *`,
      [req.userId, Number(req.params.id), ...values]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Запись не найдена' });
    res.json(rowToClient(r.rows[0]));
  } catch (e) {
    next(e);
  }
});

dataRouter.delete('/:table/:id', async (req, res, next) => {
  try {
    const cfg = TABLES[req.params.table];
    if (!cfg) return res.status(404).json({ error: 'Неизвестная таблица' });
    await pool.query(`DELETE FROM ${cfg.table} WHERE user_id = $1 AND id = $2`, [
      req.userId,
      Number(req.params.id),
    ]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
