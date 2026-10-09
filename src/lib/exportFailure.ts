import { notify } from './appDialogs';
import { t } from '../i18n';

/**
 * What every export handler does when an export throws: log it for debugging and tell the user —
 * previously a failed export only left an unhandled rejection in the console and the button
 * simply came back. (The analytics side is recorded by `trackedExport` before the error gets here.)
 */
export function notifyExportFailed(err: unknown): void {
  console.error('Export failed', err);
  notify(t('exports.common.exportFailed'));
}
