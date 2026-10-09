import type { LegacyOpeningRef, NewPlanOpening, Plan, PlanOpening, PlanOpeningPatch, Room } from '../types';

/** Pure reader: old plans stay byte-for-byte untouched. No lazy/destructive migration. */
export function openingsOf(plan: Plan): PlanOpening[] {
  return Array.isArray(plan.openings) ? plan.openings : [];
}
const refKey = (ref: LegacyOpeningRef) => JSON.stringify([ref.roomId, ref.openingId]);
const kinds = ['door', 'window', 'open-passage', 'custom', 'unknown'];
const mechanisms = ['hinged', 'sliding', 'fixed', 'open', 'unknown'];
const access = ['supported', 'unsupported', 'unknown'];

export function validatePlanOpening(plan: Plan, opening: PlanOpening): { errors: string[]; warnings: string[]; canApprove: boolean } {
  const errors: string[] = [], warnings: string[] = [];
  if (!opening.id || opening.planId !== plan.id) errors.push('Invalid opening identity or plan ownership');
  if (!Number.isInteger(opening.pageNumber) || opening.pageNumber < 1 || !plan.pages[opening.pageNumber]) errors.push('Unknown page');
  if (!kinds.includes(opening.kind) || !mechanisms.includes(opening.mechanism) || !access.includes(opening.walkableAccess)) errors.push('Invalid classification');
  if (!['manual', 'import', 'legacy'].includes(opening.source)) errors.push('Invalid provenance');
  if (!['draft', 'approved', 'rejected'].includes(opening.approval.status) ||
      (opening.approval.reviewedAt !== null && !Number.isFinite(opening.approval.reviewedAt))) errors.push('Invalid approval');
  if (!Number.isFinite(opening.createdAt) || !Number.isFinite(opening.updatedAt)) errors.push('Invalid timestamps');
  for (const key of ['widthM', 'heightM', 'sillHeightM', 'quantity'] as const) {
    const n = opening[key];
    if (n === null) { warnings.push(`${key} unknown`); continue; }
    if (typeof n !== 'number' || !Number.isFinite(n) || (key === 'sillHeightM' ? n < 0 : n <= 0) || (key === 'quantity' && !Number.isInteger(n))) errors.push(`Invalid ${key}`);
  }
  const geometry = opening.geometry;
  if (geometry !== null) {
    const points = [geometry?.endpointA, geometry?.endpointB];
    if (points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) ||
        (geometry.endpointA.x === geometry.endpointB.x && geometry.endpointA.y === geometry.endpointB.y)) errors.push('Invalid or zero-length geometry');
  } else if (opening.entryMethod !== 'takeoff') warnings.push('Geometry unknown');
  if (!Array.isArray(opening.roomIds) || new Set(opening.roomIds).size !== opening.roomIds.length) errors.push('Invalid or duplicate room references');
  else for (const id of opening.roomIds) {
    const room = plan.rooms.find(r => r.id === id);
    if (!room || room.pageNumber !== opening.pageNumber) errors.push('Unknown room or page mismatch');
  }
  if (opening.roomSides !== undefined) {
    const sides = opening.roomSides;
    if (!Array.isArray(sides) || sides.length !== 2 || sides.some(side =>
      side !== null && side !== 'exterior' && (typeof side !== 'object' || typeof side.roomId !== 'string')) ||
      JSON.stringify(sides.flatMap(side => side && typeof side === 'object' ? [side.roomId] : [])) !== JSON.stringify(opening.roomIds)) {
      errors.push('Invalid opening room sides');
    }
  }
  if (!Array.isArray(opening.legacyRefs)) errors.push('Invalid legacy references');
  else {
    const keys = opening.legacyRefs.map(refKey);
    if (new Set(keys).size !== keys.length) errors.push('Duplicate legacy reference');
    for (const ref of opening.legacyRefs) {
      const room = plan.rooms.find(r => r.id === ref.roomId);
      if (!room || room.pageNumber !== opening.pageNumber || !room.openings?.some(o => o.id === ref.openingId) || !opening.roomIds.includes(ref.roomId)) errors.push('Unknown legacy reference or page/room mismatch');
      if (openingsOf(plan).some(o => o.id !== opening.id && o.legacyRefs.some(r => refKey(r) === refKey(ref)))) errors.push('Legacy row already linked to another canonical opening');
    }
  }
  if (opening.quantityReview !== undefined && (typeof opening.quantityReview.associationsConfirmed !== 'boolean' ||
    !Array.isArray(opening.quantityReview.distinctLegacyRoomIds) || opening.quantityReview.distinctLegacyRoomIds.some(id=>!opening.roomIds.includes(id)))) errors.push('Invalid quantity review');
  if (opening.entryMethod !== undefined && !['plan', 'takeoff'].includes(opening.entryMethod)) errors.push('Invalid entry method');
  if (opening.label !== undefined && typeof opening.label !== 'string') errors.push('Invalid label');
  if (opening.notes !== undefined && typeof opening.notes !== 'string') errors.push('Invalid notes');
  if (opening.widthSource !== undefined && !['manual', 'calibration'].includes(opening.widthSource)) errors.push('Invalid width source');
  if (opening.apartmentNumber !== undefined && typeof opening.apartmentNumber !== 'string') errors.push('Invalid apartment');
  if (opening.kind === 'unknown') warnings.push('Classification unknown');
  if (opening.mechanism === 'unknown' || opening.walkableAccess === 'unknown') warnings.push('Mechanism or access unresolved');
  return { errors, warnings, canApprove: errors.length === 0 && (geometry !== null || (opening.entryMethod === 'takeoff' && opening.roomIds.length > 0)) && opening.kind !== 'unknown' };
}

