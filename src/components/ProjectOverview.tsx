import ProjectStructuralSummary from './ProjectStructuralSummary';
import { buildProjectStructural, finishesSummaryMode } from '../lib/structuralQuantities';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { formatDate, formatNumber, useLanguage, useT, type TranslateFn } from '../i18n';
import { useAppStore } from '../store/appStore';
import { buildProjectQuantities, planStatusLabel, type CategoryAmount } from '../lib/projectQuantities';
import { exportProjectToExcel } from '../lib/exportProjectExcel';
import { exportProjectToPdf } from '../lib/exportProjectPdf';
import { projectExportDetails, trackedExport } from '../lib/analytics';
import { notifyExportFailed } from '../lib/exportFailure';
import Icon from './Icon';
import ExportContentPicker from './ExportContentPicker';
import { everything, hasAnyContent, type ExportContent } from '../lib/exportContent';
import { BrandHomeLink } from './BrandLogo';
import NewComparisonDialog from './compare/NewComparisonDialog';
import LanguageSwitch from './LanguageSwitch';
import type { Comparison } from '../types/compare';

/** What a comparison row says: which flat, how many revised plans, when it was last touched. */
function comparisonMeta(c: Comparison, t: TranslateFn): string {
  const parts: string[] = [];
  if (c.apartmentNumber) parts.push(t('projectOverview.comparisonMeta.apartment', { apartment: c.apartmentNumber }));
  parts.push(
    c.revisions.length === 0
      ? t('projectOverview.comparisonMeta.noRevision')
      : c.revisions.length === 1
        ? t('projectOverview.comparisonMeta.oneRevision')
        : t('projectOverview.comparisonMeta.revisions', { count: c.revisions.length })
  );
  parts.push(t('projectOverview.comparisonMeta.updated', { date: formatDate(c.updatedAt) }));
  return parts.join(' · ');
}

const DASH = '-';
const fmt = (v: number | null) => (v == null ? DASH : formatNumber(v));

/** The main reading of an amount: running metres for skirting, m² for everything else. */
function primary(a: CategoryAmount, t: TranslateFn): string {
  return a.lengthM != null ? `${fmt(a.lengthM)} ${t('units.lm')}` : `${fmt(a.quantityM2)} ${t('units.m2')}`;
}
function primaryOrder(a: CategoryAmount, t: TranslateFn): string {
  return a.orderLengthM != null ? `${fmt(a.orderLengthM)} ${t('units.lm')}` : `${fmt(a.orderM2)} ${t('units.m2')}`;
}

/**
 * A project's home: its plans (open, add, rename, duplicate, delete), the project-wide quantity
 * summary with each total expandable into per-plan contributions, and the project exports.
 * Everything shown is computed from the saved plans by lib/projectQuantities.
 */
