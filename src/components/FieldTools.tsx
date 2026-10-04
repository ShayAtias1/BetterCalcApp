import { useState } from 'react';
import TopBarMenu, { type MenuId } from './TopBarMenu';
import { useAppStore } from '../store/appStore';
import { useFieldWorkflowStore } from '../store/fieldWorkflowStore';
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout';
import type { useTouchTakeoff } from '../hooks/useTouchTakeoff';
import { useT } from '../i18n';
import { rebarOf } from '../lib/structuralPlan';
import Icon from './Icon';

type Controls = ReturnType<typeof useTouchTakeoff>;
export default function FieldTools({ controls }: { controls: Controls }) {
  const t = useT();
  const { layout } = useWorkspaceLayout();
  const phone = layout === 'narrow';
  const [menu, setMenu] = useState<MenuId | null>(null);
  const calibrated = useAppStore((s) => !!s.project?.pages[s.currentPage]?.calibration);
  const canUndo = useAppStore((s) => s.history.length > 0);
  const launch = (tool: string) => {
    if (!tool) return;
    controls.cancel();
    const store = useAppStore.getState();
    if (tool === 'calibrate' && !phone) store.setToolMode('calibrate');
    else if (tool === 'distance' && calibrated) store.setMeasureTool('distance');
    else if (['text', 'arrow', 'rectangle'].includes(tool)) store.setMarkupTool(tool as 'text' | 'arrow' | 'rectangle');
    else if (!phone && tool === 'bars-area') {
      const selected = store.project && rebarOf(store.project).find((r) => r.id === store.selectedRebarId && r.kind === 'bars' && r.drawnBars === undefined);
      if (!selected) store.addRebarBars();
      const id = useAppStore.getState().selectedRebarId;
      if (id) useAppStore.getState().startBarsZone(id);
    } else if (!phone) {
      const [target, shape] = tool.split('-');
      if (target === 'room' || target === 'concrete' || target === 'rebar') {
        store.setDrawTarget(target); store.setToolMode(shape === 'rect' ? 'draw-rect' : 'draw');
      }
    }
    useFieldWorkflowStore.getState().setDraft(true);
  };
  return <div data-plan-control="field-tools" className="field-tools"
    onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}
    onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
    <div className="field-tool-row">
      <button className="btn-ghost" onClick={controls.cancel}>{t('adaptive.browse')}</button>
      <TopBarMenu id="tools" openId={menu} setOpenId={setMenu} label={t('field.tools')} variant="ghost">
        {!phone && <button className="menu-item" onClick={() => { setMenu(null); launch('calibrate'); }}>{t('toolbar.calibrate')}</button>}
        {!phone && <>
          {(['room', 'concrete', 'rebar'] as const).map((domain) => <div className="tool-menu-group" key={domain}>
            <div className="menu-section-title">{t(domain === 'room' ? 'workspace.tabs.rooms' : domain === 'concrete' ? 'workspace.tabs.concrete' : 'adaptive.mesh')}</div>
            <button className="menu-item" onClick={() => { setMenu(null); launch(`${domain}-rect`); }}>{t('field.rectangle')}</button>
            <button className="menu-item" onClick={() => { setMenu(null); launch(`${domain}-poly`); }}>{t('field.polygon')}</button>
          </div>)}
          <button className="menu-item" onClick={() => { setMenu(null); launch('bars-area'); }}>{t('rebar.spatial.area')}</button>
          <div className="menu-divider" />
        </>}
        <button className="menu-item" disabled={!calibrated} onClick={() => { setMenu(null); launch('distance'); }}>{t('measureTools.distance')}</button>
        <div className="menu-section-title">{t('workspace.tabs.markup')}</div>
        {(['text', 'arrow', 'rectangle'] as const).map((tool) => <button className="menu-item" key={tool}
          onClick={() => { setMenu(null); launch(tool); }}>{t(`markupTools.${tool}`)}</button>)}
      </TopBarMenu>
      {!phone && <button className="icon-btn" disabled={!canUndo || controls.activeDraft} onClick={() => { controls.cancel(); useAppStore.getState().undo(); }} aria-label={t('topBar.undo')}><Icon name="undo" /></button>}
    </div>
    {!calibrated && <p className="field-hint muted">{t('field.distanceNeedsScale')}</p>}
    {controls.activeDraft && <div className="field-draft-actions">
      <span className="field-hint" role="status">{controls.distanceResult ?? t('field.adjustPoints', { count: controls.points.length })}</span>
      <button className="btn-ghost" disabled={!controls.points.length} onClick={controls.back}>{t('field.backPoint')}</button>
      <button className="btn-ghost" onClick={controls.cancel}>{t(phone ? 'phoneReview.discard' : 'common.cancel')}</button>
      <button className="btn-primary" disabled={controls.points.length < controls.minPoints} onClick={controls.finish}>{t(controls.key === 'calibrationPoints' ? 'field.enterDistance' : phone ? 'field.keep' : 'field.finish')}</button>
    </div>}
    {controls.canEditGeometry && !controls.activeDraft && <div className="field-draft-actions">
      <button className={`btn-ghost ${controls.action === 'move' ? 'active' : ''}`} aria-pressed={controls.action === 'move'} onClick={() => useFieldWorkflowStore.getState().setGeometryAction('move')}>{t('field.move')}</button>
      <button className={`btn-ghost ${controls.action === 'reshape' ? 'active' : ''}`} aria-pressed={controls.action === 'reshape'} onClick={() => useFieldWorkflowStore.getState().setGeometryAction('reshape')}>{t('field.editGeometry')}</button>
      {controls.action !== 'browse' && <button className="btn-ghost" onClick={controls.cancel}>{t('common.cancel')}</button>}
    </div>}
    {controls.canEditBar && controls.canEditGeometry && !controls.activeDraft && <div className="field-draft-actions">
      <button className={`btn-ghost ${controls.action === 'start' ? 'active' : ''}`} aria-pressed={controls.action === 'start'} onClick={() => useFieldWorkflowStore.getState().setGeometryAction('start')}>{t('field.editStart')}</button>
      <button className={`btn-ghost ${controls.action === 'end' ? 'active' : ''}`} aria-pressed={controls.action === 'end'} onClick={() => useFieldWorkflowStore.getState().setGeometryAction('end')}>{t('field.editEnd')}</button>
    </div>}
    {controls.canEditNote && !controls.activeDraft && <button className="btn-ghost" onClick={controls.editNote}>{t('field.editNote')}</button>}
  </div>;
}
