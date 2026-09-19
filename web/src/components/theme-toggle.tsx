import { setTheme } from '@/app/theme-action';
import { MoonIcon, SunIcon } from '@/components/icons';
import type { Theme } from '@/lib/theme';

// No client JavaScript: the choice is a cookie, and the server renders the class on <html> next time round.
export function ThemeToggle({ theme }: { theme: Theme }) {
  const next: Theme = theme === 'dark' ? 'light' : 'dark';

  return (
    <form action={setTheme.bind(null, next)}>
      <button
        className="inline-flex h-11 w-11 items-center justify-center rounded-control text-zinc-600 transition-colors duration-150 hover:bg-content2"
        aria-label={next === 'dark' ? 'Switch to dark' : 'Switch to light'}
      >
        {theme === 'dark' ? <SunIcon size={19} /> : <MoonIcon size={19} />}
      </button>
    </form>
  );
}
