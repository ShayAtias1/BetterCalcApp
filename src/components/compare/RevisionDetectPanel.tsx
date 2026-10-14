import { elementWorkKind, elementWorkKinds, revisionWorkKinds } from '../../lib/revision/workClassification';
import { useEffect, useMemo, useState } from 'react';
import type { PanelPart } from '../PanelPart';
import { compareScaleFor, useCompareStore } from '../../store/compareStore';
import { useAppStore } from '../../store/appStore';
import { LANGUAGES, useLanguage, useT } from '../../i18n';
import { round } from '../../lib/geometry';
import { loadPlan } from '../../db/database';
import type { Plan } from '../../types';
import type { RevisionChange, RevisionEditType, RevisionPageAnalysis } from '../../types/revisionAnalysis';
import { analysisInputKey } from '../../lib/revision/detect';
import { checkPlanLink, latestApplication, pendingApplication, type LinkStatus } from '../../lib/revision/apply';
import { changeItems, relocationQuantities } from '../../lib/revision/changeItems';
import { isOpeningDifference, openingImpact, openingImpactReady, openingWallThicknessPx } from '../../lib/revision/openingImpact';
import { openingGeometryNeedsVerification, openingFootprint, setOpeningThickness, EDIT_TYPES, editTypeOf, familyOf, hasUnplacedLines, removeElement, retypeChange, setOpeningHeight, sidesOf, isAiWallChange, wallGeometryNeedsVerification, wallHasFootprint } from '../../lib/revision/changeEdit';
import {
  applyApprovedChanges,
  swapSelectedChange,
  focusChange,
  revertRevisionApplication,
  runAiPageAnalysis,
  startManualChangeDrawing,
  useRevisionUi,
  visibleChanges,
  type ChangeFilter,
} from '../../lib/revision/revisionWorkflow';
import Icon from '../Icon';
import AreaShapePicker from '../AreaShapePicker';
import { OPENING_DEFAULT_SIZES } from '../../config/measurementDefaults';
import { revisionTypeLabelKey } from './revisionTerminology';
import './RevisionDetect.css';

function useActiveAnalysis(): { analysis: RevisionPageAnalysis | undefined; stale: boolean } {
  const comparison = useCompareStore((s) => s.comparison);
  const currentPageKey = useCompareStore((s) => s.currentPageKey);
  return useMemo(() => {
    const revision = comparison?.revisions.find((r) => r.id === comparison.activeRevisionId);
    const analysis = revision?.analysis?.pages[currentPageKey];
    // A manual-only page has no detection result to go stale.
    const stale = !!analysis && !!comparison && !analysis.manualOnly && analysis.inputKey !== analysisInputKey(comparison, revision!.id, currentPageKey);
    return { analysis, stale };
  }, [comparison, currentPageKey]);
}

/** Wraps user/plan text (room names, numbers, English) so it keeps its own direction inside a Hebrew sentence. */
const isolate = (text: string) => `\u2068${text}\u2069`;

function WorkLabels({ kinds }: { kinds: ('demolition' | 'construction')[] }) {
  const t = useT();
  return <span className="revision-work-labels">{kinds.map(kind =>
    <span key={kind} className={`work-${kind}`} data-revision-work={kind}>{t(`revisionAi.work.${kind}`)}</span>)}</span>;
}

