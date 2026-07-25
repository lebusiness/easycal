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

// Клик по значению в барабане (рулетке) — выставляет значение без клавиатуры
function clickWheelValue(ariaLabel, value) {
  const wheel = window.document.querySelector(`[aria-label="${ariaLabel}"]`);
  if (!wheel) throw new Error(`Барабан «${ariaLabel}» не найден`);
  const btn = [...wheel.querySelectorAll('button')].find((b) => b.textContent.trim() === String(value));
  if (!btn) throw new Error(`В барабане «${ariaLabel}» нет значения ${value}`);
  btn.click();
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
if (!bodyText().includes('Итого')) throw new Error('После регистрации дневник не открылся');
console.log('✓ Регистрация: почта+пароль без писем, дневник открылся');

// --- Дневник: дефолтные приёмы
for (const text of ['Сегодня', 'Итого', 'Завтрак', 'Обед', 'Ужин', 'На ночь', 'Цели']) {
  if (!bodyText().includes(text)) throw new Error(`На экране дневника нет текста: «${text}»`);
}
console.log('✓ Дневник: приёмы по умолчанию (Завтрак/Обед/Ужин/На ночь) и кнопка целей');

// --- Цели БЖУ
findButton('Цели').click();
await sleep(200);
setInput(inputByLabel('Белки'), '150');
setInput(inputByLabel('Жиры'), '70');
setInput(inputByLabel('Углеводы'), '250');
await sleep(100);
// 150*4 + 70*9 + 250*4 = 600+630+1000 = 2230
if (!bodyText().includes('2 230')) throw new Error('Авто-ккал цели не посчитались (нет 2 230)');

// Цели приёма «На ночь»: поля подписаны aria-label
const mealGoalInput = (label) => {
  const el = window.document.querySelector(`input[aria-label="${label}"]`);
  if (!el) throw new Error(`Поле цели приёма «${label}» не найдено`);
  return el;
};
setInput(mealGoalInput('Белки «На ночь»'), '30');
setInput(mealGoalInput('Жиры «На ночь»'), '10');
setInput(mealGoalInput('Углеводы «На ночь»'), '20');
await sleep(100);
// 30*4 + 10*9 + 20*4 = 120+90+80 = 290 — и в строке приёма, и в сумме
if (!bodyText().includes('290')) throw new Error('Авто-ккал цели приёма не посчитались (нет 290)');
if (!bodyText().includes('Сумма по приёмам')) throw new Error('Сумма целей по приёмам не показалась');
findButton('Сохранить').click();
await sleep(300);
if (!bodyText().includes('/150') || !bodyText().includes('/ 2 230')) {
  throw new Error('Прогресс-бары целей не отобразились');
}
if (!bodyText().includes('0/290')) throw new Error('Прогресс цели приёма «На ночь» не показался (нет 0/290)');
console.log('✓ Цели: авто-ккал (2 230), цели приёма «На ночь» (290 ккал) и прогресс-бары');

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
findButton('+ Продукт').click();
await sleep(200);
setInput(inputByLabel('Название'), 'Творог 5%');
// Описание и штрихкод спрятаны за кнопками «+ …» — раскрываем по очереди
findButton('+ Описание').click();
await sleep(100);
setInput(inputByLabel('Описание'), 'тестовое описание');
clickWheelValue('Белки на 100 г', 17);
clickWheelValue('Жиры на 100 г', 4);
clickWheelValue('Углеводы на 100 г', 4);
findButton('+ Штрихкод').click();
await sleep(100);
setInput(inputByLabel('Штрихкод'), '4600000000001');
await sleep(100);
// 17*4 + 4*9 + 4*4 = 68+36+16 = 120 (плитка «Ккал» обновляется сама)
if (!bodyText().includes('120')) throw new Error('Авто-ккал продукта не посчитались (нет 120)');
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
// Белки хранятся с десятыми: 17 г × 150 г / 100 = 25,5
if (!diaryText.includes('25,5/150')) throw new Error('Белки в прогрессе не обновились (ожидалось 25,5/150)');
if (!diaryText.includes('180/290')) throw new Error('Ккал в прогрессе приёма не обновились (ожидалось 180/290)');
if (!diaryText.includes('25,5/30')) throw new Error('Белки в прогрессе приёма не обновились (ожидалось 25,5/30)');
console.log('✓ Запись в «На ночь»: белки 25,5/150 в дне и 25,5/30 в приёме, ккал 180/290');

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
if (!bodyText().includes('34/30')) throw new Error('Перебор белка в приёме не показался (ожидалось 34/30)');
console.log('✓ Редактор записи: 200 г → 240 ккал, белки 34 (в приёме перебор 34/30), время редактируемо');

// --- Прогресс приёмов скрывается тапом по полоске и возвращается тапом по цифрам
findByAria('Скрыть прогресс приёмов').click();
await sleep(150);
if (bodyText().includes('34/30')) throw new Error('Прогресс приёма не скрылся');
if (!bodyText().includes('240/290')) throw new Error('Компактные ккал/цель в шапке приёма не показались');
findByAria('Показать прогресс приёмов').click();
await sleep(150);
if (!bodyText().includes('34/30')) throw new Error('Прогресс приёма не вернулся');
console.log('✓ Прогресс приёмов прячется тапом (остаются цифры в шапке) и возвращается');

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
findButton('+ Добавить').click();
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

// --- Пресеты порций своего продукта: добавляются через «Редактировать»
findButton('Творог 5%').click();
await sleep(400);
if (bodyText().includes('Пресеты:')) {
  throw new Error('У своего продукта в карточке не должно быть блока «Пресеты:»');
}
findButton('Редактировать').click();
await sleep(300);
findButton('+ Добавить порцию').click();
await sleep(150);
const portionLabel = [...window.document.querySelectorAll('input')].find(
  (i) => i.placeholder === 'Название: большой…'
);
const portionGrams = [...window.document.querySelectorAll('input')].find(
  (i) => i.placeholder === 'вес, г'
);
if (!portionLabel || !portionGrams) throw new Error('Строка порции в редакторе не появилась');
setInput(portionLabel, 'тест');
setInput(portionGrams, '100');
findButton('Сохранить изменения').click();
await sleep(400);
if (!bodyText().includes('тест · 100 г')) {
  throw new Error('Пресет с подписью не показался в выборе порции');
}
// персистентность: выйти и открыть заново
findByAria('Назад').click();
await sleep(300);
findButton('Творог 5%').click();
await sleep(400);
if (!bodyText().includes('тест · 100 г')) throw new Error('Пресет не сохранился');
console.log('✓ Пресеты порций: добавляются в редакторе продукта и сохраняются (тест · 100 г)');

// --- Составной продукт: сборка из своего продукта и справочника
findByAria('Назад').click(); // карточка → поиск
await sleep(300);
findButton('Свои').click();
await sleep(300);
findButton('+ Составной').click();
await sleep(200);
setInput(inputByLabel('Название'), 'Творог с бананом');

// Ингредиент 1: свой продукт из вкладок пикера (частые)
findButton('+ Добавить ингредиент').click();
await sleep(400);
if (!bodyText().includes('Добавить ингредиент')) throw new Error('Пикер ингредиентов не открылся');
findButton('Творог 5%').click();
await sleep(400);
if (!bodyText().includes('Добавить в состав')) throw new Error('Шторка веса ингредиента не открылась');
findButton('Добавить в состав').click(); // 100 г по умолчанию
await sleep(300);
if (!bodyText().includes('Итого 100 г')) throw new Error('Ингредиент «Творог 5%» не попал в состав');

// Ингредиент 2: справочник через поиск, вес 150 г чипом
findButton('+ Добавить ингредиент').click();
await sleep(300);
const pickerSearch = [...window.document.querySelectorAll('input')].find(
  (i) => i.placeholder === 'Поиск по всем продуктам'
);
if (!pickerSearch) throw new Error('Поиск в пикере ингредиентов не найден');
setInput(pickerSearch, 'банан');
await sleep(400);
findButton('Банан').click();
await sleep(400);
findButton('150 г').click();
await sleep(150);
findButton('Добавить в состав').click();
await sleep(300);
// 120 (творог 100 г) + 96*1.5=144 (банан 150 г) = 264 ккал, 250 г
if (!bodyText().includes('Итого 250 г')) throw new Error('Итоговый вес состава не 250 г');
if (!bodyText().includes('264')) throw new Error('Итоговые ккал состава не 264');
findButton('Сохранить продукт').click();
await sleep(500);
const compText = bodyText();
if (!compText.includes('Творог с бананом')) throw new Error('Карточка составного продукта не открылась');
if (!compText.includes('вся порция · 250 г')) throw new Error('Нет пресета «вся порция · 250 г»');
if (!compText.includes('Порция: 250 г')) throw new Error('Порция по умолчанию не равна всему блюду');
if (!compText.includes('264')) throw new Error('Ккал всей порции не 264');
console.log('✓ Составной продукт: творог 100 г + банан 150 г = 264 ккал, порция «вся порция · 250 г»');

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
if (!bodyText().includes('240/290')) throw new Error('Цели приёма не пришли с сервера (нет 240/290)');
console.log('✓ Аккаунты: выход и вход, данные и цели приёмов сохранились под аккаунтом');

// --- Составной продукт пережил сервер: состав и пресеты пришли из снимка Postgres
findButton('+ Добавить').click();
await sleep(400);
findButton('Свои').click();
await sleep(300);
if (!bodyText().includes('Творог с бананом')) throw new Error('Составной продукт не пришёл с сервера');
findButton('Творог с бананом').click();
await sleep(400);
if (!bodyText().includes('Порция: 250 г') || !bodyText().includes('вся порция · 250 г')) {
  throw new Error('Состав/пресеты составного продукта не пережили сервер');
}
console.log('✓ Составной продукт: состав и пресет «вся порция» пришли из Postgres после перевхода');

console.log('✓ Смоук-тест пройден');
process.exit(0);
