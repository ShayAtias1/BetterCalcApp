import type { Plan, Room, WorkItem, WorkType } from '../types';
import { effectiveHeightM, effectiveWastePercent, itemDeductsOpenings } from './quantities';
import { workTypeDefinition } from './workTypes';
import { polygonAreaPx } from './geometry';

export type BulkConflictPolicy = 'add-missing' | 'update-existing' | 'skip-conflicts';
export type BulkWorkConfig = Omit<WorkItem, 'id'>;
export type BulkIssue = 'calibration' | 'geometry' | 'configuration' | 'duplicate' | 'unavailable';
export interface BulkRoomChange {
  roomId: string;
  status: 'updated' | 'skipped' | 'blocked';
  issues: BulkIssue[];
  conflicts: WorkType[];
  additions: BulkWorkConfig[];
  updates: { itemId: string; config: BulkWorkConfig }[];
}
export interface BulkPreview {
  planId: string;
  selectedCount: number;
  entries: BulkRoomChange[];
  changedCount: number;
  skippedCount: number;
  blockedCount: number;
  conflictCount: number;
}

/** Only persisted Room records are eligible. Detection candidates are a separate collection. */
export function bulkRooms(plan: Plan): Room[] { return plan.rooms.filter(r => r.closed); }

/** Strip IDs and unsupported fields, and explicitly clear obsolete configuration on updates. */
function cleanConfig(config: BulkWorkConfig): BulkWorkConfig {
  const def = workTypeDefinition(config.type);
  return {
    type: config.type,
    tilingCategory: config.type === 'tiling' ? config.tilingCategory ?? 'regular' : undefined,
    heightM: def?.height ? config.heightM : undefined,
    wastePercent: config.wastePercent,
    deductOpenings: def?.deductedOpeningTypes.length ? config.deductOpenings : undefined,
  };
}
export function validBulkConfig(config: BulkWorkConfig, plan: Plan): boolean {
  const def = workTypeDefinition(config.type);
  if (!def) return false;
  if (config.type === 'tiling' && config.tilingCategory !== undefined && !['regular', 'as'].includes(config.tilingCategory)) return false;
  if (config.heightM !== undefined && (!Number.isFinite(config.heightM) || config.heightM < 0)) return false;
  if (config.wastePercent !== undefined && (!Number.isFinite(config.wastePercent) || config.wastePercent < 0 || config.wastePercent > 100)) return false;
  if (config.deductOpenings !== undefined && typeof config.deductOpenings !== 'boolean') return false;
  const item: WorkItem = { ...config, id: '' };
  const height = effectiveHeightM(item, plan), waste = effectiveWastePercent(item, plan);
  return Number.isFinite(waste) && waste >= 0 && waste <= 100 && (!def.height ||
    (Number.isFinite(height) && (def.basis === 'floorAndUpturn' ? height >= 0 : height > 0)));
}
function configurationMatches(item: WorkItem, config: BulkWorkConfig, plan: Plan): boolean {
  const target: WorkItem = { ...config, id: item.id };
  return (item.type !== 'tiling' || (item.tilingCategory ?? 'regular') === target.tilingCategory) &&
    effectiveHeightM(item, plan) === effectiveHeightM(target, plan) &&
    effectiveWastePercent(item, plan) === effectiveWastePercent(target, plan) &&
    itemDeductsOpenings(item) === itemDeductsOpenings(target) &&
    item.heightM === target.heightM && item.wastePercent === target.wastePercent && item.deductOpenings === target.deductOpenings;
}

/** The same pure planner drives preview and the store's commit; never calculates its own quantities. */
export function planBulkTakeoff(plan: Plan, roomIds: string[], configs: BulkWorkConfig[], policy: BulkConflictPolicy): BulkPreview {
  const ids = [...new Set(roomIds)];
  const roomMap = new Map(plan.rooms.map(r => [r.id, r]));
  const configTypes = configs.map(c => c.type);
  const invalid = !configs.length || new Set(configTypes).size !== configTypes.length ||
    !['add-missing', 'update-existing', 'skip-conflicts'].includes(policy) || configs.some(c => !validBulkConfig(c, plan));
  const settings = configs.map(cleanConfig);
  const entries = ids.map((roomId): BulkRoomChange => {
    const room = roomMap.get(roomId);
    const entry: BulkRoomChange = { roomId, status: 'skipped', issues: [], conflicts: [], additions: [], updates: [] };
    if (!room?.closed) { entry.status = 'blocked'; entry.issues.push('unavailable'); return entry; }
    entry.conflicts = configTypes.filter(type => room.workItems.some(w => w.type === type));
    if (invalid) entry.issues.push('configuration');
    const mpp = plan.pages[room.pageNumber]?.calibration?.metersPerPixel;
    if (!mpp || !Number.isFinite(mpp) || mpp <= 0) entry.issues.push('calibration');
    if (room.points.length < 3 || room.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || !(polygonAreaPx(room.points) > 0)) entry.issues.push('geometry');
    if (policy === 'update-existing' && settings.some(c => room.workItems.filter(w => w.type === c.type).length > 1)) entry.issues.push('duplicate');
    if (entry.issues.length) { entry.status = 'blocked'; return entry; }
    if (policy === 'skip-conflicts' && entry.conflicts.length) return entry;
    for (const config of settings) {
      const existing = room.workItems.find(w => w.type === config.type);
      if (!existing) entry.additions.push(config);
      else if (policy === 'update-existing' && !configurationMatches(existing, config, plan)) entry.updates.push({ itemId: existing.id, config });
    }
    if (entry.additions.length || entry.updates.length) entry.status = 'updated';
    return entry;
  });
  return {
    planId: plan.id, selectedCount: ids.length, entries,
    changedCount: entries.filter(e => e.status === 'updated').length,
    skippedCount: entries.filter(e => e.status === 'skipped').length,
    blockedCount: entries.filter(e => e.status === 'blocked').length,
    conflictCount: entries.filter(e => e.conflicts.length).length,
  };
}

/** One immutable replacement. Unrelated items, room geometry, classifications and openings stay intact. */
export function materializeBulkTakeoff(plan: Plan, preview: BulkPreview, makeId: () => string): Plan {
  if (plan.id !== preview.planId || !preview.changedCount) return plan;
  const changes = new Map(preview.entries.filter(e => e.status === 'updated').map(e => [e.roomId, e]));
  return { ...plan, updatedAt: Date.now(), rooms: plan.rooms.map(room => {
    const change = changes.get(room.id);
    if (!change) return room;
    const updates = new Map(change.updates.map(u => [u.itemId, u.config]));
    return { ...room, workItems: [
      ...room.workItems.map(item => updates.has(item.id) ? { ...item, ...updates.get(item.id), id: item.id } : item),
      ...change.additions.map(config => ({ ...config, id: makeId() })),
    ] };
  }) };
}
