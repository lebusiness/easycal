import { IconChevronLeft } from './Icons.jsx';

export default function Header({ title, onBack }) {
  // Без backdrop-blur: в iOS Safari sticky + backdrop-filter иногда не отрисовывается
  return (
    <header className="sticky top-0 z-10 flex items-center gap-1 bg-stone-100 px-2 py-2">
      <button
        type="button"
        onClick={onBack}
        aria-label="Назад"
        className="rounded-full p-2 text-stone-600 active:bg-stone-200"
      >
        <IconChevronLeft />
      </button>
      <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h1>
    </header>
  );
}
