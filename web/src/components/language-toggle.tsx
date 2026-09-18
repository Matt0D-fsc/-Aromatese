import { LANGS, LANG_COOKIE, type Lang } from '@/lib/i18n';
import { setLanguage } from '@/app/dashboard/language-action';

// Two buttons, no client JavaScript: the choice is a cookie the server reads on the next render.
// It lives inside the sign-out form in the header, so each button submits its own action.
export function LanguageToggle({ lang }: { lang: Lang }) {
  const other: Lang = lang === 'bn' ? 'en' : 'bn';

  return (
    <button
      formAction={setLanguage.bind(null, other)}
      className="rounded-lg px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100"
      title={`Switch to ${LANGS[other]}`}
      name={LANG_COOKIE}
      value={other}
    >
      {LANGS[other]}
    </button>
  );
}
