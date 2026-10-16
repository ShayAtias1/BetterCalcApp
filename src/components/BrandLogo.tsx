import { goHome } from '../lib/goHome';
import { useT } from '../i18n';
import symbol from '../assets/logo/bettercalc-symbol-blue.svg';

/** The standalone blue BC symbol: the app's only on-screen logo, with no wordmark beside it. */
export default function BrandLogo({ responsive = false }: { responsive?: boolean }) {
  void responsive; // one mark at every width
  return <img className="app-brand-symbol" src={symbol} width={36} height={18} alt="BetterCalc" />;
}

/** The logo as the "home" button of every workspace header. */
export function BrandHomeLink({ title, responsive = false }: { title: string; responsive?: boolean; mark?: boolean }) {
  const t = useT();
  return (
    <button type="button" className={`app-brand app-brand-link ${responsive ? 'responsive-brand' : ''}`} onClick={() => void goHome()} title={title} aria-label={t('topBar.goHome')}>
      <BrandLogo />
    </button>
  );
}
