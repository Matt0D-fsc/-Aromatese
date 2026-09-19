import { LANGS, LANG_COOKIE, type Lang } from '@/lib/i18n';
import { setLanguage } from '@/app/dashboard/language-action';

// Two buttons, no client JavaScript: the choice is a cookie the server reads on the next render.
// It lives inside the sign-out form in the header, so each button submits its own action.
export function LanguageToggle({ lang }: { lang: Lang }) {
  const other: Lang = lang === 'bn' ? 'en' : 'bn';

  return (
    <button
      formAction={setLanguage.bind(null, other)}
      className="inline-flex min-h-11 items-center rounded-control px-2.5 text-sm font-medium text-zinc-600 transition-colors duration-150 hover:bg-content2"
      title={`Switch to ${LANGS[other]}`}
      name={LANG_COOKIE}
      value={other}
    >
      {LANGS[other]}
    </button>
  );
}
