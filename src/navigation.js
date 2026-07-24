import { useEffect, useRef } from 'react';

// Нативная навигация «назад» для PWA.
//
// Каждый открытый экран/модал регистрируется через useBackClose(onClose):
// в историю браузера кладётся запись, и системный «назад» (кнопка/жест Android,
// кнопка браузера) закрывает верхний экран вместо выхода из приложения.
// Закрытие кнопкой в UI тоже идёт через историю — стек всегда консистентен.

const handlers = [];
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
    window.history.pushState({ appDepth: handlers.length }, '');
    return () => {
      const i = handlers.indexOf(ref);
      if (i !== -1) {
        // Экран закрыли из UI — снимаем регистрацию и съедаем запись истории.
        // popstate придёт уже с совпадающей глубиной и ничего не тронет.
        handlers.splice(i, 1);
        window.history.back();
      }
    };
    // регистрация — один раз на время жизни экрана
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
