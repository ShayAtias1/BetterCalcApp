import { useLanguage, useT } from '../i18n';
import { PREVIEW_PLANS, previewCurrency } from '../lib/account/pricingPreview';
import Icon from './Icon';

/** A public catalog only: no purchase handlers, account mutations or AI actions. */
export default function PricingPreview() {
  const t = useT();
  const language = useLanguage();
  const currency = previewCurrency(language);
  const features = ['rowFinishes', 'rowMeasure', 'rowCompare', 'rowExport'] as const;
  return (
    <section className="pricing-preview" aria-labelledby="pricing-preview-title">
      <header className="pricing-preview-intro">
        <span className="pricing-preview-label">{t('acct.plans.previewLabel')}</span>
        <h1 id="pricing-preview-title">{t('acct.plans.title')}</h1>
        <p>{t('acct.plans.previewIntro')}</p>
      </header>
      <div className="pricing-preview-grid">
        {PREVIEW_PLANS.map((plan) => {
          const paid = plan.code !== 'free';
          return (
            <article key={plan.code} className={`acct-card pricing-preview-card${plan.code === 'pro' ? ' recommended' : ''}`} aria-labelledby={`pricing-${plan.code}`}>
              <div className="pricing-preview-card-head">
                <h2 id={`pricing-${plan.code}`}><bdi>{plan.name}</bdi></h2>
                {plan.code === 'pro' && <span className="pricing-preview-recommended">{t('acct.plans.recommended')}</span>}
              </div>
              <p className="pricing-preview-audience">{t(`acct.plans.audience.${plan.code}`)}</p>
              <div className="pricing-preview-price">
                <strong><bdi dir="ltr">{currency.symbol}{plan.prices[currency.code]}</bdi></strong>
                <span>{t('acct.plans.perMonth')}</span>
              </div>
              <p className="pricing-preview-credits">{t('acct.plans.previewCredits', { count: plan.monthlyCredits })}</p>
              <ul className="pricing-preview-features">
                {features.map((feature) => <li key={feature}><Icon name="check" size={16} /><span>{t(`acct.plans.${feature}`)}</span></li>)}
                <li className="pricing-preview-ai"><Icon name={paid ? 'scan' : 'minus'} size={16} /><span>{t(paid ? 'acct.plans.aiAtLaunch' : 'acct.plans.noAi')}</span></li>
              </ul>
              <div className="pricing-preview-availability">
                <span className={`pricing-preview-status${paid ? '' : ' available'}`}>{t(paid ? 'acct.comingSoon' : 'acct.plans.availableNow')}</span>
                {!paid && <span>{t('acct.plans.noAccountNeeded')}</span>}
              </div>
            </article>
          );
        })}
      </div>
      <footer className="pricing-preview-notes">
        <p><Icon name="scan" size={16} /><span>{t('acct.plans.processingNote')}</span></p>
        <p>{t('acct.plans.previewDisclaimer')}</p>
      </footer>
    </section>
  );
}
