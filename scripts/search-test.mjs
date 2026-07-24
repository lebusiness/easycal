// Юнит-тесты поискового движка: нормализация, транслит-канон, раскладка, опечатки,
// поиск по справочнику и ранжирование OFF-результатов. Без сервера и DOM: node scripts/search-test.mjs
import {
  canonLat,
  damerau,
  normText,
  queryTokens,
  switchLayout,
  translit,
} from '../src/searchText.js';
import { searchBasicFoods, correctSearchQuery } from '../src/basicFoods.js';
import { rankProducts } from '../src/api.js';

let failed = 0;

function eq(actual, expected, label) {
  const ok = actual === expected;
  if (!ok) {
    failed++;
    console.error(`✗ ${label}\n  ожидалось: ${JSON.stringify(expected)}\n  получено:  ${JSON.stringify(actual)}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

function firstName(query) {
  return searchBasicFoods(query)[0]?.name ?? null;
}

// --- Нормализация и токены
eq(normText('СВЁКЛА'), 'свекла', 'normText: ё → е');
eq(normText('Йогурт'), 'иогурт', 'normText: й → и (NFD)');
eq(queryTokens('творог 5 процентов жирности').join(' '), 'творог 5', 'queryTokens: шумовые слова и «проценты» отброшены');
eq(queryTokens('100 г творога').join(' '), '100 творога', 'queryTokens: одиночная «г» отброшена, число осталось');

// --- Раскладка
eq(switchLayout('uhtxrf'), 'гречка', 'switchLayout: EN → RU (uhtxrf → гречка)');
eq(switchLayout('ытшслукы'), 'snickers', 'switchLayout: RU → EN (ытшслукы → snickers)');
eq(switchLayout('молоко'), 'vjkjrj', 'switchLayout: RU → EN (обратное направление работает)');
eq(switchLayout('моloко'), null, 'switchLayout: смешанные алфавиты → null');

// --- Опечатки (Дамерау-Левенштейн)
eq(damerau('гречак', 'гречка', 2), 1, 'damerau: перестановка соседних букв = 1');
eq(damerau('малоко', 'молоко', 1), 1, 'damerau: замена буквы = 1');
eq(damerau('сок', 'суп', 1), 2, 'damerau: превышение лимита → max+1');

// --- Канон транслита
eq(canonLat('prostokvaschino'), canonLat('prostokvashino'), 'canonLat: sch и sh сводятся к одной форме');
eq(canonLat(translit(normText('филадельфия'))), canonLat('philadelphia'), 'canonLat: транслит RU = западное написание');
eq(canonLat(translit(normText('хлеб'))), canonLat('xleb'), 'canonLat: kh/x → h');

// --- Поиск по справочнику
eq(firstName('гречка'), 'Гречка варёная', 'справочник: точное слово');
eq(firstName('гркчка'), 'Гречка варёная', 'справочник: опечатка (гркчка)');
eq(firstName('малоко'), 'Молоко 2,5%', 'справочник: опечатка (малоко)');
eq(firstName('мароженое'), 'Мороженое пломбир', 'справочник: опечатка (мароженое)');
eq(firstName('uhtxrf'), 'Гречка варёная', 'справочник: не та раскладка (uhtxrf)');
eq(firstName('grechka'), 'Гречка варёная', 'справочник: латиница (grechka)');
eq(firstName('борш'), 'Борщ зелёный (щавелевый)', 'справочник: борш → борщ');
eq(firstName('творог 5'), 'Творог 5%', 'справочник: «творог 5» → Творог 5% первым');
eq(firstName('капуч'), 'Капучино', 'справочник: префикс «капуч» — капучино, не капуста');
eq(firstName('кока кола'), 'Кола', 'справочник: «кока кола» по алиасу');
eq(firstName('кускус'), 'Кус-кус готовый', 'справочник: склейка «кускус» находит «Кус-кус»');
eq(firstName('свекла'), 'Свёкла варёная', 'справочник: е находит ё');
eq(firstName('йогурт'), 'Йогурт натуральный 3,2%', 'справочник: й-слова ищутся');

// --- Корректор запроса (подсказка + расширение OFF-запроса)
eq(correctSearchQuery('малоко'), 'молоко', 'корректор: малоко → молоко');
eq(correctSearchQuery('vjkjrj'), 'молоко', 'корректор: раскладка vjkjrj → молоко');
eq(correctSearchQuery('малоко гречка'), 'молоко гречка', 'корректор: исправляется только слово с опечаткой');
eq(correctSearchQuery('гречка'), null, 'корректор: правильное слово не трогаем');
eq(correctSearchQuery('греч'), null, 'корректор: недописанное слово не трогаем');

// --- Ранжирование OFF-результатов
const offProducts = [
  { name: 'Кефир 3,2%', brand: 'Простоквашино', kcal100: 57 },
  { name: 'Молоко отборное', brand: 'Простоквашино', kcal100: 60 },
  { name: 'Творог 2%', brand: 'Prostokvashino', kcal100: 103 },
  { name: 'Творог мягкий 5%', brand: 'Домик в деревне', kcal100: 112 },
];
eq(
  rankProducts(offProducts, 'творог простоквашино')[0].name,
  'Творог 2%',
  'OFF-ранжирование: бренд латиницей находится кириллическим запросом'
);
eq(
  rankProducts(offProducts, 'тварог простаквашино')[0].name,
  'Творог 2%',
  'OFF-ранжирование: две опечатки в запросе не ломают порядок'
);
eq(
  rankProducts(offProducts, 'молоко')[0].name,
  'Молоко отборное',
  'OFF-ранжирование: слово названия сильнее слова бренда'
);

if (failed) {
  console.error(`\n${failed} тест(ов) провалено`);
  process.exit(1);
}
console.log('\nВсе тесты поиска пройдены');