function ChangeCard({ change, number, readOnly }: { change: RevisionChange; number: number; readOnly: boolean }) {
  const t = useT();
  const comparison = useCompareStore((s) => s.comparison);
  const review = useCompareStore((s) => s.reviewRevisionChange);
  const confirmAsWall = useCompareStore((s) => s.confirmChangeAsWall);
  const deleteChange = useCompareStore((s) => s.deleteRevisionChange);
  const selectedId = useRevisionUi((s) => s.selectedChangeId);
  const editingId = useRevisionUi((s) => s.editingChangeId);
  const expandedId = useRevisionUi((s) => s.expandedChangeId);
  // Card text follows the UI direction; AI/plan text inside it is isolated (see `isolate`).
  const language = useLanguage();
  const dir = LANGUAGES[language].dir;
  const typeLabel = (type: RevisionEditType) => t(revisionTypeLabelKey(type, comparison?.context, language));
  const scale = compareScaleFor(comparison, change.pageNumber);
  const mpp = scale.state === 'calibrated' ? scale.metersPerPixel : 0;
  const m = (px: number) => round(px * mpp, 2);
  const locked = readOnly || change.status === 'applied';
  const cm = (px: number) => Math.round(px * mpp * 100);
  const doorWidth = (d: RevisionChange['doors'][number]) => m(Math.hypot(d.jamb.x - d.hinge.x, d.jamb.y - d.hinge.y));
  // One compact line per shape: a removed + added pair collapses into "before ← after" without labels.
  const rows: { icon: 'wall' | 'door'; text: string }[] = [];
  const removedWalls = change.walls.filter((w) => w.side === 'removed' && (!isAiWallChange(change) || wallHasFootprint(w)));
  const addedWalls = change.walls.filter((w) => w.side === 'added' && (!isAiWallChange(change) || wallHasFootprint(w)));
  const wallLine = (w: RevisionChange['walls'][number]) => !mpp
    ? t('revisionAi.wallUncalibrated')
    : w.thicknessPx > 0
      ? t('revisionAi.wallLine', { length: m(w.lengthPx), thickness: cm(w.thicknessPx) })
      : t('revisionAi.wallLineUnknown', { length: m(w.lengthPx) });
  const wallHeight = comparison?.wallHeightDefaultM ?? 0;
  const relocated = relocationQuantities(change, mpp, wallHeight);
  if (change.relocation) {
    // One relocated wall: before/after of the verified lengths, never per-fragment rows.
    if (relocated) {
      rows.push({ icon: 'wall', text: t('revisionAi.relocated', { offset: relocated.offsetM, before: relocated.beforeLengthM, after: relocated.afterLengthM, delta: relocated.deltaLengthM }) });
      rows.push({ icon: 'wall', text: t('revisionAi.relocatedArea', { before: relocated.beforeAreaM2, after: relocated.afterAreaM2, delta: relocated.deltaAreaM2, height: wallHeight }) });
    } else if (!mpp) rows.push({ icon: 'wall', text: t('revisionAi.relocatedUncalibrated') });
  }
  const pairedWalls = mpp && !change.relocation ? Math.min(removedWalls.length, addedWalls.length) : 0;
  for (let i = 0; i < pairedWalls; i++) {
    const a = removedWalls[i];
    const b = addedWalls[i];
    const thickness = cm(a.thicknessPx) === cm(b.thicknessPx) ? `${cm(a.thicknessPx)}` : `${cm(a.thicknessPx)} ← ${cm(b.thicknessPx)}`;
    rows.push({ icon: 'wall', text: t('revisionAi.wallPair', { before: m(a.lengthPx), after: m(b.lengthPx), thickness }) });
  }
  if (!change.relocation) [...removedWalls.slice(pairedWalls), ...addedWalls.slice(pairedWalls)].forEach((w) => rows.push({ icon: 'wall', text: wallLine(w) }));
  const removedDoors = change.doors.filter((d) => d.side === 'removed');
  const addedDoors = change.doors.filter((d) => d.side === 'added');
  const pairedDoors = mpp ? Math.min(removedDoors.length, addedDoors.length) : 0;
  for (let i = 0; i < pairedDoors; i++) {
    rows.push({ icon: 'door', text: t('revisionAi.doorPair', { before: doorWidth(removedDoors[i]), after: doorWidth(addedDoors[i]) }) });
  }
  [...removedDoors.slice(pairedDoors), ...addedDoors.slice(pairedDoors)].forEach((d) => rows.push({
    icon: 'door',
    text: d.opening === 'window'
      ? mpp ? t('revisionAi.edit.windowLine', { width: doorWidth(d) }) : t('revisionAi.edit.types.window-added')
      : mpp ? t('revisionAi.door', { width: doorWidth(d) }) : t('revisionAi.doorUncalibrated'),
  }));
  const editing = editingId === change.id && !locked;
  const unplaced = hasUnplacedLines(change) || !openingImpactReady(change) || openingGeometryNeedsVerification(change);
  const title = change.userType
    ? typeLabel(change.userType)
    : change.relocation
    ? t('revisionAi.relocatedTitle')
    : change.aiProposal
    ? typeLabel(editTypeOf(change))
    : language === 'he' && change.category === 'wall' && (change.kind === 'added' || change.kind === 'removed')
    ? typeLabel(change.kind === 'added' ? 'wall-added' : 'wall-removed')
    : change.category === 'unknown'
    ? t('revisionAi.categories.unknown')
    : t(`revisionAi.cardTitle.${change.kind}`, { category: t(`revisionAi.categories.${change.category}`) });

  const items = (comparison?.revisions.find((r) => r.id === comparison.activeRevisionId)?.measurements ?? [])
    .filter((x) => (change.measurementIds ?? []).includes(x.id));
  const areaOf = (kind: 'demolition' | 'construction') => round(items.filter((x) => x.areaKind === kind).reduce((sum, x) => sum + (x.areaM2 ?? 0), 0), 2);
  const done = change.status === 'approved' || change.status === 'applied';
  // An approved change folds to one line; its card opens again for review or changes on click.
  const collapsed = done && expandedId !== change.id;
  const verification = change.aiProposal && !change.edited ? change.aiProposal.verification : null;
  const toggle = () => {
    focusChange(change);
    if (done) useRevisionUi.setState({ expandedChangeId: collapsed ? change.id : null });
  };
  const work = revisionWorkKinds(change);
  const workClass = work.length === 1 ? `work-${work[0]}` : 'work-mixed';
  const summary = items.length
    ? (['demolition', 'construction'] as const).filter((k) => areaOf(k) > 0).map((k) => `${t(`areaKinds.${k}`)} ${areaOf(k)} ${t('units.m2')}`).join(' · ')
    : rows[0]?.text ?? '';

  return (
    <li tabIndex={0} dir={dir} aria-label={`${number}. ${title}`} aria-current={selectedId === change.id ? 'true' : undefined} aria-expanded={done ? !collapsed : undefined}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(); } }}
      className={`revision-card ${workClass} ${change.kind} ${change.status} ${selectedId === change.id ? 'selected' : ''} ${collapsed ? 'collapsed' : ''}`} onClick={toggle}>
      <div className="revision-card-head">
        <span className={`revision-num ${workClass}`}>{number}</span>
        <strong className="revision-title">{title}</strong>
        <span className="revision-flags">
          {change.status === 'pending' && verification && <span className={`revision-verify ${verification}`}>{t(`revisionAi.verifyChip.${verification}`)}</span>}
          {change.status !== 'pending' && <span className={`revision-status ${change.status}`}>{change.status === 'approved' ? t('revisionAi.approvedSummary') : t(`revisionAi.status.${change.status}`)}</span>}
          {!collapsed && (change.manual || change.edited) && <span className="revision-badge manual">{t(change.manual ? 'revisionAi.edit.manualBadge' : 'revisionAi.edit.editedBadge')}</span>}
          {done && <Icon name={collapsed ? 'chevron-down' : 'chevron-up'} size={12} />}
        </span>
      </div>
      <WorkLabels kinds={work} />
      {collapsed ? (summary && <div className="revision-fact muted revision-summary"><span>{summary}</span></div>) : <>
        {(rows.length > 0 || change.textChanges) && (
          <div className="revision-facts">
            {rows.map((row, i) => (
              <div key={i} className="revision-fact">
                <Icon name={row.icon} size={12} />
                <span>{row.text}</span>
              </div>
            ))}
            {change.textChanges && (
              <div className="revision-fact revision-text-change">
                <span>{t('revisionAi.textChange', { before: isolate(change.textChanges.before.join(', ') || '-'), after: isolate(change.textChanges.after.join(', ') || '-') })}</span>
              </div>
            )}
          </div>
        )}
        {unplaced && <div className="revision-fact revision-unverified">{t(wallGeometryNeedsVerification(change) ? 'revisionAi.edit.verifyWallRequired' : change.category === 'opening' ? 'compare.openingImpact.required' : 'revisionAi.unplaced')}</div>}

        {/* Explanations are secondary: open on demand, and never repeated on an approved change's summary. */}
        <details className="revision-more" onClick={(e) => e.stopPropagation()}>
          <summary>{t('revisionAi.details')}</summary>
          <div className="revision-fact muted">{t(`revisionAi.significance.${change.significance}`)}</div>
          {change.ai && (
            <div className="revision-ai">
              {t('revisionAi.ai.label', { summary: isolate(change.ai.summary || change.ai.category) })}{' '}
              <span className="muted">{t('revisionAi.ai.confidence', { percent: Math.round(change.ai.confidence * 100) })}</span>
            </div>
          )}
          {verification && (
            <div className={`revision-fact ${verification === 'verified' ? 'muted' : 'revision-unverified'}`}>{t(`revisionAi.page.${verification}`)}</div>
          )}
          {change.status === 'approved' && (
            <div className="revision-fact muted">
              {change.measurementIds?.length
                ? t('revisionAi.items', { count: change.measurementIds.length })
                : relocated && (comparison?.context ?? 'design') === 'design'
                  ? t('revisionAi.designDifference', { delta: relocated.deltaAreaM2 })
                  : t('revisionAi.approvedNoItems')}
            </div>
          )}
          {!!change.wallCandidates?.length && (
            <div className="revision-fact muted">{t('revisionAi.wallCandidates', { count: change.wallCandidates.length })}</div>
          )}
        </details>

        {!locked && (
          <div className="revision-actions" onClick={(e) => e.stopPropagation()}>
            {change.status !== 'approved' && (
              <button className="btn-secondary small" disabled={unplaced} title={unplaced ? t(change.category === 'opening' ? 'compare.openingImpact.required' : 'revisionAi.unplaced') : undefined} onClick={() => {
                review(change.pageNumber, change.id, 'approved');
                // Approved: the card folds to its summary and the plan shows the change's items.
                const ui = useRevisionUi.getState();
                useRevisionUi.setState({
                  ...(ui.expandedChangeId === change.id ? { expandedChangeId: null } : {}),
                  ...(ui.editingChangeId === change.id ? { editingChangeId: null } : {}),
                });
              }}>
                <Icon name="check" size={12} /> {t('revisionAi.actions.approve')}
              </button>
            )}
            {change.status !== 'rejected' && !change.manual && change.status !== 'approved' && (
              <button className="btn-ghost small" onClick={() => review(change.pageNumber, change.id, 'rejected')}>
                <Icon name="close" size={12} /> {t('revisionAi.actions.reject')}
              </button>
            )}
            <button className={editing ? 'btn-secondary small' : 'btn-ghost small'} aria-pressed={editing} title={t('revisionAi.edit.hint')}
              onClick={() => {
                if (!editing) focusChange(change);
                useRevisionUi.setState({ editingChangeId: editing ? null : change.id, editSide: 'both', placingType: null });
              }}>
              <Icon name={editing ? 'check' : 'edit'} size={12} /> {editing ? t('revisionAi.edit.done') : t('revisionAi.edit.edit')}
            </button>
            {wallGeometryNeedsVerification(change) && <button className="btn-secondary small" onClick={() => {
              const side = sidesOf(editTypeOf(change)).find(side => !change.walls.some(w => w.side === side && wallHasFootprint(w)))
                ?? change.walls.find(w => !wallHasFootprint(w))?.side ?? sidesOf(editTypeOf(change))[0];
              startManualChangeDrawing(editTypeOf(change), { changeId: change.id, side });
            }}>{t('revisionAi.edit.verifyWall')}</button>}
            {change.status === 'pending' && !!change.wallCandidates?.length && !isAiWallChange(change) && (
              <button className="btn-ghost small" title={t('revisionAi.confirmWallHint')} onClick={() => confirmAsWall(change.pageNumber, change.id)}>
                <Icon name="wall" size={12} /> {t('revisionAi.confirmWall')}
              </button>
            )}
            {change.status !== 'pending' && (
              <button className="btn-ghost small" onClick={() => review(change.pageNumber, change.id, 'pending')}>
                {t('revisionAi.actions.reset')}
              </button>
            )}
            <button className="btn-ghost small icon-only" aria-label={t('revisionAi.edit.delete')} title={t('revisionAi.edit.delete')} onClick={() => {
              const ui = useRevisionUi.getState();
              useRevisionUi.setState({
                ...(ui.editingChangeId === change.id ? { editingChangeId: null } : {}),
                ...(ui.selectedChangeId === change.id ? { selectedChangeId: null, focus: null } : {}),
              });
              deleteChange(change.pageNumber, change.id);
            }}>
              <Icon name="trash" size={12} />
            </button>
          </div>
        )}
      </>}
    </li>
  );
}

