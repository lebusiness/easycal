import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initDb } from './db.js';
import { authRouter, requireAuth } from './auth.js';
import { dataRouter } from './data.js';

const PORT = Number(process.env.PORT || 7347);
const HOST = process.env.HOST || '0.0.0.0'; // в проде за nginx — 127.0.0.1

const app = express();
// За nginx: настоящий IP клиента приходит в X-Forwarded-For (нужно для rate-limit)
app.set('trust proxy', 1);

// Заголовки безопасности + CSP: приложению нужны только свой origin,
// inline-стили (React style-атрибуты) и data:/blob: для картинок
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
      },
    },
  })
);

app.use(cors());
app.use(express.json({ limit: '200kb' }));

// Общий лимит API и жёсткий — на вход/регистрацию (защита от перебора паролей)
const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов — попробуйте через минуту' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток входа — подождите 15 минут' },
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use(['/api/auth/login', '/api/auth/register'], authLimiter);
app.use('/api', apiLimiter);
app.use('/api/auth', authRouter);
app.use('/api', requireAuth, dataRouter);

// Продакшен: раздаём собранный фронтенд из ../dist (single-origin, без CORS-проблем)
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Ошибка сервера' });
});

initDb()
  .then(() => {
    app.listen(PORT, HOST, () => console.log(`API на http://${HOST}:${PORT}`));
  })
  .catch((e) => {
    console.error('Не удалось инициализировать базу данных:', e.message);
    process.exit(1);
  });