function requireValid(plan: Plan, opening: PlanOpening) {
  const result = validatePlanOpening(plan, opening);
  if (result.errors.length) throw new Error(result.errors.join('; '));
}

export function addPlanOpening(plan: Plan, input: NewPlanOpening, id: string, now: number): Plan {
  if (openingsOf(plan).some(o => o.id === id)) throw new Error('Duplicate opening id');
  const opening: PlanOpening = { ...structuredClone(input), id, planId: plan.id, approval: { status: 'draft', reviewedAt: null }, createdAt: now, updatedAt: now };
  requireValid(plan, opening);
  return { ...plan, openings: [...openingsOf(plan), opening], updatedAt: now };
}

/** Opening fields are plain persisted data; compare values, not object references. */
function sameOpeningValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameOpeningValue(left[key], right[key]));
}

export function updatePlanOpening(plan: Plan, id: string, patch: PlanOpeningPatch, now: number): Plan {
  const current = openingsOf(plan).find(o => o.id === id);
  if (!current) return plan;
  // Runtime whitelist prevents callers from bypassing the approval action or changing identity.
  const allowed = ['pageNumber', 'entryMethod', 'geometry', 'kind', 'mechanism', 'walkableAccess', 'roomIds', 'roomSides', 'apartmentNumber', 'widthM', 'heightM', 'sillHeightM', 'quantity', 'source', 'legacyRefs', 'label', 'notes', 'widthSource', 'quantityReview'] as const;
  const editable = Object.fromEntries(allowed.filter(k => Object.hasOwn(patch, k) && !sameOpeningValue(current[k], patch[k])).map(k => [k, patch[k]]));
  if (!Object.keys(editable).length) return plan;
  if (Object.hasOwn(editable, 'roomIds') && !Object.hasOwn(patch, 'roomSides')) editable.roomSides = undefined;
  if ((Object.hasOwn(editable,'geometry') || Object.hasOwn(editable,'roomIds') || Object.hasOwn(editable,'roomSides') || Object.hasOwn(editable,'pageNumber')) && !Object.hasOwn(patch,'quantityReview'))
    editable.quantityReview = { associationsConfirmed: false, distinctLegacyRoomIds: [] };
  const opening: PlanOpening = { ...current, ...structuredClone(editable), approval: { status: 'draft', reviewedAt: null }, updatedAt: now };
  requireValid(plan, opening);
  return { ...plan, openings: openingsOf(plan).map(o => o.id === id ? opening : o), updatedAt: now };
}

export function removePlanOpening(plan: Plan, id: string, now: number): Plan {
  if (!openingsOf(plan).some(o => o.id === id)) return plan;
  return { ...plan, openings: openingsOf(plan).filter(o => o.id !== id), updatedAt: now };
}

export function reviewPlanOpening(plan: Plan, id: string, status: 'draft' | 'approved' | 'rejected', now: number): Plan {
  const current = openingsOf(plan).find(o => o.id === id);
  if (!current) return plan;
  if (status === 'approved' && !validatePlanOpening(plan, current).canApprove) throw new Error('Opening geometry/classification is not ready for approval');
  const opening = { ...current, approval: { status, reviewedAt: status === 'draft' ? null : now }, updatedAt: now };
  return { ...plan, openings: openingsOf(plan).map(o => o.id === id ? opening : o), updatedAt: now };
}

/** Inventory-only adapter. Not consumed by the quantity engine. Links deduplicate display records. */
export function openingInventory(plan: Plan) {
  const canonical = openingsOf(plan);
  const linked = new Set(canonical.flatMap(o => o.legacyRefs.map(refKey)));
  return {
    canonical,
    legacy: plan.rooms.flatMap(room => (room.openings ?? []).filter(o => !linked.has(refKey({ roomId: room.id, openingId: o.id }))).map(opening => ({ roomId: room.id, opening }))),
  };
}

