import type { Plan, Room, WorkCatalogSnapshot, WorkItem } from '../types';
import { effectiveHeightM, effectiveWastePercent, itemDeductsOpenings } from './quantities';
import { workItemDefinition } from './workTypes';
import { withCatalogEntries } from './workCatalog';
import { polygonAreaPx } from './geometry';

export type BulkConflictPolicy = 'add-missing' | 'update-existing' | 'skip-conflicts';
/**
 * A work item to assign to many rooms: a built-in work type, a user-defined category, or a work item
 * with its own method (type 'custom' with `categoryId`, `method` and optionally `specId`).
 */
export type BulkWorkConfig = Omit<WorkItem, 'id' | 'allocations'>;

/** What makes two items "the same work" for bulk assignment: the built-in type, or category + method + work item. */
export function bulkConfigKey(item: Pick<WorkItem, 'type' | 'categoryId' | 'method' | 'specId'>): string {
  return item.type === 'custom' ? `custom:${item.categoryId ?? ''}|${item.method ?? ''}|${item.specId ?? ''}` : item.type;
}
export type BulkIssue = 'calibration' | 'geometry' | 'configuration' | 'duplicate' | 'unavailable';
export interface BulkRoomChange {
  roomId: string;
  status: 'updated' | 'skipped' | 'blocked';
  issues: BulkIssue[];
  /** Keys (`bulkConfigKey`) of the configured work the room already has. */
  conflicts: string[];
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
  const def = workItemDefinition(config);
  return {
    type: config.type,
    // Custom work keeps its identity; built-in configurations keep exactly their established shape.
    ...(config.type === 'custom' ? { categoryId: config.categoryId, method: config.method, ...(config.specId ? { specId: config.specId } : {}) } : {}),
    tilingCategory: config.type === 'tiling' ? config.tilingCategory ?? 'regular' : undefined,
    heightM: def?.height ? config.heightM : undefined,
    wastePercent: config.wastePercent,
    deductOpenings: def?.deductedOpeningTypes.length ? config.deductOpenings : undefined,
  };
}
export function validBulkConfig(config: BulkWorkConfig, plan: Plan): boolean {
  const def = workItemDefinition(config);
  if (!def) return false;
  if (config.type === 'custom' && !config.categoryId) return false;
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
  const configKeys = configs.map(bulkConfigKey);
  const invalid = !configs.length || new Set(configKeys).size !== configKeys.length ||
    !['add-missing', 'update-existing', 'skip-conflicts'].includes(policy) || configs.some(c => !validBulkConfig(c, plan));
  const settings = configs.map(cleanConfig);
  // Typed (manual) quantities need no scale; a scale is required only when something is measured.
  const measured = settings.some(c => workItemDefinition(c)?.basis !== 'manual');
  const entries = ids.map((roomId): BulkRoomChange => {
    const room = roomMap.get(roomId);
    const entry: BulkRoomChange = { roomId, status: 'skipped', issues: [], conflicts: [], additions: [], updates: [] };
    if (!room?.closed) { entry.status = 'blocked'; entry.issues.push('unavailable'); return entry; }
    entry.conflicts = configKeys.filter(key => room.workItems.some(w => bulkConfigKey(w) === key));
    if (invalid) entry.issues.push('configuration');
    const mpp = plan.pages[room.pageNumber]?.calibration?.metersPerPixel;
    if (measured && (!mpp || !Number.isFinite(mpp) || mpp <= 0)) entry.issues.push('calibration');
    if (room.points.length < 3 || room.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || !(polygonAreaPx(room.points) > 0)) entry.issues.push('geometry');
    if (policy === 'update-existing' && settings.some(c => room.workItems.filter(w => bulkConfigKey(w) === bulkConfigKey(c)).length > 1)) entry.issues.push('duplicate');
    if (entry.issues.length) { entry.status = 'blocked'; return entry; }
    if (policy === 'skip-conflicts' && entry.conflicts.length) return entry;
    for (const config of settings) {
      const existing = room.workItems.find(w => bulkConfigKey(w) === bulkConfigKey(config));
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

/**
 * One immutable replacement. Unrelated items, room geometry, classifications and openings stay intact.
 * `catalog`: the catalog entries custom configurations refer to, copied into the plan's snapshot.
 */
export function materializeBulkTakeoff(plan: Plan, preview: BulkPreview, makeId: () => string, catalog?: Partial<WorkCatalogSnapshot>): Plan {
  if (plan.id !== preview.planId || !preview.changedCount) return plan;
  const changes = new Map(preview.entries.filter(e => e.status === 'updated').map(e => [e.roomId, e]));
  const base = catalog ? withCatalogEntries(plan, catalog) : plan;
  return { ...base, updatedAt: Date.now(), rooms: plan.rooms.map(room => {
    const change = changes.get(room.id);
    if (!change) return room;
    const updates = new Map(change.updates.map(u => [u.itemId, u.config]));
    return { ...room, workItems: [
      ...room.workItems.map(item => updates.has(item.id) ? { ...item, ...updates.get(item.id), id: item.id } : item),
      ...change.additions.map(config => ({ ...config, id: makeId() })),
    ] };
  }) };
}
