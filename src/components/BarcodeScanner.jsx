import { useEffect, useRef, useState } from 'react';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { IconClose, Spinner } from './Icons.jsx';
import { useBackClose } from '../navigation.js';

// WASM отдаём из своего бандла, а не с CDN — сканер работает офлайн (PWA)
prepareZXingModule({
  overrides: {
    locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
  },
});

// tryRotate читает код под любым углом (в т. ч. вверх ногами), tryHarder +
// tryDownscale вытягивают мелкие и смазанные коды ценой времени на кадр
const ZXING_OPTS = {
  formats: ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E'],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
};

// EAN/UPC защищены контрольной цифрой, но на шумных кадрах tryHarder изредка
// «дочитывает» не тот код — принимаем только код, увиденный дважды
const HITS_TO_ACCEPT = 2;

function cameraErrorMessage(err) {
  if (!navigator.mediaDevices?.getUserMedia) {
    return 'Камера недоступна в этом браузере. Приложение должно быть открыто по HTTPS (или на localhost).';
  }
  const s = String(err?.name || err?.message || err || '');
  if (/NotAllowedError|Permission|denied/i.test(s)) {
    return 'Нет доступа к камере. Разрешите доступ к камере для этого сайта в настройках браузера и попробуйте снова.';
  }
  if (/NotFoundError|OverconstrainedError|no camera/i.test(s)) {
    return 'Камера не найдена на этом устройстве.';
  }
  if (/NotReadableError|in use/i.test(s)) {
    return 'Камера занята другим приложением. Закройте его и попробуйте снова.';
  }
  return 'Не удалось запустить камеру. Попробуйте ещё раз.';
}

async function makeNativeDetector() {
  if (!('BarcodeDetector' in window)) return null;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e'].filter((f) => supported.includes(f));
    return formats.length ? new window.BarcodeDetector({ formats }) : null;
  } catch {
    return null;
  }
}

