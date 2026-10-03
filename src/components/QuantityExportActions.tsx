import Icon from './Icon';
import { useAppStore } from '../store/appStore';
import { useQuantityExportInfo } from '../hooks/useQuantityExportInfo';
import { hasAnyContent } from '../lib/exportContent';
import { useT } from '../i18n';

/**
 * The two actions that produce BetterCalc's main deliverable - the quantity report. They only OPEN the
 * export dialogs (QuantityExportDialogs, mounted once in the workspace): the 'menu' variant lives in
 * the top bar's export menu, which closes - and unmounts these items - as soon as one is clicked, so
 * nothing here may own a dialog.
 *
 * `variant` only changes the trigger markup: 'menu' renders menu items for TopBarMenu, 'buttons'
 * renders the toolbar buttons of the Quantities panel.
 */
export default function QuantityExportActions({ variant, onPicked }: { variant: 'menu' | 'buttons'; onPicked?: () => void }) {
  const t = useT();
  const info = useQuantityExportInfo();
  const busy = useAppStore((s) => s.quantityExportBusy);
  const open = useAppStore((s) => s.setQuantityExportDialog);
  if (!info) return null;

  // A button is actionable whenever its dialog has something to offer: the PDF can carry the plan pages
  // (markups and measurements count) on their own; the workbook needs a quantity domain.
  const canPdf = hasAnyContent(info.available) && busy !== 'pdf';
  const canExcel = hasAnyContent(info.excelAvailable) && busy !== 'excel';
  const surface = variant === 'menu' ? 'topbar_menu' : 'quantities_panel';
  const openPdf = () => {
    onPicked?.();
    open({ kind: 'pdf', surface });
  };
  const openExcel = () => {
    onPicked?.();
    open({ kind: 'excel', surface });
  };

  return variant === 'menu' ? (
    <>
      <button className="menu-item" onClick={openExcel} disabled={!canExcel}>
        <span className="menu-check">
          <Icon name="sheet" size={13} />
        </span>
        {busy === 'excel' ? t('common.exporting') : t('quantityExport.excelMenu')}
      </button>
      <button className="menu-item" onClick={openPdf} disabled={!canPdf}>
        <span className="menu-check">
          <Icon name="file" size={13} />
        </span>
        {busy === 'pdf' ? t('common.exporting') : t('quantityExport.pdfMenu')}
      </button>
    </>
  ) : (
    <>
      <button className="btn-secondary small" onClick={openPdf} disabled={!canPdf}>
        <Icon name="file" />
        {busy === 'pdf' ? t('common.exporting') : t('quantityExport.pdfButton')}
      </button>
      <button className="btn-primary small" onClick={openExcel} disabled={!canExcel}>
        <Icon name="sheet" />
        {busy === 'excel' ? t('common.exporting') : t('quantityExport.excelButton')}
      </button>
    </>
  );
}
