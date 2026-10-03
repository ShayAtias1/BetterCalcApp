import { useMemo } from 'react';
import { useAppStore } from '../store/appStore';
import { buildRoomSummaries } from '../lib/quantities';
import { getExportablePageNumbers } from '../lib/exportQuantitiesPdf';
import { availableContent, type ExportContent } from '../lib/exportContent';

/** What the open plan can export - shared by the export buttons (enabled state) and the export dialogs (what is on offer). */
export function useQuantityExportInfo() {
  const project = useAppStore((s) => s.project);
  const summaries = useMemo(() => (project ? buildRoomSummaries(project) : []), [project]);
  if (!project) return null;
  const hasAreaMeasurements = (project.measurements ?? []).some((m) => m.tool === 'area' && m.areaKind);
  const exportablePages = getExportablePageNumbers(project);
  const available = availableContent(project, summaries.length > 0 || hasAreaMeasurements, exportablePages.length > 0);
  // The workbook has no plan drawing: only the three quantity domains.
  const excelAvailable: ExportContent = { ...available, plan: false };
  return { project, summaries, exportablePages, available, excelAvailable };
}
