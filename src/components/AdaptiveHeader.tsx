import { useState, type ReactNode } from 'react';
import { useT } from '../i18n';
import Icon from './Icon';
import { BrandHomeLink } from './BrandLogo';
import TopBarMenu, { type MenuId } from './TopBarMenu';
import LanguageSwitch from './LanguageSwitch';

export default function AdaptiveHeader({ title, sheet, sheetCount, onSheet, onBack, saveState, calibrated, picker, view, more }: {
  title: string; sheet: number; sheetCount: number; onSheet: (sheet: number) => void;
  onBack: () => void; saveState: 'saving' | 'saved' | 'unsaved' | 'error'; calibrated: boolean;
  picker?: ReactNode; view: ReactNode; more?: ReactNode;
}) {
  const t = useT();
  const [menu, setMenu] = useState<MenuId | null>(null);
  return <header className="adaptive-header">
    <div className="adaptive-header-main">
      <BrandHomeLink title={t('topBar.goHome')} responsive />
      <div className="adaptive-plan-title" dir="auto" title={title}>{title}</div>
      <button className="icon-btn" onClick={onBack} aria-label={t('topBar.backToOverview')}><Icon name="back" /></button>
      <TopBarMenu id="settings" openId={menu} setOpenId={setMenu} icon="globe" label={t('app.language')} title={t('app.language')} variant="ghost">
        <div className="adaptive-menu-status">
          <span className={`save-state save-state-${saveState}`} role="status">{t(`topBar.save.${saveState}`)}</span>
          <span className={calibrated ? 'muted' : 'cal-missing'}>{t(calibrated ? 'pageStatus.calibrated' : 'pageStatus.notCalibrated')}</span>
        </div>
        {more && <div className="menu-action-group" onClick={(event) => {
          if (event.target instanceof Element && event.target.closest('button.menu-item')) setMenu(null);
        }}>{more}</div>}<LanguageSwitch labeled />
      </TopBarMenu>
    </div>
    <div className="adaptive-sheet-bar">
      <button className="icon-btn" disabled={sheet <= 1} onClick={() => onSheet(sheet - 1)} aria-label={t('topBar.previousPage')}><Icon name="chevron-previous" /></button>
      <TopBarMenu id="plans" openId={menu} setOpenId={setMenu} label={`${t('adaptive.sheet')} ${sheet} / ${sheetCount}`} variant="ghost">
        {picker}
        <label className="adaptive-sheet-picker">{t('adaptive.sheets')}
          <select value={sheet} onChange={(e) => { onSheet(Number(e.target.value)); setMenu(null); }}>
            {Array.from({ length: sheetCount }, (_, i) => <option key={i + 1} value={i + 1}>{t('adaptive.sheet')} {i + 1}</option>)}
          </select>
        </label>
      </TopBarMenu>
      <button className="icon-btn" disabled={sheet >= sheetCount} onClick={() => onSheet(sheet + 1)} aria-label={t('topBar.nextPage')}><Icon name="chevron-next" /></button>
      <TopBarMenu id="view" openId={menu} setOpenId={setMenu} icon="eye" label={t('adaptive.view')} variant="ghost">{view}</TopBarMenu>
      <span className={`save-state save-state-${saveState} adaptive-save-state`} role="status">{t(`topBar.save.${saveState}`)}</span>
      <span className={`adaptive-calibration-state ${calibrated ? 'muted' : 'cal-missing'}`}>{t(calibrated ? 'pageStatus.calibrated' : 'pageStatus.notCalibrated')}</span>
    </div>
  </header>;
}
