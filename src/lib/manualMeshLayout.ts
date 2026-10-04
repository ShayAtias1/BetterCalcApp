/** Saved physical layout edits. No reinforcement calculations or persistence side effects. */
import type { Calibration } from '../types';
import type { ManualMeshLayout, RebarMesh, RebarLevel } from '../types/structural';
import { calculateMeshSheetPlacements, type MeshSheetPlacement } from './meshSheetPlacement';
import { resolveMeshProcurement, resolveSheetSettings } from './meshSheets';

export type ManualMeshEdit =
  | { type: 'move'; id: string; x: number; y: number }
  | { type: 'rotate' | 'remove' | 'duplicate'; id: string }
  | { type: 'add' }
  | { type: 'reset' };

export function manualMeshPlacements(manual: ManualMeshLayout, template: MeshSheetPlacement): MeshSheetPlacement[] {
  return manual.sheets.map((s, column) => {
    const swapped = s.rotation === 90 || s.rotation === 270;
    return { ...template, id: s.id, row: 0, column, x: s.x, y: s.y,
      width: swapped ? manual.widthM : manual.lengthM, height: swapped ? manual.lengthM : manual.widthM,
      rotationRadians: s.rotation * Math.PI / 180, physicalSheetWidth: manual.lengthM, physicalSheetHeight: manual.widthM };
  });
}

export function editManualMeshLayout(mesh: RebarMesh, calibration: Calibration | null, level: RebarLevel, edit: ManualMeshEdit, newId: () => string): RebarMesh {
  if (edit.type === 'reset') {
    if (!mesh.manualLayouts?.[level]) return mesh;
    const manualLayouts = { ...mesh.manualLayouts };
    delete manualLayouts[level];
    const next = { ...mesh };
    if (Object.keys(manualLayouts).length) next.manualLayouts = manualLayouts;
    else delete next.manualLayouts;
    return next;
  }
  const automatic = calculateMeshSheetPlacements(mesh, calibration);
  if (automatic.status !== 'ok' || resolveMeshProcurement(mesh, calibration).status !== 'ok') return mesh;
  const placements = automatic.placementsByLevel[level];
  if (!placements) return mesh;
  const settings = resolveSheetSettings(mesh.sheets);
  const existing = mesh.manualLayouts?.[level];
  const manual: ManualMeshLayout = existing ?? { lengthM: settings.lengthM, widthM: settings.widthM,
    sheets: placements.map((p) => ({ id: p.id, x: p.x, y: p.y, rotation: p.rotationRadians === 0 ? 0 : 90 })) };
  let sheets = manual.sheets;
  if (edit.type === 'add') {
    // Predictable near-zone origin; never random geometry. Only identity is generated.
    sheets = [...sheets, { id: newId(), x: 0, y: 0, rotation: 0 }];
  } else {
    const sheet = sheets.find((s) => s.id === edit.id);
    if (!sheet) return mesh;
    if (edit.type === 'duplicate') {
      sheets = [...sheets, { ...sheet, id: newId(), x: sheet.x + 0.2, y: sheet.y + 0.2 }];
    } else if (edit.type === 'remove') sheets = sheets.filter((s) => s.id !== edit.id);
    else if (edit.type === 'move') {
      if (!Number.isFinite(edit.x) || !Number.isFinite(edit.y) || (sheet.x === edit.x && sheet.y === edit.y)) return mesh;
      sheets = sheets.map((s) => s.id === edit.id ? { ...s, x: edit.x, y: edit.y } : s);
    } else {
      const swapped = sheet.rotation === 90 || sheet.rotation === 270;
      const width = swapped ? manual.widthM : manual.lengthM, height = swapped ? manual.lengthM : manual.widthM;
      sheets = sheets.map((s) => s.id === edit.id ? { ...s, x: s.x + (width - height) / 2, y: s.y + (height - width) / 2,
        rotation: ((s.rotation + 90) % 360) as typeof s.rotation } : s);
    }
  }
  return { ...mesh, manualLayouts: { ...mesh.manualLayouts, [level]: { ...manual, sheets } } };
}

export function renewManualMeshSheetIds(mesh: RebarMesh, newId: () => string): RebarMesh {
  if (!mesh.manualLayouts) return mesh;
  return { ...mesh, manualLayouts: Object.fromEntries(Object.entries(mesh.manualLayouts).map(([level, layout]) =>
    [level, { ...layout, sheets: layout.sheets.map((s) => ({ ...s, id: newId() })) }])) };
}
