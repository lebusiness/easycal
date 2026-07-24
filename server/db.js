import pg from 'pg';

const { Pool } = pg;

export const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://localhost:5432/calorie_tracker';

export const pool = new Pool({ connectionString: DATABASE_URL });

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    pass_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS meals (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    "order" INT NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS diary (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    meal_id INT,
    meal_label TEXT,
    name TEXT,
    product_name TEXT,
    brand TEXT,
    barcode TEXT,
    my_product_id INT,
    product_key TEXT,
    kcal100 REAL, protein100 REAL, fat100 REAL, carbs100 REAL,
    grams REAL, kcal REAL, protein REAL, fat REAL, carbs REAL,
    added_at TEXT
  );
  CREATE INDEX IF NOT EXISTS diary_user_date ON diary(user_id, date);

  CREATE TABLE IF NOT EXISTS my_products (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    barcode TEXT,
    favorite INT NOT NULL DEFAULT 0,
    presets JSONB,
    kcal100 REAL, protein100 REAL, fat100 REAL, carbs100 REAL
  );

  CREATE TABLE IF NOT EXISTS favorites (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    brand TEXT,
    barcode TEXT,
    presets JSONB,
    kcal100 REAL, protein100 REAL, fat100 REAL, carbs100 REAL
  );

  CREATE TABLE IF NOT EXISTS overrides (
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    barcode TEXT NOT NULL,
    kcal100 REAL, protein100 REAL, fat100 REAL, carbs100 REAL,
    PRIMARY KEY (user_id, barcode)
  );

  CREATE TABLE IF NOT EXISTS settings (
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value JSONB,
    PRIMARY KEY (user_id, key)
  );
`;

// Если базы ещё нет — создаём её через служебную БД postgres
async function ensureDatabase() {
  try {
    const c = await pool.connect();
    c.release();
  } catch (e) {
    if (e.code !== '3D000') throw e; // database does not exist
    const url = new URL(DATABASE_URL);
    const dbName = url.pathname.slice(1);
    if (!/^[a-z0-9_]+$/i.test(dbName)) throw new Error(`Недопустимое имя базы: ${dbName}`);
    url.pathname = '/postgres';
    const admin = new Pool({ connectionString: url.toString() });
    await admin.query(`CREATE DATABASE "${dbName}"`);
    await admin.end();
  }
}

export async function initDb() {
  await ensureDatabase();
  await pool.query(SCHEMA);
}
