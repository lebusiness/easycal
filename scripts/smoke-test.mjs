// Полный e2e-смоук: настоящий сервер (Express + Postgres, чистая тестовая БД) +
// собранный фронтенд в jsdom с fake-indexeddb в роли локального зеркала.
import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const distAssets = join(process.cwd(), 'dist', 'assets');
const indexJs = readdirSync(distAssets).find((f) => f.startsWith('index-') && f.endsWith('.js'));
if (!indexJs) throw new Error('Бандл не найден — сначала npm run build');

// --- Чистая тестовая база Postgres
const require = createRequire(import.meta.url);
const pg = require('../server/node_modules/pg');
const TEST_DB = 'calorie_tracker_test';
const PG_BASE = process.env.TEST_PG_BASE || 'postgres://localhost:5432';
{
  const admin = new pg.Pool({ connectionString: `${PG_BASE}/postgres` });
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();
}

// --- Сервер на тестовом порту
const API_PORT = 7348;
const server = spawn('node', [join(process.cwd(), 'server', 'index.js')], {
  env: {
    ...process.env,
    PORT: String(API_PORT),
    DATABASE_URL: `${PG_BASE}/${TEST_DB}`,
    JWT_SECRET: 'test-secret',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});
process.on('exit', () => server.kill());

{
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    await new Promise((r) => setTimeout(r, 200));
    up = await fetch(`http://localhost:${API_PORT}/api/health`)
      .then((r) => r.ok)
      .catch(() => false);
  }
  if (!up) throw new Error('Сервер не поднялся');
  console.log('✓ Сервер поднят на чистой тестовой базе Postgres');
}

// Фронтенд ходит на относительные /api и /off-* — абсолютизируем на тестовый сервер
const realFetch = globalThis.fetch;
const fetchShim = (url, opts) =>
  realFetch(typeof url === 'string' && url.startsWith('/') ? `http://localhost:${API_PORT}${url}` : url, opts);
globalThis.fetch = fetchShim;

