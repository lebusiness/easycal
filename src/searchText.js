// Общий текстовый движок поиска для справочника, своих продуктов и Open Food Facts:
// нормализация (ё→е, й→и, диакритика), токенизация, транслит с фонетическим каноном
// (Prostokvashino/Prostokvaschino → одна форма), исправление раскладки (vjkjrj → молоко)
// и опечаток (ограниченный Дамерау-Левенштейн: замена/пропуск/вставка/перестановка).

// Нижний регистр, ё→е; NFD-разложение убирает диакритику: й→и, café→cafe
export function normText(s) {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// «,» и «%» остаются внутри токена ради «2,5%» в названиях молочки
export function tokenize(s) {
  return normText(s)
    .split(/[^a-zа-я0-9,%]+/)
    .filter(Boolean);
}

// Слова, которые пишут в запросе, но их нет в названиях («творог 5 процентов жирности»)
const NOISE = new Set([
  'процент', 'процента', 'процентов', 'проц',
  'жирность', 'жирности', 'жирностью',
  'гр', 'грамм', 'грамма', 'граммов', 'шт', 'мл',
]);

// Токены запроса: без шума и одиночных букв (частицы «с», «и» и обрубок «г» от «100 г»)
export function queryTokens(s) {
  return tokenize(s).filter((t) => !NOISE.has(t) && (/\d/.test(t) || t.length >= 2));
}

const RU_TO_LAT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y',
  ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function translit(s) {
  return s.replace(/[а-яё]/g, (ch) => RU_TO_LAT[ch] ?? ch);
}

// Канон латиницы: сводит разные традиции транслита к одной форме, чтобы кириллический
// запрос находил бренды, записанные латиницей как угодно (sch/sh, kh/h, ts/c, y/j/i…).
// Правила применяются к обеим сторонам сравнения, поэтому «слияния» букв безопасны.
const CANON_STEPS = [
  [/ph/g, 'f'],
  [/ck/g, 'k'],
  [/shch|sch/g, 'sh'],
  [/kh/g, 'h'],
  [/zh/g, 'j'],
  [/ts|tz/g, 'c'],
  [/x/g, 'h'],
  [/w/g, 'v'],
  [/yo|jo/g, 'e'],
  [/yu|ju/g, 'u'],
  [/ya|ja/g, 'a'],
  [/ye|je/g, 'e'],
  [/c(?=[ei])/g, 's'],
  [/c/g, 'k'],
  [/[jy]/g, 'i'],
  [/([a-z])\1+/g, '$1'], // latte → late, anna → ana (числа не трогаем)
];

export function canonLat(s) {
  if (!/[a-z]/.test(s)) return s;
  let out = s;
  for (const [re, to] of CANON_STEPS) out = out.replace(re, to);
  return out;
}

// Раскладки QWERTY ↔ ЙЦУКЕН: «vjkjrj» → «молоко», «ыташлукы» → «snickers»
const EN_TO_RU = {
  q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ', p: 'з',
  '[': 'х', ']': 'ъ', a: 'ф', s: 'ы', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о',
  k: 'л', l: 'д', ';': 'ж', "'": 'э', z: 'я', x: 'ч', c: 'с', v: 'м', b: 'и',
  n: 'т', m: 'ь', ',': 'б', '.': 'ю', '`': 'ё',
};
const RU_TO_EN = {};
for (const [en, ru] of Object.entries(EN_TO_RU)) RU_TO_EN[ru] = en;

// Строка, набранная не в той раскладке, либо null, если преобразование не имеет смысла
// (смешанные алфавиты, непереводимые символы, результат совпадает с исходным)
export function switchLayout(s) {
  const low = s.toLowerCase();
  const ruLetters = (low.match(/[а-яё]/g) || []).length;
  const enLetters = (low.match(/[a-z]/g) || []).length;
  let map;
  if (enLetters >= 2 && ruLetters === 0) map = EN_TO_RU;
  else if (ruLetters >= 2 && enLetters === 0) map = RU_TO_EN;
  else return null;
  let out = '';
  for (const ch of low) {
    if (map[ch] !== undefined) out += map[ch];
    else if (/[0-9\s%()\-–—/]/.test(ch)) out += ch;
    else return null;
  }
  out = out.trim();
  return out && out !== low.trim() ? out : null;
}

// Ограниченное редакционное расстояние (OSA): замена, вставка, удаление, перестановка
// соседних букв. Возвращает max+1, как только дистанция гарантированно превышает max.
export function damerau(a, b, max) {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (!la) return lb;
  if (!lb) return la;
  let prev2 = null;
  let prev = [];
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[lb] <= max ? prev[lb] : max + 1;
}

// Допустимое число опечаток: короткие слова не трогаем, иначе «рис» превратится в «лис»
export function maxTypos(len) {
  return len >= 8 ? 2 : len >= 4 ? 1 : 0;
}

function commonPrefixLen(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

// Класс алфавита по первой букве — не сравниваем кириллицу с латиницей напрямую
// (для этого есть канонические формы), экономим вызовы damerau
function alphaClass(s) {
  const c = s.charCodeAt(0);
  if (c >= 0x430 && c <= 0x44f) return 1;
  if (c >= 97 && c <= 122) return 2;
  return 0;
}

// Сила совпадения токена запроса со словом продукта:
// 3 — точное; 2 — запрос — начало слова («капуч» → «капучино»); 1.3/1 — опечатка
// (1-2 правки); 1 — слово — начало запроса («рисовая» ↔ «рис»); 0.9 — опечатка в
// недописанном слове («молак» → «молоко»); 0.5 — общий префикс ≥ 4 (морфология:
// «варёная» ↔ «вареные»). Иерархия нужна, чтобы «капучино» не проигрывал «капусте».
export function tokenScore(t, w) {
  if (t === w) return 3;
  const ca = alphaClass(t);
  const cb = alphaClass(w);
  if (ca && cb && ca !== cb) return 0;
  let best = 0;
  if (w.startsWith(t) && (t.length >= 2 || /\d/.test(t))) best = 2;
  else if (t.startsWith(w) && w.length >= 3) best = 1;
  if (best < 1.3) {
    const cap = maxTypos(t.length);
    if (cap > 0) {
      if (Math.abs(t.length - w.length) <= cap) {
        const d = damerau(t, w, cap);
        if (d <= cap) best = Math.max(best, d === 1 ? 1.3 : 1);
      }
      if (best < 0.9 && t.length >= 5 && w.length > t.length) {
        if (damerau(t, w.slice(0, t.length), cap) <= cap) best = Math.max(best, 0.9);
      }
    }
  }
  if (best < 0.5 && commonPrefixLen(t, w) >= 4) best = 0.5;
  return best;
}

// Варианты токена запроса: как есть, в исправленной раскладке, канонический транслит
export function tokenVariants(t) {
  const vs = new Set([t]);
  const sw = switchLayout(t);
  if (sw) vs.add(normText(sw));
  for (const v of [...vs]) {
    const c = canonLat(translit(v));
    if (c && c !== v) vs.add(c);
  }
  return [...vs];
}

// Формы слова продукта: как есть + канонический транслит (для кириллицы и «сырой» латиницы)
export function wordForms(w) {
  const c = canonLat(translit(w));
  return c && c !== w ? [w, c] : [w];
}

// Все словоформы текста (название + бренд/описание) одним плоским списком
export function textForms(text) {
  return [...new Set(tokenize(text).flatMap(wordForms))];
}

export function bestScore(variants, forms) {
  let best = 0;
  for (const v of variants) {
    for (const f of forms) {
      const s = tokenScore(v, f);
      if (s > best) {
        best = s;
        if (best >= 3) return best;
      }
    }
  }
  return best;
}

// Разобранный запрос: токены, их варианты, «мягкость» (числа не обязаны совпадать —
// «100 творога» не должно отсекать творог) и склейка для запросов вида «кока кола»
export function buildQueryPlan(query) {
  const tokens = queryTokens(query);
  if (!tokens.length) return null;
  return {
    tokens,
    soft: tokens.map((t) => /^\d/.test(t)),
    variants: tokens.map(tokenVariants),
    joined: tokens.length >= 2 ? tokenVariants(tokens.join('')) : null,
    qNorm: normText(query).trim(),
  };
}

// Суммарный балл продукта по плану запроса. Каждое «твёрдое» (нечисловое) слово запроса
// обязано найти себе слово продукта, иначе 0; запасной путь — совпадение склейки токенов.
export function scorePlan(plan, forms) {
  let sum = 0;
  let ok = true;
  for (let k = 0; k < plan.tokens.length; k++) {
    const s = bestScore(plan.variants[k], forms);
    if (s === 0 && !plan.soft[k]) ok = false;
    sum += s;
  }
  if (ok && sum > 0) return sum;
  if (plan.joined) {
    const js = bestScore(plan.joined, forms);
    if (js >= 1.3) return js;
  }
  return 0;
}

// Корректор опечаток по словарю {слово → частота}: «малоко» → «молоко».
// known() — слово словарное или недописанное словарное (тогда исправлять нечего).
export function createCorrector(freqMap) {
  const entries = [...freqMap.entries()];

  function known(t) {
    if (t.length < 3) return true; // слишком короткое, чтобы судить
    if (freqMap.has(t)) return true;
    return entries.some(([w]) => w.startsWith(t));
  }

  function correct(t) {
    if (t.length < 4 || /\d/.test(t) || known(t)) return null;
    const cap = maxTypos(t.length);
    let best = null;
    let bd = cap + 1;
    let bFirst = 2;
    let bFreq = -1;
    for (const [w, freq] of entries) {
      if (Math.abs(w.length - t.length) > cap) continue;
      if (alphaClass(w) !== alphaClass(t)) continue;
      const d = damerau(t, w, cap);
      if (d > cap) continue;
      const first = w[0] === t[0] ? 0 : 1; // опечатка в первой букве встречается реже
      if (d < bd || (d === bd && (first < bFirst || (first === bFirst && freq > bFreq)))) {
        best = w;
        bd = d;
        bFirst = first;
        bFreq = freq;
      }
    }
    return best;
  }

  return { known, correct };
}
