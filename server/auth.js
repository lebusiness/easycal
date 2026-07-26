import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'dev-secret-change-me') {
  throw new Error('В продакшене обязателен настоящий JWT_SECRET (см. /etc/calorie-tracker.env)');
}
const TOKEN_TTL = '30d';

const DEFAULT_MEALS = ['Завтрак', 'Обед', 'Ужин', 'На ночь'];

const publicUser = (u) => ({ id: u.id, email: u.email });
const signToken = (userId) => jwt.sign({ userId }, JWT_SECRET, { expiresIn: TOKEN_TTL });

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Нужно войти' });
  try {
    const { userId } = jwt.verify(token, JWT_SECRET);
    req.userId = userId;
    next();
  } catch {
    return res.status(401).json({ error: 'Сессия истекла — войдите заново' });
  }
}

export const authRouter = Router();

authRouter.post('/register', async (req, res, next) => {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Введите корректную почту' });
    if (password.length < 6) return res.status(400).json({ error: 'Пароль — минимум 6 символов' });

    const passHash = await bcrypt.hash(password, 10);
    let user;
    try {
      const r = await pool.query(
        'INSERT INTO users (email, pass_hash) VALUES ($1, $2) RETURNING id, email',
        [email, passHash]
      );
      user = r.rows[0];
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'Аккаунт с этой почтой уже есть — войдите' });
      throw e;
    }

    // Дефолтные приёмы пищи для нового аккаунта
    for (let i = 0; i < DEFAULT_MEALS.length; i++) {
      await pool.query('INSERT INTO meals (user_id, name, "order") VALUES ($1, $2, $3)', [
        user.id,
        DEFAULT_MEALS[i],
        i,
      ]);
    }

    res.json({ token: signToken(user.id), user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const r = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = r.rows[0];
    if (!user) return res.status(404).json({ error: 'Аккаунт не найден — проверьте почту или зарегистрируйтесь' });
    const ok = await bcrypt.compare(password, user.pass_hash);
    if (!ok) return res.status(401).json({ error: 'Неверный пароль' });
    res.json({ token: signToken(user.id), user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const r = await pool.query('SELECT id, email FROM users WHERE id = $1', [req.userId]);
    if (!r.rows[0]) return res.status(401).json({ error: 'Аккаунт не найден' });
    // Каждая успешная проверка сессии продлевает её: выдаём свежий токен,
    // чтобы активного пользователя не разлогинивало по истечении TOKEN_TTL
    res.json({ user: publicUser(r.rows[0]), token: signToken(r.rows[0].id) });
  } catch (e) {
    next(e);
  }
});
