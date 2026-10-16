import { useCallback, useEffect, useState } from 'react';
import { useT } from '../i18n';
import { welcomeStore } from '../lib/access/welcome';
import LanguageSwitch from './LanguageSwitch';
import { AuthForm } from './AuthDialog';
import './Welcome.css';

/** The BC symbol, drawn in the current text colour so it can be white on the dark entrance. */
function Mark() {
  return (
    <svg className="welcome-mark" viewBox="-8 -8 356 182" role="img" aria-label="BetterCalc">
      <path fill="currentColor" fillRule="evenodd" d="M0 0H126L158 31V69H132L117 31H31V69H126L158 100V136L126 166H0ZM31 100H123L132 109L117 136H31Z" />
      <path fill="currentColor" d="M168 38L218 0H340V31H230L188 69H168ZM168 99H188L230 136H340V166H217L168 121Z" />
    </svg>
  );
}

/** A floor plan that draws itself: walls, door swings, a dimension line and one measured room. Pure decoration. */
function PlanArt() {
  const line = (d: string, delay: number, cls = '') => <path className={`wp ${cls}`} d={d} pathLength={1} style={{ ['--d' as string]: `${delay}s` }} />;
  return (
    <svg className="welcome-plan" viewBox="0 0 1200 760" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g className="wp-walls">
        {line('M140 120H1060V640H140Z', 0.1, 'wp-wall')}
        {line('M140 330H520', 0.9, 'wp-wall')}
        {line('M520 120V330', 1.1, 'wp-wall')}
        {line('M520 330V640', 1.3, 'wp-wall')}
        {line('M520 440H1060', 1.5, 'wp-wall')}
        {line('M800 440V640', 1.7, 'wp-wall')}
        {line('M780 120V300H1060', 1.9, 'wp-wall')}
      </g>
      <g className="wp-detail">
        {line('M300 330A64 64 0 0 1 364 266', 2.3)}
        {line('M520 520A64 64 0 0 0 456 584', 2.5)}
        {line('M800 560A64 64 0 0 1 864 496', 2.7)}
        {line('M300 120V140M310 120V140M320 120V140', 2.9)}
        {line('M900 640V620M910 640V620M920 640V620', 3.0)}
        {line('M140 80H1060M140 66V94M1060 66V94', 2.2, 'wp-dim')}
        {line('M100 120V640M86 120H114M86 640H114', 2.4, 'wp-dim')}
      </g>
      <g className="wp-measured">
        <path className="wp-room" d="M540 350H780V430H540Z" />
        <circle cx="540" cy="350" r="5" /><circle cx="780" cy="350" r="5" /><circle cx="780" cy="430" r="5" /><circle cx="540" cy="430" r="5" />
      </g>
      <g className="wp-labels" direction="ltr">
        <text x="600" y="58">12.40 m</text>
        <text x="660" y="396">19.2 m²</text>
        <text x="40" y="388" transform="rotate(-90 40 388)">8.60 m</text>
      </g>
    </svg>
  );
}

type View = 'home' | 'signIn' | 'create';

/**
 * The entrance before the Projects page and the sign-in / registration screens, one continuous design. Sign in and Create
 * account swap the card's content (the same authentication form and logic the dialog uses, shown inline) with a Back button;
 * Continue as guest only records that the choice was made. No data is touched.
 */
export default function WelcomeScreen() {
  const t = useT();
  const markSeen = welcomeStore((s) => s.markSeen);
  const [view, setView] = useState<View>('home');
  const back = useCallback(() => setView('home'), []);
  useEffect(() => {
    if (view === 'home') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') back(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, back]);
  return (
    <main className="welcome" aria-labelledby={view === 'home' ? 'welcome-title' : undefined}>
      <div className="welcome-bg" aria-hidden="true">
        <div className="welcome-grid" />
        <PlanArt />
      </div>
      <div className="welcome-lang"><LanguageSwitch /></div>
      <div className="welcome-stage">
        <section className={`welcome-card${view === 'home' ? '' : ' welcome-card-form'}`}>
          {view !== 'home' && (
            <button type="button" className="welcome-back" onClick={back}>
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" /></svg>
              {t('welcome.back')}
            </button>
          )}
          <Mark />
          <div className="welcome-view" key={view}>
            {view === 'home' ? (
              <>
                <h1 id="welcome-title">{t('welcome.title')}</h1>
                <p className="welcome-sub">{t('welcome.subtitle')}</p>
                <div className="welcome-actions">
                  <button type="button" className="welcome-btn welcome-btn-outline" onClick={() => setView('signIn')}>{t('welcome.signIn')}</button>
                  <button type="button" className="welcome-btn welcome-btn-primary" onClick={() => setView('create')}>{t('welcome.create')}</button>
                  <button type="button" className="welcome-btn welcome-btn-ghost" onClick={markSeen}>{t('welcome.guest')}</button>
                </div>
                <p className="welcome-note">{t('welcome.localNote')}</p>
              </>
            ) : (
              <AuthForm inline reason="account" initialMode={view} onClose={back} t={t} />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