/**
 * Manual correction of one change: its classification, which side's geometry the plan handles
 * show, and its lines (add / delete / opening height). Lines are moved on the plan itself.
 */
function SwapVersionsButton({ change }: { change: RevisionChange }) {
  const t = useT();
  const busy = useRevisionUi(s => s.applying);
  return <button className="btn btn-secondary" disabled={busy} onClick={e => {
    e.stopPropagation(); void swapSelectedChange(change.pageNumber, change.id);
  }}>{t('revisionAi.edit.swapButton')}</button>;
}

export function ChangeEditor({ change }: { change: RevisionChange }) {
  const t = useT();
  const language = useLanguage();
  const comparison = useCompareStore((s) => s.comparison);
  const edit = useCompareStore((s) => s.editRevisionChange);
  const finishEdit = useCompareStore((s) => s.finishRevisionChangeEdit);
  const editSide = useRevisionUi((s) => s.editSide);
  const selectedWalls = useRevisionUi(s => s.selectedWallRegions);
  const scale = compareScaleFor(comparison, change.pageNumber);
  const mpp = scale.state === 'calibrated' ? scale.metersPerPixel : 0;
  const type = editTypeOf(change);
  const sides = sidesOf(type);
  const family = familyOf(type);
  const apply = (fn: (c: RevisionChange) => RevisionChange) => edit(change.pageNumber, change.id, fn);
  const length = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const px = Math.hypot(b.x - a.x, b.y - a.y);
    return mpp ? t('revisionAi.edit.lengthM', { value: round(px * mpp, 2) }) : t('revisionAi.edit.lengthPx', { value: Math.round(px) });
  };
  const elements = [
    ...change.walls.flatMap((w, index) => isAiWallChange(change) && !wallHasFootprint(w) ? [] : [{ key: `w${index}`, list: 'walls' as const, index, side: w.side, label: t('revisionAi.edit.wall'), a: w.centerline[0], b: w.centerline[1], heightM: undefined as number | undefined, opening: undefined as 'door' | 'window' | undefined }]),
    ...change.doors.map((d, index) => ({ key: `d${index}`, list: 'doors' as const, index, side: d.side, label: t(d.opening === 'window' ? 'revisionAi.edit.window' : 'revisionAi.edit.door'), a: d.hinge, b: d.jamb, heightM: d.heightM, opening: d.opening ?? 'door' })),
  ].filter((el) => editSide === 'both' || el.side === editSide);

  return (
    <div className="revision-editor" onClick={(e) => e.stopPropagation()}>
      <SwapVersionsButton change={change} />
      <label className="field-label" title={t(family === 'other' ? 'revisionAi.edit.otherHint' : family === 'wall' ? 'revisionAi.edit.wallPlanHint' : 'revisionAi.edit.planHint')}>{t('revisionAi.edit.type')}</label>
      <select value={type} onChange={(e) => {
        const nextType = e.target.value as RevisionEditType;
        apply((c) => retypeChange(c, nextType, mpp));
        useRevisionUi.setState({ editSide: 'both' });
        const updated = retypeChange(change, nextType, mpp);
        const missingSide = sidesOf(nextType).find(side => !updated.walls.some(w => w.side === side));
        if (familyOf(nextType) === 'wall' && missingSide) startManualChangeDrawing(nextType, { changeId: change.id, side: missingSide });
      }}>
        {EDIT_TYPES.map((x) => <option key={x} value={x}>{t(revisionTypeLabelKey(x, comparison?.context, language))}</option>)}
      </select>
      {sides.length === 2 && (
        <div className="segmented-tabs small">
          {(['both', 'removed', 'added'] as const).map((side) => (
            <button key={side} className={editSide === side ? 'active' : ''} aria-pressed={editSide === side} onClick={() => useRevisionUi.setState({ editSide: side })}>
              {t(`revisionAi.edit.side.${side}`)}
            </button>
          ))}
        </div>
      )}
      {family !== 'other' && (
        <ul className="revision-edit-elements">
          {elements.map((el) => (
            <li key={el.key} className={elementWorkKinds(change, el.list, el.index).map(kind => `work-${kind}`).join(' ')}>
              {el.list === 'walls' && <input type="checkbox" aria-label={t('revisionAi.edit.selectRegion')}
                checked={selectedWalls.some(ref => ref.changeId === change.id && ref.index === el.index)}
                onChange={() => useRevisionUi.getState().selectWallRegion(change.id, el.index, true)} />}
              <WorkLabels kinds={elementWorkKinds(change, el.list, el.index)} />
              <span className="revision-edit-side">{t(el.side === 'removed' ? 'revisionAi.before' : 'revisionAi.after')}</span>
              <span className="revision-edit-label" dir="auto">{el.list === 'walls' && mpp
                ? t('revisionAi.edit.wallDimensions', { length: round(change.walls[el.index].lengthPx * mpp, 2), thickness: round(change.walls[el.index].thicknessPx * mpp * 100, 1) })
                : <>{el.label} · {length(el.a, el.b)}</>}</span>
              {el.list === 'doors' && (
                <label className="revision-edit-height" title={t('revisionAi.edit.height')}>
                  <input type="number" inputMode="decimal" min={0.1} step={0.05} dir="ltr"
                    value={el.heightM ?? ((isOpeningDifference(change) || change.doors[el.index]?.footprint) ? '' : OPENING_DEFAULT_SIZES[el.opening ?? 'door'].heightM)}
                    aria-label={t('revisionAi.edit.height')}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      edit(change.pageNumber, change.id, (c) => setOpeningHeight(c, el.index, v > 0 ? v : undefined), true);
                    }}
                    onBlur={finishEdit} />
                  <span aria-hidden="true">{t('revisionAi.edit.heightUnit')}</span>
                </label>
              )}
              <button className="btn-ghost small icon-only" aria-label={t('markup.delete')} title={t('markup.delete')}
                onClick={() => apply((c) => removeElement(c, { list: el.list, index: el.index }))}>
                <Icon name="trash" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {family === 'wall' && (
        <div className="revision-actions">
          {sides.map((side) => (
            <button key={side} className="btn-ghost small" onClick={() => startManualChangeDrawing(type, { changeId: change.id, side })}>
              <Icon name="plus" size={12} /> {t('compare.openingImpact.drawWall')} · {t(`revisionAi.work.${elementWorkKind('walls', side)}`)} · {t(side === 'removed' ? 'revisionAi.before' : 'revisionAi.after')}
            </button>
          ))}
        </div>
      )}
      {family === 'opening' && <div className="revision-actions">
        {sides.filter(side => !change.doors.some(d => d.side === side && openingFootprint(d))).map(side =>
          <button key={side} className="btn-secondary small" title={t('compare.openingImpact.drawOpeningHint')}
            onClick={() => startManualChangeDrawing(type, { changeId: change.id, side })}>
            <Icon name="rectangle" size={12} /> {t('compare.openingImpact.drawOpening')} · {t(`revisionAi.work.${elementWorkKind('doors', side)}`)} · {t(side === 'removed' ? 'revisionAi.before' : 'revisionAi.after')}
          </button>)}
      </div>}
      {(isOpeningDifference(change) || change.doors.some(d => d.footprint)) && change.doors.map((d, index) => <div key={`impact-${index}`} className="revision-section">
        <strong className="field-label">{t(d.side === 'removed' ? 'revisionAi.before' : 'revisionAi.after')} · {index + 1}</strong>
        <select aria-label={t('revisionAi.edit.type')} value={d.opening ?? ''}
          onChange={e => { const kind = e.target.value as 'door' | 'window'; apply(c => ({ ...c, doors: c.doors.map((door,i) => i === index ? { ...door, opening: kind, impactVerified: false } : door) })); }}>
          <option value="" disabled>{t('revisionAi.categories.opening')}</option>
          <option value="door">{t('revisionAi.edit.door')}</option><option value="window">{t('revisionAi.edit.window')}</option>
        </select>
        <label className="revision-edit-height">{t('compare.openingImpact.thickness')}
          <input type="number" inputMode="decimal" min={0.1} step={0.5} dir="ltr" disabled={!mpp}
            value={mpp && openingWallThicknessPx(change, d) > 0 ? round(openingWallThicknessPx(change, d) * mpp * 100, 2) : ''}
            onChange={e => { const value = Number(e.target.value); edit(change.pageNumber, change.id, c => setOpeningThickness(c, index, value > 0 ? value / 100 / mpp : undefined), true); }}
            onBlur={finishEdit} />
        </label>
        {d.opening === 'window' && <label className="revision-edit-height">{t('compare.openingImpact.sill')}
          <input type="number" min={0} step={0.05} dir="ltr" value={d.sillHeightM ?? ''}
            onChange={e => { const value = e.target.value === '' ? undefined : Number(e.target.value); edit(change.pageNumber, change.id, c => ({ ...c, doors: c.doors.map((door, i) => i === index ? { ...door, sillHeightM: value, impactVerified: false } : door) }), true); }} onBlur={finishEdit} />
        </label>}
        <label className="source-color-toggle">
          <input type="checkbox" checked={d.impactVerified === true}
            disabled={!mpp || !d.opening || d.placeholder || !(d.heightM && d.heightM > 0) || !(openingWallThicknessPx(change, d) > 0) || (d.opening === 'window' && d.sillHeightM == null)}
            onChange={e => { const verified = e.target.checked; apply(c => ({ ...c, doors: c.doors.map((door, i) => i === index ? { ...door, impactVerified: verified, ...(door.footprint ? { geometryVerified: verified } : {}) } : door) })); }} />
          {t('compare.openingImpact.verify')}
        </label>
      </div>)}
      {(isOpeningDifference(change) && !openingImpactReady(change) || openingGeometryNeedsVerification(change)) && <p className="cal-hint-warning revision-warning">{t('compare.openingImpact.required')}</p>}
      {change.aiProposal && family === 'opening' && sides.some(side => !change.doors.some(d => d.side === side && openingFootprint(d))) &&
        <p className="cal-hint-warning revision-warning">{t('compare.openingImpact.geometryMissing')}</p>}
      {!mpp && family !== 'other' && <p className="cal-hint-warning revision-warning"><Icon name="alert" size={13} /> {t('revisionAi.edit.uncalibrated')}</p>}
    </div>
  );
}

/** Selecting a manual classification arms its drawing tool. */
function AddMissedChange() {
  const t = useT();
  const language = useLanguage();
  const context = useCompareStore(s => s.comparison?.context);
  const placingType = useRevisionUi((s) => s.placingType);
  const [type, setType] = useState<RevisionEditType>('wall-added');
  return (
    <div className="revision-add-missed">
      <div className="revision-add-row">
        <select value={type} onChange={(e) => {
          const nextType = e.target.value as RevisionEditType;
          setType(nextType);
          startManualChangeDrawing(nextType);
        }} aria-label={t('revisionAi.edit.type')}>
          {EDIT_TYPES.map((x) => <option key={x} value={x}>{t(revisionTypeLabelKey(x, context, language))}</option>)}
        </select>
        <button className={placingType ? 'btn-primary small' : 'btn-secondary small'} aria-pressed={!!placingType}
          onClick={() => placingType ? useRevisionUi.setState({ placingType: null, placingWall: null }) : startManualChangeDrawing(type)}>
          <Icon name="plus" size={12} /> {placingType ? t('revisionAi.edit.cancelPlacing') : t('revisionAi.edit.addMissed')}
        </button>
      </div>
      {placingType && <p className="tool-hint"><Icon name="alert" size={13} /> {t(placingType.startsWith('wall') ? 'revisionAi.edit.drawWallHint' : familyOf(placingType) === 'opening' ? 'compare.openingImpact.chooseShapeHint' : 'revisionAi.edit.placeHint')}</p>}
    </div>
  );
}

function quantityReady(c: RevisionChange): boolean {
  if (!openingImpactReady(c) || openingGeometryNeedsVerification(c)) return false;
  if (hasUnplacedLines(c) || c.wallCandidates?.length) return false;
  if (c.aiProposal && !c.edited && c.aiProposal.verification !== 'verified') return false;
  return c.walls.length > 0 || c.doors.length > 0;
}

function ChangeList({ readOnly }: { readOnly: boolean }) {
  const t = useT();
  const { analysis, stale } = useActiveAnalysis();
  const filter = useRevisionUi((s) => s.filter);
  const setFilter = useRevisionUi((s) => s.setFilter);
  const review = useCompareStore((s) => s.reviewRevisionChange);
  const selectedId = useRevisionUi((s) => s.selectedChangeId);
  if (!analysis) return (
    <div className="revision-list">
      <div className="empty-state"><Icon name="scan" size={24} /><p>{t('revisionAi.page.notRun')}</p></div>
      {!readOnly && <AddMissedChange />}
    </div>
  );
  const numbers = new Map(analysis.changes.map((c, i) => [c.id, i + 1]));
  const shown = visibleChanges(analysis.changes, filter);
  const selected = analysis.changes.find((c) => c.id === selectedId);
  if (selected && !shown.includes(selected)) shown.push(selected);
  // "Approve all" only approves geometry that is measured: AI locations that were not verified in the
  // drawing, unconfirmed wall lines and unplaced lines each need the user's own decision.
  const pendingHigh = analysis.changes.filter((c) => c.status === 'pending' && c.significance === 'high' && quantityReady(c));
  return (
    <div className="revision-list">
      {stale && <div className="cal-hint-warning revision-warning"><Icon name="alert" size={13} /> {t('revisionAi.detect.stale')}</div>}
      <div className="segmented-tabs small">
        {(['high', 'meaningful', 'all'] as ChangeFilter[]).map((f) => (
          <button key={f} className={filter === f ? 'active' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>{t(`revisionAi.filter.${f}`)}</button>
        ))}
      </div>
      <p className="muted small-text">
        {t('revisionAi.counts', { shown: shown.length, hidden: analysis.changes.length - shown.length, filtered: analysis.filteredCount })}
      </p>
      {!readOnly && <AddMissedChange />}
      {!readOnly && !stale && pendingHigh.length > 1 && (
        <button className="btn-secondary small" onClick={() => pendingHigh.forEach((c) => review(c.pageNumber, c.id, 'approved'))}>
          <Icon name="check" size={12} /> {t('revisionAi.actions.approveAllHigh')} ({pendingHigh.length})
        </button>
      )}
      {shown.length === 0 ? (
        <div className="empty-state"><p>{t('revisionAi.detect.nothingFound')}</p></div>
      ) : (
        <ul className="revision-cards">
          {/* The user's own corrections are not detection output, so a stale result does not lock them. */}
          {shown.map((c) => <ChangeCard key={c.id} change={c} number={numbers.get(c.id) ?? 0} readOnly={readOnly || (stale && !c.manual && !c.edited)} />)}
        </ul>
      )}
    </div>
  );
}

function ApplySection({ readOnly }: { readOnly: boolean }) {
  const t = useT();
  const comparison = useCompareStore((s) => s.comparison);
  const setLinkedPlanId = useCompareStore((s) => s.setLinkedPlanId);
  const projectPlans = useAppStore((s) => s.projectPlans);
  const applying = useRevisionUi((s) => s.applying);
  const planTick = useRevisionUi((s) => s.planTick);
  const [link, setLink] = useState<LinkStatus | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const linkedPlanId = comparison?.linkedPlanId;

  useEffect(() => {
    let cancelled = false;
    setLink(null);
    setPlan(null);
    if (!comparison || !linkedPlanId) return;
    void checkPlanLink(comparison, linkedPlanId).then((s) => { if (!cancelled) setLink(s); });
    void loadPlan(linkedPlanId).then((p) => { if (!cancelled) setPlan(p ?? null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparison?.id, linkedPlanId, planTick]);

  if (!comparison) return null;
  const revision = comparison.revisions.find((r) => r.id === comparison.activeRevisionId);
  const plans = projectPlans.filter((p) => !comparison.projectId || p.projectId === comparison.projectId);
  const pending = revision ? pendingApplication(revision).length : 0;
  const history = (plan?.revisionApplications ?? []).filter((a) => a.comparisonId === comparison.id).slice().reverse();
  // Only the plan's latest application (from any comparison) can be reverted without wiping a later one.
  const latestApplied = plan ? latestApplication(plan) : undefined;
  const revisionLabel = (id: string) => comparison.revisions.find((r) => r.id === id)?.label ?? '-';

  return (
    <section className="revision-section">
      <h4>{t('revisionAi.apply.title')}</h4>
      <label className="field-label">{t('revisionAi.apply.plan')}</label>
      {plans.length === 0 ? <p className="muted">{t('revisionAi.apply.noPlans')}</p> : (
        <select disabled={readOnly} value={linkedPlanId ?? ''} onChange={(e) => setLinkedPlanId(e.target.value || undefined)}>
          <option value="">{t('revisionAi.apply.choosePlan')}</option>
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
      {link === 'different-file' && <p className="cal-hint-warning revision-warning"><Icon name="alert" size={13} /> {t('revisionAi.apply.differentFile')}</p>}
      {link === 'missing' && <p className="cal-hint-warning revision-warning"><Icon name="alert" size={13} /> {t('revisionAi.apply.missing')}</p>}
      {!readOnly && (
        <button className="btn-primary small" title={link === 'same-file' ? t('revisionAi.apply.sameFile') : undefined} disabled={applying || link !== 'same-file' || pending === 0} onClick={() => void applyApprovedChanges()}>
          {applying ? t('revisionAi.apply.preparing') : t('revisionAi.apply.run', { count: pending })}
        </button>
      )}
      {history.length > 0 && (
        <div className="revision-history">
          <strong>{t('revisionAi.apply.history')}</strong>
          <ul>
            {history.map((a) => (
              <li key={a.id} className={a.status}>
                <span>{t('revisionAi.apply.historyItem', { revision: revisionLabel(a.revisionId), date: new Date(a.appliedAt).toLocaleString(), count: a.changes.length })}</span>
                {a.status === 'reverted' && <span className="muted"> · {t('revisionAi.apply.reverted')}</span>}
                {!readOnly && a.id === latestApplied?.id && (
                  <button className="btn-ghost small" onClick={() => void revertRevisionApplication(a.id)}>
                    <Icon name="undo" size={12} /> {t('revisionAi.apply.revert')}
                  </button>
                )}
                {a.status === 'applied' && a.reviews.length > 0 && (
                  <details open={a.id === history[0]?.id}>
                    <summary>{t('revisionAi.apply.reviews')} ({a.reviews.length})</summary>
                    <ul>{a.reviews.map((r, i) => <li key={i} dir="auto">{r.reason}</li>)}</ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function DetectTools({ readOnly }: { readOnly: boolean }) {
  const t = useT();
  const comparison = useCompareStore((s) => s.comparison);
  const setContext = useCompareStore((s) => s.setComparisonContext);
  const setBase = useCompareStore((s) => s.setRevisionBase);
  const detecting = useRevisionUi((s) => s.detecting);
  const progress = useRevisionUi((s) => s.progress);
  const step = useRevisionUi((s) => s.step);
  const aiBusy = useRevisionUi((s) => s.aiBusy);
  const { analysis, stale } = useActiveAnalysis();
  if (!comparison) return null;
  const context = comparison.context ?? 'design';
  const index = comparison.revisions.findIndex((r) => r.id === comparison.activeRevisionId);
  const revision = comparison.revisions[index];
  const earlier = comparison.revisions.slice(0, Math.max(0, index));
  const q = analysis?.manualOnly ? undefined : analysis?.alignment;
  const aiRunning = analysis?.ai?.status === 'PROCESSING';

  return (
    <div className="revision-tools">
      <section className="revision-section">
        <label className="field-label">{t('revisionAi.context.label')}</label>
        <div className="segmented-tabs small">
          {(['design', 'construction'] as const).map((c) => (
            <button key={c} disabled={readOnly} title={t(c === 'design' ? 'revisionAi.context.designHint' : 'revisionAi.context.constructionHint')} className={context === c ? 'active' : ''} aria-pressed={context === c} onClick={() => setContext(c)}>
              {t(`revisionAi.context.${c}`)}
            </button>
          ))}
        </div>
        {revision && (
          <>
            <label className="field-label">{t('revisionAi.base.label')}</label>
            <select disabled={readOnly} value={revision.baseRevisionId ?? ''} onChange={(e) => setBase(revision.id, e.target.value || null)}>
              <option value="">{t('revisionAi.base.original')}</option>
              {earlier.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </>
        )}
      </section>

      <section className="revision-section">
        {!readOnly && (
          <button className="btn-primary small" title={`${t('revisionAi.intro')}\n${t('revisionAi.page.intro')}`} disabled={detecting || aiBusy || aiRunning || !revision} onClick={() => void runAiPageAnalysis()}>
            <Icon name="scan" size={13} /> {aiRunning ? t('revisionAi.page.running') : analysis?.ai?.task === 'page' && analysis.ai.status === 'COMPLETED' && !stale ? t('revisionAi.page.rerun') : t('revisionAi.page.run')}
          </button>
        )}
        {detecting && step && (
          <div className="revision-progress">
            <div className="revision-progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
            <span className="muted small-text">{t(`revisionAi.detect.steps.${step}`)}</span>
          </div>
        )}
        {q && (
          <div className={`revision-quality ${q.status}`} title={[
            t('revisionAi.alignment.residual', { px: q.residualPx }),
            q.residualMm != null ? t('revisionAi.alignment.residualMm', { mm: q.residualMm }) : '',
            t('revisionAi.alignment.inliers', { percent: Math.round(q.inlierRatio * 100) }),
            (q.correction.dx !== 0 || q.correction.dy !== 0) && q.status !== 'poor'
              ? t('revisionAi.alignment.corrected', { dx: q.correction.dx, dy: q.correction.dy }) : '',
          ].filter(Boolean).join('\n')}>
            <Icon name={q.status === 'good' ? 'check' : 'alert'} size={13} />
            <strong>{t('revisionAi.alignment.title')}: {t(`revisionAi.alignment.${q.status}`)}</strong>
          </div>
        )}
        {q?.status === 'poor' && <span className="cal-hint-warning revision-warning">{t('revisionAi.alignment.poorHint')}</span>}
        {analysis?.ai?.status === 'FAILED' && analysis.ai.error && q?.status !== 'poor' && (
          <p className="cal-hint-warning revision-warning">{t('revisionAi.ai.failed', { error: analysis.ai.error })}</p>
        )}
      </section>

      <ApplySection readOnly={readOnly} />
    </div>
  );
}

/** The change-detection tab: proposals at the inline start, detection/AI/apply controls at the inline end. */
function OpeningDrawingControls() {
  const t = useT();
  const language = useLanguage();
  const type = useRevisionUi(s => s.placingType);
  const mode = useRevisionUi(s => s.openingDrawingMode);
  const draft = useRevisionUi(s => s.openingDrawing);
  if (!type || !['opening', 'wall'].includes(familyOf(type))) return null;
  return <section className="revision-opening-drawing-controls" data-opening-drawing-controls dir={LANGUAGES[language].dir}>
    <strong>{t(familyOf(type) === 'wall' ? 'compare.openingImpact.drawWall' : 'compare.openingImpact.drawOpening')}</strong>
    <AreaShapePicker value={mode} shapes={['rectangle', 'polygon']} compact onChange={shape => {
      if (shape !== 'line') useRevisionUi.setState({ openingDrawingMode: shape });
    }} />
    <div className="segmented">
      {(['removed', 'added'] as const).map(side => <button key={side}
        className={draft?.side === side ? 'tool-btn active' : 'tool-btn'}
        aria-pressed={draft?.side === side} disabled={!draft?.sides.includes(side)}
        onClick={() => draft?.selectSide(side)}>
        <WorkLabels kinds={[elementWorkKind(familyOf(type) === 'wall' ? 'walls' : 'doors', side)]} />
        <span className="revision-edit-side">{t(side === 'removed' ? 'revisionAi.before' : 'revisionAi.after')}</span>
      </button>)}
    </div>
    <p className={draft?.error ? 'cal-hint-warning revision-warning' : 'tool-hint'}>
      {draft?.error ? t('compare.openingImpact.invalidShape') : mode === 'rectangle' ? t('measure.hintRectangle') : t('compare.openingImpact.polygonHint')}
    </p>
    <div className="revision-actions">
      <button className="btn-primary small" disabled={mode !== 'polygon' || !draft || draft.pointCount < 3}
        onClick={() => draft?.finish()}>{t('compare.openingImpact.finish')}</button>
      <button className="btn-secondary small" disabled={!draft?.pointCount}
        onClick={() => draft?.back()}>{t('compare.openingImpact.backPoint')}</button>
      <button className="btn-ghost small" onClick={() => useRevisionUi.setState({ placingType: null, placingWall: null })}>
        {t('revisionAi.edit.cancelPlacing')}
      </button>
    </div>
  </section>;
}

function WallMergeControls({ analysis, disabled }: { analysis: RevisionPageAnalysis | undefined; disabled: boolean }) {
  const t = useT();
  const selection = useRevisionUi(s => s.selectedWallRegions);
  const preview = useRevisionUi(s => s.wallMergePreview);
  const comparison = useCompareStore(s => s.comparison);
  const pageKey = useCompareStore(s => s.currentPageKey);
  const merge = useCompareStore(s => s.mergeWallRegions);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setError(null); }, [selection]);
  useEffect(() => { useRevisionUi.setState({ wallMergePreview: null }); }, [comparison, selection, pageKey]);
  if (selection.length < 2) return null;
  const regions = selection.map(ref => {
    const change = analysis?.changes.find(c => c.id === ref.changeId);
    return { change, wall: change?.walls[ref.index] };
  });
  const compatible = regions.every(({ change, wall }) => change && wall && !wall.placeholder && !change.doors.length
    && change.status !== 'applied' && change.status === regions[0].change?.status && wall.side === regions[0].wall?.side);
  const performMerge = (confirmationKey?: string) => {
    const result = merge(pageKey, selection, confirmationKey);
    if ('error' in result) {
      if (result.preview && comparison) {
        setError(null);
        useRevisionUi.setState({ wallMergePreview: { ...result.preview, comparisonId: comparison.id, revisionId: comparison.activeRevisionId, pageKey }, markersVisible: true });
      } else {
        useRevisionUi.setState({ wallMergePreview: null });
        setError(t(`revisionAi.edit.mergeErrors.${result.error}`));
      }
    } else {
      useRevisionUi.getState().selectChange(result.changeId);
      useRevisionUi.setState({ selectedWallRegions: [{ changeId: result.changeId, index: 0 }] });
    }
  };
  return <section className="revision-selection-detail">
    <p className="tool-hint">{t('revisionAi.edit.mergeHint')}</p>
    {!preview && <button className="btn-secondary small" disabled={disabled || !compatible}
      onClick={() => performMerge()}>{t('revisionAi.edit.mergeRegions')}</button>}
    {preview && <div role="region" aria-label={t('revisionAi.edit.gapPreviewTitle')}>
      <p className="revision-warning">{t('revisionAi.edit.gapPreview', { count: preview.connectors.length, gapCm: round(Math.max(...preview.gapLengthsM) * 100, 1) })}</p>
      <div className="revision-actions">
        <button className="btn-primary small" disabled={disabled || !compatible}
          onClick={() => performMerge(preview.confirmationKey)}>{t('revisionAi.edit.confirmGapFill')}</button>
        <button className="btn-ghost small" onClick={() => useRevisionUi.setState({ wallMergePreview: null })}>{t('revisionAi.edit.cancelPlacing')}</button>
      </div>
    </div>}
    {!compatible && <p className="revision-warning">{t('revisionAi.edit.mergeErrors.incompatible')}</p>}
    {error && <p className="revision-warning" role="alert">{error}</p>}
  </section>;
}

export default function RevisionDetectPanel({ part, readOnly = false }: { part: PanelPart; readOnly?: boolean }) {
  const t = useT();
  const { analysis, stale } = useActiveAnalysis();
  const selectedId = useRevisionUi((s) => s.selectedChangeId);
  const editingId = useRevisionUi((s) => s.editingChangeId);
  const comparison = useCompareStore((s) => s.comparison);
  const selected = analysis?.changes.find((c) => c.id === selectedId);
  const locked = readOnly || selected?.status === 'applied' || (stale && !selected?.manual && !selected?.edited);
  const scale = compareScaleFor(comparison, selected?.pageNumber ?? 1);
  const items = selected && scale.state === 'calibrated'
    ? changeItems(selected, comparison?.context ?? 'design', scale.metersPerPixel, comparison?.wallHeightDefaultM ?? 0) : [];
  const relocation = selected && scale.state === 'calibrated' && comparison?.context !== 'construction'
    ? relocationQuantities(selected, scale.metersPerPixel, comparison?.wallHeightDefaultM ?? 0) : null;
  return part === 'list' ? <ChangeList readOnly={readOnly} /> : <>
    {!readOnly && <OpeningDrawingControls />}
    {!readOnly && <WallMergeControls analysis={analysis} disabled={!!locked} />}
    {selected && <section className="revision-selection-detail">
      <strong>{t('revisionAi.edit.selected', { number: (analysis?.changes.indexOf(selected) ?? 0) + 1 })}</strong>
      {!locked && editingId === selected.id && <ChangeEditor change={selected} />}
      {!readOnly && (selected.status === 'applied' || (!locked && editingId !== selected.id)) && <SwapVersionsButton change={selected} />}
      <div className="revision-quantity-preview">
        <strong title={selected.status !== 'approved' && selected.status !== 'applied' ? t('revisionAi.edit.previewHint') : undefined}>{t('revisionAi.edit.quantityPreview')}</strong>
        {selected && isOpeningDifference(selected) && !openingImpactReady(selected) ? <p className="revision-warning cal-hint-warning">{t('compare.openingImpact.required')}</p>
          : selected && isOpeningDifference(selected) && comparison?.context !== 'construction' && scale.state === 'calibrated'
            ? <div>{t('compare.openingImpact.delta', { area: openingImpact(selected, scale.metersPerPixel).designDeltaM2 })}</div>
          : relocation ? <div>{t('revisionAi.designDifference', { delta: relocation.deltaAreaM2 })}</div> : items.length ? items.map((item, i) => <div key={i}>{t(`areaKinds.${item.areaKind}`)} · {round(item.areaM2, 2)} {t('units.m2')}</div>)
          : <p className="muted small-text">{t('revisionAi.edit.noPreviewItems')}</p>}
      </div>
    </section>}
    <div className="revision-legend" title={t('revisionAi.edit.legend')}><WorkLabels kinds={['construction', 'demolition']} /></div>
    <DetectTools readOnly={readOnly} />
  </>;
}