export default function ProjectOverview() {
  const t = useT();
  const project = useAppStore((s) => s.currentProject);
  const plans = useAppStore((s) => s.projectPlans);
  const closeProject = useAppStore((s) => s.closeProject);
  const renameProject = useAppStore((s) => s.renameProject);
  const openPlan = useAppStore((s) => s.openPlan);
  const addPlan = useAppStore((s) => s.addPlan);
  const duplicatePlan = useAppStore((s) => s.duplicatePlan);
  const deletePlan = useAppStore((s) => s.deletePlan);
  const renamePlan = useAppStore((s) => s.renamePlan);
  const refreshProjectPlans = useAppStore((s) => s.refreshProjectPlans);
  const comparisons = useAppStore((s) => s.projectComparisons);
  const createComparison = useAppStore((s) => s.createComparison);
  const openComparison = useAppStore((s) => s.openComparison);
  const renameComparison = useAppStore((s) => s.renameComparison);
  const deleteComparison = useAppStore((s) => s.deleteComparison);
  const [addingComparison, setAddingComparison] = useState(false);

  // Coming back from a plan or a comparison always shows what was just saved there.
  useEffect(() => {
    void refreshProjectPlans();
  }, [refreshProjectPlans]);

  const language = useLanguage();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the labels inside depend on the UI language
  const quantities = useMemo(() => buildProjectQuantities(plans), [plans, language]);
  const structural = useMemo(() => buildProjectStructural(plans), [plans]);
  const summaryMode = finishesSummaryMode(quantities.totals.length, structural);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // The project export asks what to include: Finishes, Concrete, Rebar (no plan drawings here).
  const [exportDialog, setExportDialog] = useState<{ kind: 'excel' | 'pdf'; content: ExportContent } | null>(null);
  const exportAvailable: ExportContent = {
    plan: false,
    // Finishes is offered whenever there are rooms - and for a project with nothing at all, so the old empty report still exports.
    finishes: plans.some((p) => p.rooms.length > 0) || !(structural.concrete || structural.rebar),
    concrete: !!structural.concrete,
    rebar: !!structural.rebar,
  };

  if (!project) return null;

  const isEmpty = plans.length === 0 && comparisons.length === 0;

  const toggle = (category: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  // A failed project export is reported to the user (and to analytics by trackedExport) — `run`
  // itself only manages the busy state.
  const runProjectExport = async (kind: 'project_excel' | 'project_pdf', exportFn: () => Promise<void>) => {
    try {
      await trackedExport({ export_kind: kind, surface: 'overview', ...projectExportDetails(project.id, plans) }, exportFn);
    } catch (err) {
      notifyExportFailed(err);
    }
  };

  const onRename = (planId: string, current: string) => {
    const next = window.prompt(t('projectOverview.renamePlanPrompt'), current);
    if (next && next.trim() && next.trim() !== current) void renamePlan(planId, next.trim());
  };

  const onDelete = (planId: string, name: string) => {
    if (!confirm(t('projectOverview.deletePlanConfirm', { name }))) return;
    void deletePlan(planId);
  };

  const onRenameComparison = (comparisonId: string, current: string) => {
    const next = window.prompt(t('projectOverview.renameComparisonPrompt'), current);
    if (next && next.trim() && next.trim() !== current) void renameComparison(comparisonId, next.trim());
  };

  const onDeleteComparison = (comparisonId: string, name: string) => {
    if (!confirm(t('projectOverview.deleteComparisonConfirm', { name }))) return;
    void deleteComparison(comparisonId);
  };

  return (
    <div className="workspace home">
      <div className="top-bar">
        <div className="top-bar-group identity">
          <BrandHomeLink title={t('topBar.goHome')} />
          <input
            className="project-name-input"
            dir="auto"
            value={project.name}
            onChange={(e) => renameProject(e.target.value)}
            title={t('projectOverview.projectName')}
          />
        </div>
        <div className="top-bar-group grow" />
        <div className="top-bar-group output">
          <button className="btn-ghost small" onClick={() => void closeProject()} title={t('projectOverview.backToProjects')}>
            <Icon name="exit" />
            <span className="btn-label">{t('projectOverview.projects')}</span>
          </button>
          <LanguageSwitch />
        </div>
      </div>

      <div className="home-body">
        {isEmpty ? (
          // A new project holds nothing yet: the user explicitly picks which workflow to start.
          <div className="home-content project-overview">
            <div className="home-panel project-start">
              <div className="home-panel-text">
                <h2>{t('projectOverview.startTitle')}</h2>
                <p className="muted">{t('projectOverview.startIntro')}</p>
              </div>
              <div className="project-start-options">
                <button className="project-start-option" onClick={() => setAdding(true)} disabled={!!busy}>
                  <Icon name="map" size={22} />
                  <span className="project-start-title">{t('projectOverview.newPlanTitle')}</span>
                  <span className="project-start-desc muted">{t('projectOverview.newPlanDesc')}</span>
                </button>
                <button className="project-start-option" onClick={() => setAddingComparison(true)} disabled={!!busy}>
                  <Icon name="layers" size={22} />
                  <span className="project-start-title">{t('projectOverview.newComparisonTitle')}</span>
                  <span className="project-start-desc muted">{t('projectOverview.newComparisonDesc')}</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="home-content project-overview">
            <div className="home-panel">
              <div className="home-panel-head">
                <div className="home-panel-text">
                  <h2>{t('projectOverview.takeoffTitle')}</h2>
                  <p className="muted">{t('projectOverview.takeoffIntro')}</p>
                </div>
                {/* The project exports cover the quantity plans only, so they live in this panel. */}
                <div className="panel-head-actions">
                  <button
                    className="btn-secondary"
                    disabled={!!busy || plans.length === 0}
                    onClick={() => setExportDialog({ kind: 'excel', content: everything(exportAvailable) })}
                    title={t('projectOverview.excelHint')}
                  >
                    <Icon name="sheet" />
                    {busy === 'excel' ? t('common.exporting') : t('projectOverview.excel')}
                  </button>
                  <button
                    className="btn-secondary"
                    disabled={!!busy || plans.length === 0}
                    onClick={() => setExportDialog({ kind: 'pdf', content: everything(exportAvailable) })}
                    title={t('projectOverview.pdfHint')}
                  >
                    <Icon name="download" />
                    {busy === 'pdf' ? t('common.exporting') : t('projectOverview.pdf')}
                  </button>
                  <button className="btn-primary" onClick={() => setAdding(true)} disabled={!!busy}>
                    <Icon name="plus" />
                    {t('projectOverview.newPlan')}
                  </button>
                </div>
              </div>

              {plans.length === 0 ? (
                <div className="empty-state">
                  <Icon name="file" size={24} />
                  <p>{t('projectOverview.noPlans')}</p>
                </div>
              ) : (
                <ul className="saved-list plan-list">
                  {quantities.plans.map((r) => (
                    <li key={r.plan.id} onClick={() => void openPlan(r.plan.id)} title={t('projectOverview.openPlan')}>
                      <Icon name="map" />
                      <span className="saved-list-text">
                        <span className="saved-list-name" dir="auto">{r.plan.name}</span>
                        <span className="saved-list-meta">
                          {r.calibratedPageCount > 0
                            ? t('projectOverview.planMeta', { rooms: r.roomCount, pages: r.calibratedPageCount })
                            : t('projectOverview.planMetaUncalibrated', { rooms: r.roomCount })}
                        </span>
                      </span>
                      <span className={`plan-status plan-status-${r.status}`}>{planStatusLabel(r.status)}</span>
                      <span className="list-item-actions" onClick={(e) => e.stopPropagation()}>
                        <button className="icon-btn" title={t('projectOverview.rename')} onClick={() => onRename(r.plan.id, r.plan.name)}>
                          <Icon name="text" />
                        </button>
                        <button
                          className="icon-btn"
                          title={t('projectOverview.duplicatePlan')}
                          disabled={!!busy}
                          onClick={() => void run('dup', () => duplicatePlan(r.plan.id))}
                        >
                          <Icon name="copy" />
                        </button>
                        <button className="icon-btn danger" title={t('projectOverview.deletePlan')} onClick={() => onDelete(r.plan.id, r.plan.name)}>
                          <Icon name="trash" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="home-panel">
              <div className="home-panel-head">
                <div className="home-panel-text">
                  <h2>{t('projectOverview.compareTitle')}</h2>
                  <p className="muted">{t('projectOverview.compareIntro')}</p>
                </div>
                <button className="btn-primary" onClick={() => setAddingComparison(true)} disabled={!!busy}>
                  <Icon name="plus" />
                  {t('projectOverview.newComparison')}
                </button>
              </div>

              {comparisons.length === 0 ? (
                <div className="empty-state">
                  <Icon name="layers" size={24} />
                  <p>{t('projectOverview.noComparisons')}</p>
                </div>
              ) : (
                <ul className="saved-list plan-list">
                  {comparisons.map((c) => (
                    <li key={c.id} onClick={() => void openComparison(c.id)} title={t('projectOverview.openComparison')}>
                      <Icon name="layers" />
                      <span className="saved-list-text">
                        <span className="saved-list-name" dir="auto">{c.name}</span>
                        <span className="saved-list-meta">{comparisonMeta(c, t)}</span>
                      </span>
                      {/* TODO: "Move to Project" for comparisons — reassign `projectId` and move the id between the
                          two projects' `comparisonIds`. Also the way to fold legacy comparisons, which the
                          migration wrapped into one project each (`legacy-cmp-*`), into their real project. */}
                      <span className="list-item-actions" onClick={(e) => e.stopPropagation()}>
                        <button className="icon-btn" title={t('projectOverview.rename')} onClick={() => onRenameComparison(c.id, c.name)}>
                          <Icon name="text" />
                        </button>
                        <button className="icon-btn danger" title={t('projectOverview.deleteComparison')} onClick={() => onDeleteComparison(c.id, c.name)}>
                          <Icon name="trash" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* The finishes summary stays as it was; a project with only concrete/rebar shows no empty finishes panel. */}
            {summaryMode !== 'skip' && (
            <div className="home-panel">
              <div className="home-panel-text">
                <h2>{t('projectOverview.summaryTitle')}</h2>
                <p className="muted">{t('projectOverview.summaryIntro')}</p>
              </div>
              {quantities.totals.length === 0 ? (
                <p className="muted project-summary-empty">{t('projectOverview.summaryEmpty')}</p>
              ) : (
                <table className="qty-summary-table project-summary-table">
                  <thead>
                    <tr>
                      <th>{t('projectOverview.item')}</th>
                      <th>{t('projectOverview.net')}</th>
                      <th>{t('projectOverview.order')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quantities.totals.map((total) => {
                      const open = expanded.has(total.category);
                      return (
                        <Fragment key={total.category}>
                          <tr className="project-summary-row" onClick={() => toggle(total.category)}>
                            <td>
                              <Icon name={open ? 'chevron-up' : 'chevron-down'} size={13} />
                              {total.label}
                            </td>
                            <td>{primary(total, t)}</td>
                            <td className="order">{primaryOrder(total, t)}</td>
                          </tr>
                          {open &&
                            total.perPlan.map((p) => (
                              <tr key={p.planId} className="project-summary-plan">
                                <td>{p.planName}</td>
                                <td>{primary(p, t)}</td>
                                <td>{primaryOrder(p, t)}</td>
                              </tr>
                            ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {quantities.uncalibratedRoomCount > 0 && (
                <div className="warning-box">
                  {t('projectOverview.uncalibratedRooms', { count: quantities.uncalibratedRoomCount })}
                </div>
              )}
            </div>
            )}

            <ProjectStructuralSummary structural={structural} />
          </div>
        )}
      </div>

      {addingComparison && (
        <NewComparisonDialog onClose={() => setAddingComparison(false)} onCreate={(input) => run('comparison', () => createComparison(input))} />
      )}
      {exportDialog && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>{t(exportDialog.kind === 'excel' ? 'quantityExport.projectExcelTitle' : 'quantityExport.projectPdfTitle')}</h3>
            <ExportContentPicker
              sections={['finishes', 'concrete', 'rebar']}
              content={exportDialog.content}
              available={exportAvailable}
              onChange={(content) => setExportDialog({ ...exportDialog, content })}
            />
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setExportDialog(null)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn-primary"
                disabled={!hasAnyContent(exportDialog.content)}
                onClick={() => {
                  const { kind, content } = exportDialog;
                  setExportDialog(null);
                  void run(kind, () =>
                    kind === 'excel'
                      ? runProjectExport('project_excel', () => exportProjectToExcel(project, plans, content, language))
                      : runProjectExport('project_pdf', () => exportProjectToPdf(project, plans, content, language))
                  );
                }}
              >
                {t('common.export')}
              </button>
            </div>
          </div>
        </div>
      )}
      {adding && <AddPlanDialog onClose={() => setAdding(false)} onAdd={(file, name) => run('add', () => addPlan(file, name))} />}
    </div>
  );
}

function AddPlanDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (file: File, name: string) => Promise<void> }) {
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');

  const pick = (f: File | null | undefined) => {
    if (!f) return;
    if (!(f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))) {
      alert(t('projectOverview.addPlan.notPdf'));
      return;
    }
    setFile(f);
    if (!name.trim()) setName(f.name.replace(/\.pdf$/i, ''));
  };

  const confirm = async () => {
    if (!file) return;
    onClose();
    await onAdd(file, name.trim() || t('projectOverview.addPlan.defaultName'));
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>{t('projectOverview.addPlan.title')}</h3>
        <div className="form-row">
          <label>{t('projectOverview.addPlan.fileLabel')}</label>
          <button className="btn-secondary file-pick" onClick={() => fileInputRef.current?.click()}>
            <Icon name={file ? 'check' : 'file'} />
            {file ? file.name : t('projectOverview.addPlan.pickPdf')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
        <div className="form-row">
          <label>{t('projectOverview.addPlan.nameLabel')}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('projectOverview.addPlan.namePlaceholder')} />
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn-primary" onClick={() => void confirm()} disabled={!file}>
            {t('projectOverview.addPlan.add')}
          </button>
        </div>
      </div>
    </div>
  );
}
