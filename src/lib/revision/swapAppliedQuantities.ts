import { v4 as uuid } from 'uuid';
import type { Measurement, Plan, Point } from '../../types';
import type { Comparison } from '../../types/compare';
import type { RevisionChange } from '../../types/revisionAnalysis';
import { resolveCompareScale } from '../compareScale';
import { changeItems } from './changeItems';
import { hasUnplacedLines, openingGeometryNeedsVerification } from './changeEdit';
import { openingImpactReady } from './openingImpact';
import { distancePx, round } from '../geometry';
import { addPlanOpening, openingsOf, reviewPlanOpening, updatePlanOpening } from '../planOpenings';
import { openingAccessDefault } from '../openingOptions';
import { pointInPolygon } from './apply';
import { OPENING_DEFAULT_SIZES } from '../../config/measurementDefaults';

const sameLine = (a: Point[], b: Point[]) => a.length >= 2 && b.length >= 2 &&
  ((distancePx(a[0], b[0]) < 0.001 && distancePx(a.at(-1)!, b.at(-1)!) < 0.001) ||
   (distancePx(a[0], b.at(-1)!) < 0.001 && distancePx(a.at(-1)!, b[0]) < 0.001));

/** Replaces only quantities owned by the selected applied change; never re-applies a comparison. */
export function swapAppliedQuantities(plan: Plan, comparison: Comparison, revisionId: string,
  before: RevisionChange, after: RevisionChange, originalPlan?: Plan): Plan {
  const app = (plan.revisionApplications ?? []).filter(a => a.status === 'applied').at(-1);
  if (!app || app.comparisonId !== comparison.id || app.revisionId !== revisionId ||
      !app.changes.some(c => c.changeId === before.id) || app.context !== (comparison.context ?? 'design')) {
    throw new Error('revision-swap-stale');
  }
  if (hasUnplacedLines(after) || openingGeometryNeedsVerification(after) || !openingImpactReady(after)) {
    throw new Error('revision-swap-unverified');
  }
  const page = comparison.pages[before.pageNumber];
  const pageNumber = page?.originalPageNumber ?? before.pageNumber;
  const mpp = plan.pages[pageNumber]?.calibration?.metersPerPixel ?? 0;
  const scale = resolveCompareScale(page, page?.revisions[revisionId]);
  if (!(mpp > 0) || scale.state !== 'calibrated' || Math.abs(scale.metersPerPixel - mpp) / mpp > .01) {
    throw new Error('revision-swap-stale');
  }
  const owns = (m: Measurement) => m.revisionSource?.comparisonId === comparison.id &&
    m.revisionSource.revisionId === revisionId && m.revisionSource.changeId === before.id;
  const previous = (plan.measurements ?? []).filter(owns);
  if (previous.some(m => m.revisionSource?.applicationId !== app.id || !app.measurementIds.includes(m.id))) {
    throw new Error('revision-swap-stale');
  }
  const itemsFor = (c: RevisionChange) => app.context === 'design' && c.relocation && previous.length
    ? changeItems(c, 'construction', mpp, comparison.wallHeightDefaultM).filter(i => i.source === 'wall' && i.areaKind === 'construction')
    : changeItems(c, app.context, mpp, comparison.wallHeightDefaultM);
  // Do not overwrite a takeoff item independently corrected after application.
  const oldItems = itemsFor(before);
  if (oldItems.length !== previous.length || previous.some(m => !oldItems.some(i => i.areaKind === m.areaKind &&
      i.areaM2 === m.areaM2 && i.wallHeightM === m.wallHeightM &&
      JSON.stringify(i.points) === JSON.stringify(m.points) && sameLine(i.centerline, m.centerline ?? [])))) {
    throw new Error('revision-swap-stale');
  }
  const used = new Set<string>();
  const created: Measurement[] = itemsFor(after).map(item => {
    const existing = previous.find(m => !used.has(m.id) && sameLine(m.centerline ?? [], item.centerline));
    const id = existing?.id ?? uuid();
    used.add(id);
    return { id, pageNumber, tool: 'area', points: item.points, centerline: item.centerline,
      areaKind: item.areaKind, areaM2: item.areaM2, calcMode: 'wall', wallLengthM: item.wallLengthM,
      wallHeightM: item.wallHeightM, revisionSource: { comparisonId: comparison.id, revisionId,
        changeId: before.id, applicationId: app.id } };
  });
  const now = Math.max(Date.now(), plan.updatedAt + 1);
  let next: Plan = { ...plan, updatedAt: now,
    measurements: [...(plan.measurements ?? []).filter(m => !owns(m)), ...created] };

  // Applied openings also affect room deductions. Use the canonical opening engine and only
  // ledger-owned records. The existing PDF and traced room geometry remain source-plan data.
  const openingIds = new Set(app.openingIds);
  const otherDoors = comparison.revisions.find(r => r.id === revisionId)?.analysis?.pages[before.pageNumber]?.changes
    .filter(c => c.id !== before.id && c.status === 'applied').flatMap(c => c.doors) ?? [];
  for (const door of [...after.doors.filter(d => d.side === 'removed'), ...after.doors.filter(d => d.side === 'added')]) {
    const line = [door.hinge, door.jamb];
    const mid = { x: (door.hinge.x + door.jamb.x) / 2, y: (door.hinge.y + door.jamb.y) / 2 };
    const reach = Math.max(.3 / mpp, door.radiusPx * .6);
    const candidates = openingsOf(next).filter(o => o.pageNumber === pageNumber && o.geometry &&
      distancePx({ x: (o.geometry.endpointA.x + o.geometry.endpointB.x) / 2,
        y: (o.geometry.endpointA.y + o.geometry.endpointB.y) / 2 }, mid) <= reach);
    if (candidates.length > 1 || candidates.some(o => !openingIds.has(o.id)) ||
        otherDoors.some(d => distancePx({ x: (d.hinge.x + d.jamb.x) / 2, y: (d.hinge.y + d.jamb.y) / 2 }, mid) <= reach)) {
      throw new Error('revision-swap-stale');
    }
    const existing = candidates[0];
    if (door.side === 'removed') {
      if (existing) next = reviewPlanOpening(next, existing.id, 'rejected', now);
      continue;
    }
    const kind = door.opening ?? 'door';
    const dimensions = { kind, geometry: { endpointA: door.hinge, endpointB: door.jamb },
      widthM: round(distancePx(line[0], line[1]) * mpp, 2), heightM: door.heightM ?? OPENING_DEFAULT_SIZES[kind].heightM,
      sillHeightM: door.sillHeightM ?? null };
    if (existing) {
      next = updatePlanOpening(next, existing.id, dimensions, now);
      const original = originalPlan && openingsOf(originalPlan).find(o => o.id === existing.id);
      next = reviewPlanOpening(next, existing.id, original?.approval.status === 'approved' ? 'approved' : 'draft', now);
    } else {
      const id = uuid();
      const len = distancePx(door.hinge, door.jamb);
      const nx = -(door.jamb.y - door.hinge.y) / len * .3 / mpp;
      const ny = (door.jamb.x - door.hinge.x) / len * .3 / mpp;
      const sideRooms = next.rooms.filter(r => r.pageNumber === pageNumber &&
        (pointInPolygon({ x: mid.x + nx, y: mid.y + ny }, r.points) ||
         pointInPolygon({ x: mid.x - nx, y: mid.y - ny }, r.points))).slice(0, 2);
      next = addPlanOpening(next, { ...dimensions, pageNumber, entryMethod: 'plan', notes: '',
        mechanism: kind === 'window' ? 'unknown' : 'hinged', walkableAccess: openingAccessDefault(kind),
        roomIds: sideRooms.map(r => r.id), ...(sideRooms[0] ? { apartmentNumber: sideRooms[0].apartmentNumber } : {}), widthSource: 'calibration', quantity: 1, suggestedDimensions: door.heightM ? [] : ['heightM'],
        source: 'import', legacyRefs: [] }, id, now);
      openingIds.add(id);
    }
  }
  const removedIds = new Set(previous.map(m => m.id));
  return { ...next, revisionApplications: plan.revisionApplications!.map(a => a.id !== app.id ? a : {
    ...a, changes: a.changes.map(c => c.changeId === before.id ? { ...c, kind: after.kind, category: after.category, bbox: after.bbox } : c),
    measurementIds: [...a.measurementIds.filter(id => !removedIds.has(id)), ...created.map(m => m.id)],
    openingIds: [...openingIds],
  }) };
}