const dom = new JSDOM('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});

const { window } = dom;
for (const key of Object.getOwnPropertyNames(window)) {
  if (!(key in globalThis)) {
    try {
      globalThis[key] = window[key];
    } catch {
      /* readonly */
    }
  }
}
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
window.indexedDB = globalThis.indexedDB;
window.IDBKeyRange = globalThis.IDBKeyRange;
window.confirm = () => true;
window.fetch = fetchShim;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// toLocaleString('ru-RU') разделяет тысячи неразрывными пробелами — нормализуем
const bodyText = () => window.document.body.textContent.replace(/[  ]/g, ' ');

function findButton(text) {
  const btn = [...window.document.querySelectorAll('button')].find((b) => b.textContent.includes(text));
  if (!btn) throw new Error(`Кнопка «${text}» не найдена`);
  return btn;
}

function findByAria(label) {
  const btn = [...window.document.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === label
  );
  if (!btn) throw new Error(`Кнопка с aria-label «${label}» не найдена`);
  return btn;
}

function setInput(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
}

function inputByLabel(text) {
  const label = [...window.document.querySelectorAll('label')].find((l) => l.textContent.includes(text));
  const input =
    label?.querySelector('input, textarea') ??
    (label?.htmlFor ? window.document.getElementById(label.htmlFor) : null);
  if (!input) throw new Error(`Поле «${text}» не найдено`);
  return input;
}

await import(join(distAssets, indexJs));
await sleep(600);

// --- Регистрация локального аккаунта
if (!bodyText().includes('Регистрация') || !bodyText().includes('Вход')) {
  throw new Error('Экран входа не показался');
}
findButton('Регистрация').click();
await sleep(150);
setInput(inputByLabel('Почта'), 'test@test.ru');
setInput(inputByLabel('Пароль'), '123456');
findButton('Создать аккаунт').click();
await sleep(1500); // PBKDF2 + открытие БД
if (!bodyText().includes('Итого за день')) throw new Error('После регистрации дневник не открылся');
console.log('✓ Регистрация: почта+пароль без писем, дневник открылся');

// --- Дневник: дефолтные приёмы
for (const text of ['Сегодня', 'Итого за день', 'Завтрак', 'Обед', 'Ужин', 'На ночь', 'Задать цели']) {
  if (!bodyText().includes(text)) throw new Error(`На экране дневника нет текста: «${text}»`);
}
console.log('✓ Дневник: приёмы по умолчанию (Завтрак/Обед/Ужин/На ночь) и кнопка целей');

// --- Цели БЖУ
findButton('Задать цели').click();
await sleep(200);
setInput(inputByLabel('Белки'), '150');
setInput(inputByLabel('Жиры'), '70');
setInput(inputByLabel('Углеводы'), '250');
await sleep(100);
// 150*4 + 70*9 + 250*4 = 600+630+1000 = 2230
if (!bodyText().includes('2 230')) throw new Error('Авто-ккал цели не посчитались (нет 2 230)');
findButton('Сохранить').click();
await sleep(300);
if (!bodyText().includes('/150') || !bodyText().includes('/ 2 230')) {
  throw new Error('Прогресс-бары целей не отобразились');
}
console.log('✓ Цели: авто-ккал (2 230) и прогресс-бары в дневнике');

// --- Добавление в «На ночь» через «+» приёма
const nightSection = [...window.document.querySelectorAll('button')].find((b) =>
  b.getAttribute('aria-label') === 'Добавить в «На ночь»'
);
if (!nightSection) throw new Error('Кнопка «+» у приёма «На ночь» не найдена');
nightSection.click();
await sleep(300);
for (const text of ['Частые', 'Избранное', 'Свои']) {
  if (!bodyText().includes(text)) throw new Error(`Экран добавления: нет «${text}»`);
}
findByAria('Сканировать штрихкод');
console.log('✓ Экран добавления: выбран приём, есть вкладки Частые/Избранное/Свои');

// --- Свой продукт с авто-ккал
findButton('Свои').click();
await sleep(300);
findButton('+ Новый продукт').click();
await sleep(200);
setInput(inputByLabel('Название'), 'Творог 5%');
setInput(inputByLabel('Описание'), 'тестовое описание');
setInput(inputByLabel('Белки'), '17');
setInput(inputByLabel('Жиры'), '5');
setInput(inputByLabel('Углеводы'), '1,8');
setInput(inputByLabel('Штрихкод'), '4600000000001');
await sleep(100);
// 17*4 + 5*9 + 1.8*4 = 68+45+7.2 = 120
if (!bodyText().includes('120 ккал')) throw new Error('Авто-ккал продукта не посчитались (нет 120)');
findButton('Сохранить продукт').click();
await sleep(400);
if (!bodyText().includes('Добавить в «На ночь»')) {
  throw new Error(`Карточка продукта с приёмом «На ночь» не открылась: ${bodyText().slice(0, 200)}`);
}
console.log('✓ Свой продукт: авто-ккал 120, карточка с приёмом «На ночь»');

// --- Порция 150 г через барабан → 180 ккал
findButton('150 г').click();
await sleep(150);
if (!bodyText().includes('180')) throw new Error('Живой пересчёт порции не сработал (нет 180 ккал)');
console.log('✓ Барабан: выбор 150 г без клавиатуры, пересчёт на 180 ккал');

// --- Переключение на ввод с клавиатуры сохраняет значение
findButton('Ввести с клавиатуры').click();
await sleep(150);
const gramsInput = window.document.getElementById('grams');
if (!gramsInput || gramsInput.value !== '150') {
  throw new Error(`Поле граммов после переключения: ${gramsInput?.value ?? 'нет поля'}`);
}
findButton('Крутить барабан').click();
await sleep(150);
if (window.document.getElementById('grams')) throw new Error('Барабан не вернулся');
console.log('✓ Переключение барабан ↔ клавиатура сохраняет значение');

findButton('Добавить в «На ночь»').click();
await sleep(500);

// --- Запись в дневнике с временем, прогресс обновился
const diaryText = bodyText();
if (!diaryText.includes('Творог 5%')) throw new Error('Запись не появилась в дневнике');
if (!/\d{2}:\d{2}/.test(diaryText)) throw new Error('Время добавления не отображается');
if (!diaryText.includes('26/150')) throw new Error('Белки в прогрессе не обновились (ожидалось 26/150)');
console.log('✓ Запись в «На ночь» с временем добавления, белки 26/150 в прогрессе');

// --- Редактирование записи: тап по строке → 200 г → пересчёт
findButton('Творог 5%').click();
await sleep(300);
if (!window.document.querySelector('input[type="time"]')) {
  throw new Error('В редакторе записи нет поля времени');
}
findButton('200 г').click();
await sleep(150);
findButton('Сохранить').click();
await sleep(400);
if (!bodyText().includes('240')) throw new Error('Запись не пересчиталась после редактирования (нет 240 ккал)');
if (!bodyText().includes('34/150')) throw new Error('Белки после редактирования не обновились (ожидалось 34/150)');
console.log('✓ Редактор записи: 200 г → 240 ккал, белки 34, время редактируемо');

// --- История: график и значения выбранного дня
findButton('История').click();
await sleep(400);
const histText = bodyText();
for (const t of ['Белки', 'Жиры', 'Углеводы', '240']) {
  if (!histText.includes(t)) throw new Error(`История: нет «${t}»`);
}
if (!window.document.querySelector('svg[role="img"]')) throw new Error('История: нет SVG-графика');
findByAria('Назад').click();
await sleep(300);
console.log('✓ История: график с легендой и значениями дня (240 ккал)');

// --- Сворачивание приёма
const entryCountBefore = (bodyText().match(/Творог 5%/g) || []).length;
findByAria('Свернуть «На ночь»').click();
await sleep(200);
if ((bodyText().match(/Творог 5%/g) || []).length >= entryCountBefore) {
  throw new Error('Приём не свернулся — запись всё ещё видна');
}
findByAria('Развернуть «На ночь»').click();
await sleep(200);
if ((bodyText().match(/Творог 5%/g) || []).length !== entryCountBefore) {
  throw new Error('Приём не развернулся обратно');
}
console.log('✓ Приём сворачивается и разворачивается');

// --- Частые: продукт появился с пометкой приёма
findButton('Добавить еду').click();
await sleep(400);
const freqText = bodyText();
if (!freqText.includes('Творог 5%')) throw new Error('Продукт не появился во вкладке «Частые»');
if (!freqText.includes('чаще: На ночь')) throw new Error('Нет пометки «чаще: На ночь» у частого продукта');
console.log('✓ «Частые»: продукт с пометкой «чаще: На ночь»');

// --- Вкладка «Свои» и звёздочка избранного
findButton('Свои').click();
await sleep(300);
const starBtn = [...window.document.querySelectorAll('button')].find(
  (b) => b.getAttribute('aria-label') === 'В избранное'
);
if (!starBtn) throw new Error('Звёздочка избранного не найдена во вкладке «Свои»');
starBtn.click();
await sleep(300);
findButton('Избранное').click();
await sleep(300);
if (!bodyText().includes('Творог 5%')) throw new Error('Продукт не появился в «Избранном»');
console.log('✓ Избранное: звёздочка добавляет продукт во вкладку «Избранное»');

// --- Пресеты граммов у избранного продукта
findButton('Творог 5%').click();
await sleep(400);
if (!bodyText().includes('Пресеты:')) throw new Error('Нет блока пресетов у избранного продукта');
findByAria('Добавить пресет').click(); // + 100 г (текущие граммы)
await sleep(300);
findByAria('Убрать пресет 100 г');
// персистентность: выйти и открыть заново
findByAria('Назад').click();
await sleep(300);
findButton('Творог 5%').click();
await sleep(400);
findByAria('Убрать пресет 100 г');
console.log('✓ Пресеты граммов: добавляются у избранного и сохраняются (100 г)');

// --- Выход и повторный вход: данные под аккаунтом
findByAria('Назад').click(); // карточка → поиск
await sleep(200);
findByAria('Назад').click(); // поиск → дневник
await sleep(300);
findButton('Выйти').click();
await sleep(400);
if (!bodyText().includes('Вход')) throw new Error('После выхода не показался экран входа');
setInput(inputByLabel('Почта'), 'test@test.ru');
setInput(inputByLabel('Пароль'), '123456');
findButton('Войти').click();
await sleep(1500);
if (!bodyText().includes('Творог 5%')) throw new Error('После входа данные аккаунта не подгрузились');
console.log('✓ Аккаунты: выход и вход, данные сохранились под аккаунтом');

console.log('✓ Смоук-тест пройден');
process.exit(0);
