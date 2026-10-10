import { LANGUAGES, useLanguageStore, useT, type Language } from '../i18n';

const ORDER: Language[] = ['he', 'en'];

/**
 * The language selector: a two-option segmented control that sits last in every top bar's output
 * group. Each option is written in its own language, so it reads the same whichever one is active, and
 * the control uses only logical CSS, so it is correct in both directions. Switching is immediate — the
 * setting is reactive state (see i18n), not a reload.
 */
export default function LanguageSwitch({ labeled = false }: { labeled?: boolean }) {
  const t = useT();
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  const selector = (
    <div className="language-switch" role="group" aria-label={t('app.language')} title={t('app.language')}>
      {ORDER.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          className={code === language ? 'active' : ''}
          aria-pressed={code === language}
          onClick={() => setLanguage(code)}
        >
          {LANGUAGES[code].nativeName}
        </button>
      ))}
    </div>
  );
  return labeled ? (
    <div className="language-control">
      <span className="language-control-label">{t('app.language')} · <bdi>{LANGUAGES[language].nativeName}</bdi></span>
      {selector}
    </div>
  ) : selector;
}
