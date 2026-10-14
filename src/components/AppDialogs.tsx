import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { useCompareStore } from '../store/compareStore';
import { useT } from '../i18n';
import { dismissNotice, noticeDuration, settleDialog, useAppDialogs, type DialogRequest } from '../lib/appDialogs';
import AppModal from './AppModal';

function RequestDialog({ request: d }: { request: DialogRequest }) {
  const t = useT();
  const [value, setValue] = useState(d.initialValue ?? '');
  const cancel = () => settleDialog(d.id, d.kind === 'prompt' ? null : false);
  return <AppModal title={d.title ?? t(d.kind === 'prompt' ? 'dialogs.inputTitle' : d.destructive ? 'dialogs.deleteTitle' : d.kind === 'message' ? 'dialogs.noticeTitle' : 'dialogs.confirmTitle')} onCancel={cancel} descriptionId={`dialog-message-${d.id}`}>
    <form onSubmit={e => { e.preventDefault(); settleDialog(d.id, d.kind === 'prompt' ? value.trim() : true); }}>
      <p className="app-dialog-message" id={`dialog-message-${d.id}`}>{d.message}</p>
      {d.notice && <p className="app-dialog-message" role="note">{d.notice}</p>}
      {d.disclosure && <details>
        <summary>{t('aiConfirmation.privacy')}</summary>
        <p className="app-dialog-message">{d.disclosure}</p>
      </details>}
      {d.kind === 'prompt' && <input className="app-dialog-input" autoFocus dir="auto" aria-labelledby={`dialog-message-${d.id}`}
        value={value} onChange={e => setValue(e.target.value)} required />}
      <div className="modal-actions">
        {d.kind !== 'message' && <button type="button" className="btn-secondary" autoFocus={d.kind !== 'prompt'} onClick={cancel}>{t('common.cancel')}</button>}
        <button type="submit" className={d.destructive ? 'btn-primary app-dialog-danger' : 'btn-primary'} disabled={d.kind === 'prompt' && !value.trim()}>
          {d.confirmLabel ?? t(d.kind === 'prompt' ? 'dialogs.save' : d.destructive ? 'dialogs.delete' : d.kind === 'message' ? 'dialogs.close' : 'dialogs.confirm')}
        </button>
      </div>
    </form>
  </AppModal>;
}
/** A notice dismisses itself; pointing at or focusing it holds it until the pointer/focus leaves. */
function Notice({ id, message }: { id: number; message: string }) {
  const t = useT();
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held) return;
    const timer = window.setTimeout(() => dismissNotice(id), noticeDuration(message));
    return () => window.clearTimeout(timer);
  }, [id, message, held]);
  return <div className="app-notice" onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}
    onFocus={() => setHeld(true)} onBlur={() => setHeld(false)}>
    <span role="status">{message}</span><button className="btn-ghost small" aria-label={t('dialogs.close')} onClick={() => dismissNotice(id)}>×</button>
  </div>;
}

export default function AppDialogs() {
  const t = useT();
  const queue = useAppDialogs(s => s.queue), notices = useAppDialogs(s => s.notices);
  const planId = useAppStore(s => s.project?.id), folderId = useAppStore(s => s.currentProject?.id);
  const comparisonId = useCompareStore(s => s.comparison?.id);
  useEffect(() => () => {
    // A delayed confirmation must never apply to a different workspace after navigation.
    for (const d of useAppDialogs.getState().queue) settleDialog(d.id, d.kind === 'prompt' ? null : false);
  }, [planId, folderId, comparisonId]);
  return <>
    {queue[0] && <RequestDialog key={queue[0].id} request={queue[0]} />}
    <div className="app-notices" aria-label={t('dialogs.noticeTitle')}>
      {notices.map(n => <Notice key={n.id} id={n.id} message={n.message} />)}
    </div>
  </>;
}
