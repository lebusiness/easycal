import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { IconClose, Spinner } from './Icons.jsx';

const REGION_ID = 'barcode-scanner-region';

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

async function safeStop(scanner) {
  try {
    if (scanner.isScanning) await scanner.stop();
  } catch {
    /* уже остановлен */
  }
  try {
    scanner.clear();
  } catch {
    /* контейнер уже размонтирован */
  }
}

export default function BarcodeScanner({ onScan, onClose }) {
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState(null);
  const [digits, setDigits] = useState('');
  const [digitsError, setDigitsError] = useState(null);
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

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    let disposed = false;
    const scanner = new Html5Qrcode(REGION_ID, {
      formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8],
      verbose: false,
    });

    const startPromise = scanner
      .start(
        { facingMode: 'environment' },
        {
          fps: 15,
          // Нативный BarcodeDetector браузера намного лучше читает смазанные
          // 1D-коды (вебкамеры ноутбуков не фокусируются вблизи)
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          // HD-поток: больше пикселей на полосу штрихкода
          videoConstraints: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          qrbox: (vw, vh) => ({
            width: Math.max(50, Math.floor(Math.min(vw * 0.9, 500))),
            height: Math.max(50, Math.floor(Math.min(vh * 0.4, 220))),
          }),
        },
        (text) => {
          if (handledRef.current) return;
          handledRef.current = true;
          onScanRef.current(text);
        },
        () => {
          /* кадр без распознанного кода — норма */
        }
      )
      .then(() => {
        if (!disposed) setStarting(false);
      })
      .catch((err) => {
        if (!disposed) {
          setStarting(false);
          setError(cameraErrorMessage(err));
        }
      });

    return () => {
      disposed = true;
      startPromise.finally(() => safeStop(scanner));
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
        <div id={REGION_ID} />
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
            Наведите камеру на штрихкод (EAN-13 или EAN-8). С вебкамеры ноутбука держите код в
            15–25 см от объектива — вблизи она не фокусируется.
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
