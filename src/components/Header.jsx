import { IconChevronLeft } from './Icons.jsx';

export default function Header({ title, onBack }) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-1 bg-stone-100/90 px-2 py-2 backdrop-blur">
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
