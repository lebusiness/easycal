import { useBackClose } from '../navigation.js';

// Полноэкранный просмотр фото порции. Тап по фону закрывает;
// опционально — кнопки замены и удаления фото.
export default function PhotoViewer({ src, onClose, onPickFile, onRemove }) {
  useBackClose(onClose);
  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/95"
      onClick={(e) => {
        // не даём клику всплыть до подложек модалок под просмотрщиком
        e.stopPropagation();
        onClose();
      }}
    >
      <img src={src} alt="Фото порции" className="min-h-0 w-full flex-1 object-contain" />
      <div
        className="flex gap-2 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3"
        onClick={(e) => e.stopPropagation()}
      >
        {onPickFile && (
          <label className="flex-1 cursor-pointer rounded-full bg-white/15 py-2.5 text-center text-sm font-semibold text-white active:bg-white/25">
            Заменить
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) {
                  onPickFile(f);
                  onClose();
                }
              }}
            />
          </label>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={() => {
              onRemove();
              onClose();
            }}
            className="flex-1 rounded-full bg-white/15 py-2.5 text-sm font-semibold text-red-300 active:bg-white/25"
          >
            Убрать фото
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-full bg-white/15 py-2.5 text-sm font-semibold text-white active:bg-white/25"
        >
          Закрыть
        </button>
      </div>
    </div>
  );
}
