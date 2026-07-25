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
let initialized = false;

function ensureInit() {
  if (initialized) return;
  initialized = true;
  window.addEventListener('popstate', (e) => {
    const depth = e.state?.appDepth ?? 0;
    while (handlers.length > depth) {
      const h = handlers.pop();
      h.current();
    }
  });
}

export function canGoBack() {
  return handlers.length > 0;
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
        // Если замены не было, back() уйдёт, и popstate придёт с совпадающей
        // глубиной, ничего не тронув.
        handlers.splice(i, 1);
        pendingPop += 1;
        queueMicrotask(() => {
          if (pendingPop > 0) {
            pendingPop -= 1;
            window.history.back();
          }
        });
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

// Свайп от левого края → «назад» (важно для iOS-PWA, где нет системного жеста)
export function useEdgeSwipeBack() {
  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let tracking = false;

    const onStart = (e) => {
      const t = e.touches[0];
      if (t && t.clientX <= 28 && canGoBack()) {
        tracking = true;
        startX = t.clientX;
        startY = t.clientY;
      }
    };
    const onMove = (e) => {
      if (!tracking) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      if (dx > 70 && dy < dx * 0.6) {
        tracking = false;
        window.history.back();
      } else if (dy > 40 && dy > dx) {
        tracking = false; // это вертикальный скролл
      }
    };
    const onEnd = () => {
      tracking = false;
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, []);
}