export default function BarcodeScanner({ onScan, onClose }) {
  useBackClose(onClose);
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [digits, setDigits] = useState('');
  const [digitsError, setDigitsError] = useState(null);
  const videoRef = useRef(null);
  const trackRef = useRef(null);
  const handledRef = useRef(false);
  const onScanRef = useRef(onScan);

  function submitDigits(e) {
    e.preventDefault();
    const code = digits.trim();
    if (!/^\d{8,14}$/.test(code)) {
      setDigitsError('Штрихкод — от 8 до 14 цифр, без пробелов');
      return;
    }
    if (handledRef.current) return;
    handledRef.current = true;
    onScanRef.current(code);
  }

  async function toggleTorch() {
    const track = trackRef.current;
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn((v) => !v);
    } catch {
      /* фонарик не поддерживается этим треком */
    }
  }

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    let disposed = false;
    let stream = null;

    // Греем WASM, пока пользователь даёт доступ к камере
    prepareZXingModule({ fireImmediately: true }).catch(() => {});

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const zoomCanvas = document.createElement('canvas');
    const zoomCtx = zoomCanvas.getContext('2d', { willReadFrequently: true });
    const hits = new Map();
    let nativeDetector = null;
    let zoomPass = false;

    function report(raw) {
      const code = String(raw || '').replace(/\D/g, '');
      if (!code) return false;
      const n = (hits.get(code) || 0) + 1;
      hits.set(code, n);
      if (n < HITS_TO_ACCEPT || handledRef.current) return n >= HITS_TO_ACCEPT;
      handledRef.current = true;
      onScanRef.current(code);
      return true;
    }

    async function decodeFrame(video) {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return;

      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);

      // 1. Нативный детектор ОС (Android/Chrome): быстрый и сам крутит кадр
      if (nativeDetector) {
        try {
          const found = await nativeDetector.detect(canvas);
          if (found.length && report(found[0].rawValue)) return;
        } catch {
          nativeDetector = null;
        }
      }

      // 2. ZXing по полному кадру — любой поворот, наклон, инверсия
      const full = await readBarcodes(ctx.getImageData(0, 0, w, h), ZXING_OPTS);
      if (full.length && full[0].isValid && report(full[0].text)) return;

      // 3. Через кадр: «цифровой зум» — центральная половина кадра ×2,
      //    вытягивает коды, снятые издалека или совсем мелкие
      zoomPass = !zoomPass;
      if (zoomPass) {
        const cw = Math.floor(w / 2);
        const ch = Math.floor(h / 2);
        zoomCanvas.width = cw * 2;
        zoomCanvas.height = ch * 2;
        zoomCtx.drawImage(video, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, cw * 2, ch * 2);
        const zoomed = await readBarcodes(
          zoomCtx.getImageData(0, 0, cw * 2, ch * 2),
          ZXING_OPTS
        );
        if (zoomed.length && zoomed[0].isValid) report(zoomed[0].text);
      }
    }

    async function scanLoop() {
      const video = videoRef.current;
      while (!disposed && !handledRef.current) {
        if (video && video.readyState >= 2) {
          try {
            await decodeFrame(video);
          } catch {
            /* битый кадр — пропускаем */
          }
        }
        await new Promise((r) => setTimeout(r, 60));
      }
    }

    async function start() {
      nativeDetector = await makeNativeDetector();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          // Больше пикселей на штрих — дальше и мельче читается
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      if (disposed) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const track = stream.getVideoTracks()[0];
      trackRef.current = track;
      try {
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      } catch {
        /* автофокус недоступен — не критично */
      }
      try {
        setTorchSupported(Boolean(track.getCapabilities?.().torch));
      } catch {
        /* getCapabilities не везде есть */
      }
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play().catch(() => {});
      if (disposed) return;
      setStarting(false);
      scanLoop();
    }

    start().catch((err) => {
      if (!disposed) {
        setStarting(false);
        setError(cameraErrorMessage(err));
      }
    });

    return () => {
      disposed = true;
      trackRef.current = null;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] text-white">
        <h2 className="text-lg font-semibold">Сканер штрихкода</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть сканер"
          className="rounded-full bg-white/10 p-2 active:bg-white/20"
        >
          <IconClose />
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" />
        {!starting && !error && (
          <>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-[38%] w-[85%] rounded-2xl border-2 border-white/50" />
            </div>
            {torchSupported && (
              <button
                type="button"
                onClick={toggleTorch}
                className={`absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full px-5 py-2.5 font-semibold ${
                  torchOn ? 'bg-amber-400 text-stone-900' : 'bg-white/15 text-white'
                }`}
              >
                {torchOn ? 'Выключить фонарик' : 'Фонарик'}
              </button>
            )}
          </>
        )}
        {starting && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/80">
            <Spinner className="h-8 w-8" />
            <p>Запуск камеры…</p>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="w-full max-w-sm rounded-3xl bg-white p-5 text-center">
              <p className="font-medium text-stone-900">Камера не запустилась</p>
              <p className="mt-2 text-sm text-stone-600">{error}</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 w-full rounded-full bg-emerald-600 py-3 font-semibold text-white active:bg-emerald-700"
              >
                Закрыть
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4">
        {!error && (
          <p className="text-center text-sm text-white/70">
            Просто покажите штрихкод камере — под любым углом, хоть вверх ногами. Если код мелкий,
            поднесите чуть ближе или включите фонарик.
          </p>
        )}
        <form onSubmit={submitDigits} className="flex gap-2">
          <input
            value={digits}
            onChange={(e) => {
              setDigits(e.target.value);
              setDigitsError(null);
            }}
            inputMode="numeric"
            placeholder="Или введите цифры штрихкода"
            aria-label="Штрихкод цифрами"
            className="min-w-0 flex-1 rounded-full border border-white/25 bg-white/10 px-4 py-2.5 text-white outline-none placeholder:text-white/50 focus:border-emerald-400"
          />
          <button
            type="submit"
            className="shrink-0 rounded-full bg-emerald-600 px-5 py-2.5 font-semibold text-white active:bg-emerald-700"
          >
            Найти
          </button>
        </form>
        {digitsError && <p className="text-center text-sm text-red-300">{digitsError}</p>}
      </div>
    </div>
  );
}
