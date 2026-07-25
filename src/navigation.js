import { useEffect, useRef } from 'react';

// Нативная навигация «назад» для PWA.
//
// Каждый открытый экран/модал регистрируется через useBackClose(onClose):
// в историю браузера кладётся запись, и системный «назад» (кнопка/жест Android,
// кнопка браузера) закрывает верхний экран вместо выхода из приложения.
// Закрытие кнопкой в UI тоже идёт через историю — стек всегда консистентен.

const handlers = [];
// Экраны, закрытые из UI, чей history.back() отложен до микротаска. Если в том же
// коммите React монтируется экран-замена (карточка → форма редактирования), он
// переиспользует запись истории закрывшегося — иначе back() и pushState наперегонки
// ломают стек, и новый экран мгновенно закрывается пришедшим popstate.
let pendingPop = 0;
let flushQueued = false;
let initialized = false;

function ensureInit() {
  if (initialized) return;
  initialized = true;
  // Стек истории здесь — про открытые экраны, а не про позиции прокрутки:
  // авто-восстановление скролла браузером на popstate прыгает по странице
  // (экран открывается «в середине», хедер за краем) — выключаем
  if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  // После перезагрузки страницы (например, обновления service worker) текущая
  // запись истории может нести глубину прошлой сессии, а приложение стартует
  // без открытых экранов — выравниваем, иначе весь счёт глубины съезжает
  window.history.replaceState({ appDepth: 0 }, '');
  window.addEventListener('popstate', (e) => {
    const depth = e.state?.appDepth ?? 0;
    if (depth > handlers.length) {
      // Запись глубже, чем открыто экранов: системный жест «вперёд» (iOS 18.4+)
      // вернул уже закрытый экран, которого нет. Откатываемся к записи,
      // соответствующей реальной глубине, — придёт popstate и совпадёт
      window.history.go(handlers.length - depth);
      return;
    }
    while (handlers.length > depth) {
      const h = handlers.pop();
      h.current();
    }
  });
}

export function useBackClose(onClose) {
  const ref = useRef(onClose);
  useEffect(() => {
    ref.current = onClose;
  });

  useEffect(() => {
    ensureInit();
    handlers.push(ref);
    if (pendingPop > 0) {
      // Замена экрана в одном коммите: запись истории предыдущего ещё на месте,
      // глубина совпадает — просто занимаем её вместо новой pushState
      pendingPop -= 1;
    } else {
      window.history.pushState({ appDepth: handlers.length }, '');
    }
    return () => {
      const i = handlers.indexOf(ref);
      if (i !== -1) {
        // Экран закрыли из UI — снимаем регистрацию, а запись истории съедаем
        // отложенно: эффект монтирования экрана-замены успеет её переиспользовать.
        // Если замены не было, откат уйдёт, и popstate придёт с совпадающей
        // глубиной, ничего не тронув.
        handlers.splice(i, 1);
        pendingPop += 1;
        if (!flushQueued) {
          flushQueued = true;
          queueMicrotask(() => {
            flushQueued = false;
            if (pendingPop > 0) {
              // Все накопившиеся записи — одним go(-n): серия отдельных back()
              // в iOS может потерять часть навигаций, оставляя в истории «хвост»,
              // из-за которого жест «назад» срабатывает даже на корневом экране
              const n = pendingPop;
              pendingPop = 0;
              window.history.go(-n);
            }
          });
        }
      }
    };
    // регистрация — один раз на время жизни экрана
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// Экран с главной кнопкой действия внизу при открытии докручивается так, чтобы
// кнопка была у нижнего края экрана, а не пряталась за ним. ref вешается на
// нижний блок с кнопками; если контент помещается целиком — прокрутки не будет.
// Не использовать на экранах с автофокусом поля: скролл будет драться с клавиатурой.
export function useScrollToAction() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const raf = requestAnimationFrame(() => {
      // Ближайший скроллящийся предок: оверлеи (fixed + overflow-y-auto) крутятся
      // сами, обычные экраны — окном
      let scroller = null;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const { overflowY } = getComputedStyle(p);
        if (overflowY === 'auto' || overflowY === 'scroll') {
          scroller = p;
          break;
        }
      }
      const pad = 12; // небольшой отступ под кнопкой
      const bottom = el.getBoundingClientRect().bottom + pad;
      if (scroller) {
        scroller.scrollTop = Math.max(
          0,
          scroller.scrollTop + bottom - scroller.getBoundingClientRect().bottom
        );
      } else {
        // Абсолютная позиция ещё и сбрасывает «хвост» прокрутки предыдущего вида
        // (например, длинного списка поиска, из которого открыли карточку)
        window.scrollTo(0, Math.max(0, window.scrollY + bottom - window.innerHeight));
      }
    });
    return () => cancelAnimationFrame(raf);
  }, []);
  return ref;
}

// Своего жеста «свайп от края → назад» больше нет: с iOS 18.4 системный жест
// назад/вперёд есть и в PWA с домашнего экрана (отключить его нельзя, а touch-
// события при этом продолжают приходить странице) — собственный обработчик
// дублировал системный, и один свайп откатывал историю на два уровня.