/** Explicit copies only; never convert room quantity rows into canonical objects. */
export function cloneOpeningsForRooms(plan: Plan, pairs: { source: Room; copy: Room }[], planId: string, nextId: () => string, now: number, options?: { apartment?: { source: string; target: string }; offset: number }): PlanOpening[] {
  const rooms = new Map(pairs.map(p => [p.source.id, p.copy]));
  const legacy = new Map(pairs.flatMap(p => (p.source.openings ?? []).map((o, i) => [refKey({ roomId: p.source.id, openingId: o.id }), p.copy.openings?.[i]?.id] as const)));
  return openingsOf(plan).filter(o => {
    const all = [...o.roomIds, ...o.legacyRefs.map(r => r.roomId)];
    if (all.length) return all.every(id => rooms.has(id));
    return options?.apartment !== undefined && o.apartmentNumber === options.apartment.source;
  }).map(o => {
    const copied = structuredClone(o);
    const offset = options?.offset ?? 0;
    if (copied.geometry && offset) for (const point of [copied.geometry.endpointA, copied.geometry.endpointB]) { point.x += offset; point.y += offset; }
    return { ...copied, id: nextId(), planId, roomIds: o.roomIds.map(id => rooms.get(id)!.id),
      ...(o.roomSides ? { roomSides: o.roomSides.map(side => side && typeof side === 'object' ? { roomId: rooms.get(side.roomId)!.id } : side) as PlanOpening['roomSides'] } : {}),
      quantityReview: { associationsConfirmed: false, distinctLegacyRoomIds: [] },
      legacyRefs: o.legacyRefs.map(r => ({ roomId: rooms.get(r.roomId)!.id, openingId: legacy.get(refKey(r))! })),
      ...(options?.apartment ? { apartmentNumber: options.apartment.target } : {}),
      approval: { status: 'draft', reviewedAt: null }, createdAt: now, updatedAt: now };
  });
}

export function cloneAllPlanOpenings(plan: Plan, rooms: Room[], planId: string, nextId: () => string, now: number): PlanOpening[] {
  const paired = plan.rooms.map((source, i) => ({ source, copy: rooms[i] }));
  const linked = cloneOpeningsForRooms(plan, paired, planId, nextId, now);
  const standalone = openingsOf(plan).filter(o => !o.roomIds.length && !o.legacyRefs.length).map(o => ({ ...structuredClone(o), id: nextId(), planId, quantityReview: { associationsConfirmed: false, distinctLegacyRoomIds: [] }, approval: { status: 'draft' as const, reviewedAt: null }, createdAt: now, updatedAt: now }));
  return [...linked, ...standalone];
}

/** Keep links honest after legacy edits, room deletion or reassignment; never alter dimensions. */
export function withOpeningRoomChanges(plan: Plan, rooms: Room[], now: number): Plan {
  if (!plan.openings) return { ...plan, rooms };
  const before = new Map(plan.rooms.map(r => [r.id, r]));
  const after = new Map(rooms.map(r => [r.id, r]));
  const openings = plan.openings.map(o => {
    const related = new Set([...o.roomIds, ...o.legacyRefs.map(r => r.roomId)]);
    const affected = [...related].some(id => {
      const a = before.get(id), b = after.get(id);
      return !a || !b || a.pageNumber !== b.pageNumber || a.apartmentNumber !== b.apartmentNumber ||
        JSON.stringify(a.points) !== JSON.stringify(b.points) || JSON.stringify(a.openings) !== JSON.stringify(b.openings) || o.legacyRefs.filter(r => r.roomId === id).some(ref =>
          JSON.stringify(a.openings?.find(x => x.id === ref.openingId)) !== JSON.stringify(b.openings?.find(x => x.id === ref.openingId)));
    });
    if (!affected) return o;
    const roomIds = o.roomIds.filter(id => after.has(id));
    const apartments = new Set(roomIds.map(id => after.get(id)!.apartmentNumber));
    return { ...o, roomIds,
      ...(o.roomSides ? { roomSides: o.roomSides.map(side => side && typeof side === 'object' && !roomIds.includes(side.roomId) ? null : side) as PlanOpening['roomSides'] } : {}),
      quantityReview: { associationsConfirmed: false, distinctLegacyRoomIds: [] },
      legacyRefs: o.legacyRefs.filter(ref => after.get(ref.roomId)?.openings?.some(x => x.id === ref.openingId)),
      ...(roomIds.length ? { apartmentNumber: apartments.size === 1 ? [...apartments][0] : undefined } : {}),
      approval: { status: 'draft' as const, reviewedAt: null }, updatedAt: now };
  });
  return { ...plan, rooms, openings };
}
