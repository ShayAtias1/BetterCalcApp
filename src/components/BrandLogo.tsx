import { goHome } from '../lib/goHome';
import { useT } from '../i18n';
import logo from '../assets/logo/bettercalc-logo.svg';
import logoReversed from '../assets/logo/bettercalc-logo-reversed.svg';

/** The final BetterCalc lockup, swapped to the reversed asset when the app follows a dark system theme. */
export default function BrandLogo() {
  return (
    <picture>
      <source srcSet={logoReversed} media="(prefers-color-scheme: dark)" />
      <img className="app-brand-logo" src={logo} width={96} height={16} alt="BetterCalc" />
    </picture>
  );
}

/** The logo as the "home" button of every workspace header. */
export function BrandHomeLink({ title }: { title: string }) {
  const t = useT();
  return (
    <button type="button" className="app-brand app-brand-link" onClick={() => void goHome()} title={title} aria-label={t('topBar.goHome')}>
      <BrandLogo />
    </button>
  );
}
