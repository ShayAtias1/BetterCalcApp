import { Fragment } from 'react';
import { useLanguage, useT } from '../i18n';
import { LEGAL_CONTENT, PLACEHOLDER_CLOSE, PLACEHOLDER_OPEN, type LegalBlock } from '../lib/legal/legalContent';
import { LEGAL_IS_DRAFT, LEGAL_PATH, type LegalKind } from '../lib/legal/legalDocs';
import LanguageSwitch from './LanguageSwitch';
import BrandLogo from './BrandLogo';
import './LegalPage.css';

/** The two public legal paths. Anything else is the app. */
export function legalKindFromPath(pathname: string): LegalKind | null {
  const path = pathname.replace(/\/+$/, '');
  return path === LEGAL_PATH.privacy ? 'privacy' : path === LEGAL_PATH.terms ? 'terms' : null;
}

/** `**bold**` and `[[placeholder]]` spans. Placeholders are facts the owner still has to supply; they are shown plainly as such. */
function Rich({ text, label }: { text: string; label: string }) {
  const parts = text.split(/(\*\*.+?\*\*|\[\[.+?\]\])/g).filter(Boolean);
  return <>{parts.map((part, i) => {
    if (part.startsWith(PLACEHOLDER_OPEN) && part.endsWith(PLACEHOLDER_CLOSE)) return <mark key={i} className="legal-confirm" title={label}>{part.slice(2, -2)}</mark>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}><Rich text={part.slice(2, -2)} label={label} /></strong>;
    return <Fragment key={i}>{part}</Fragment>;
  })}</>;
}

function Block({ block, label }: { block: LegalBlock; label: string }) {
  if (block.kind === 'p') return <p className={block.num ? 'legal-numbered' : undefined}>{block.num && <span className="legal-num">{block.num}</span>}<span><Rich text={block.text} label={label} /></span></p>;
  if (block.kind === 'ul') return <ul>{block.items.map((item) => <li key={item}><Rich text={item} label={label} /></li>)}</ul>;
  if (block.kind === 'sub') return <ol className="legal-sub">{block.items.map((item) => <li key={item.label}><span className="legal-num">{item.label}</span><span><Rich text={item.text} label={label} /></span></li>)}</ol>;
  return (
    <div className="legal-table-wrap">
      <table>
        <thead><tr>{block.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{block.rows.map((row) => <tr key={row[0]}>{row.map((cell, i) => <td key={i}><Rich text={cell} label={label} /></td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/**
 * A public page (no sign-in, no account code): the privacy policy or the terms, in the current language. It reads
 * nothing from projects and shares no state with the app besides the language choice.
 */
export default function LegalPage({ kind }: { kind: LegalKind }) {
  const t = useT();
  const language = useLanguage();
  const doc = LEGAL_CONTENT[kind][language];
  const other: LegalKind = kind === 'terms' ? 'privacy' : 'terms';
  const label = t('legalPage.confirm');
  return (
    <div className="legal-page">
      <header className="legal-page-header">
        <a className="legal-page-brand" href="/" aria-label={t('legalPage.back')}><BrandLogo /></a>
        <div className="legal-page-tools">
          <a className="legal-page-link" href="/">{t('legalPage.back')}</a>
          <LanguageSwitch />
        </div>
      </header>
      <main className="legal-page-main">
        <h1>{doc.title}</h1>
        <p className="legal-meta"><Rich text={doc.meta} label={label} /></p>
        {LEGAL_IS_DRAFT && (
          <aside className="legal-draft" role="note">
            <strong>{t('legalPage.draftTitle')}</strong>
            <span>{t('legalPage.draftBody')}</span>
          </aside>
        )}
        {doc.notice && (
          <aside className="legal-notice" role="note">
            <h2>{doc.notice.title}</h2>
            <ol>{doc.notice.points.map((point) => <li key={point}><Rich text={point} label={label} /></li>)}</ol>
            <p><strong>{doc.notice.closing}</strong></p>
          </aside>
        )}
        {doc.sections.map((section) => (
          <section key={section.heading} className="legal-section">
            <h2>
              {section.heading}
              {section.status && <span className={`legal-badge ${section.status}`}>{t(`legalPage.${section.status}`)}</span>}
            </h2>
            {section.blocks.map((block, i) => <Block key={i} block={block} label={label} />)}
          </section>
        ))}
      </main>
      <footer className="legal-page-footer">
        <a href="/licenses/index.html">{t('legalPage.licenses')}</a>
        <a href={LEGAL_PATH[other]}>{t(`legalPage.other.${other}`)}</a>
        <a href="/">{t('legalPage.back')}</a>
      </footer>
    </div>
  );
}
