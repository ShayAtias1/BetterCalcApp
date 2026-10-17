import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@fontsource/assistant/400.css'
import '@fontsource/assistant/500.css'
import '@fontsource/assistant/600.css'
import '@fontsource/assistant/700.css'
import './index.css'
import './lib/pdfjsSetup'
import { initAnalytics } from './lib/analytics'
import App from './App.tsx'
import LegalPage, { legalKindFromPath } from './components/LegalPage'
import { isLanguage, syncDocumentLanguage, useLanguageStore, type Language } from './i18n'

// Before the first render: consumes UTM / bc_internal params and strips them from the address bar.
initAnalytics()

/**
 * Language precedence. In production the UI language is the saved preference (the language selector
 * writes it), otherwise Hebrew — never the browser's or the system's language.
 *
 * Development-only overrides, for regression runs of the real app: `?lang=en` starts this page load in
 * that language instead of the saved one (it is not saved itself; choosing a language in the selector
 * afterwards is an ordinary choice and is saved), and `?dir=ltr` / `?dir=rtl` pins the page direction
 * (e.g. Hebrew in LTR). Both are compiled out of production builds. Exports are written in the
 * language the UI is showing.
 */
function devOverrides(): { language: Language | null; direction: 'rtl' | 'ltr' | null } {
  if (!import.meta.env.DEV) return { language: null, direction: null };
  const params = new URLSearchParams(window.location.search);
  const language = params.get('lang');
  const direction = params.get('dir');
  return {
    language: isLanguage(language) ? language : null,
    direction: direction === 'ltr' || direction === 'rtl' ? direction : null,
  };
}

const overrides = devOverrides();
if (overrides.language) useLanguageStore.setState({ language: overrides.language });
syncDocumentLanguage(overrides.direction);

// /privacy and /terms are public pages: no welcome screen, sign-in or project storage is involved.
const legalKind = legalKindFromPath(window.location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {legalKind ? <LegalPage kind={legalKind} /> : <App />}
  </StrictMode>,
)
