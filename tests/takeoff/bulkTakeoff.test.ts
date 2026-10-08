import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bulkRooms, materializeBulkTakeoff, planBulkTakeoff, validBulkConfig } from '../../src/lib/bulkTakeoff.ts';
import { buildRoomSummaries, calculateWorkItem, roomMetrics } from '../../src/lib/quantities.ts';
import type { Plan } from '../../src/types/index.ts';
import { PLAN_A } from './fixtures.ts';

function fixture(): Plan {
  const base = PLAN_A.rooms[0];
  return { ...structuredClone(PLAN_A), rooms: [
    { ...structuredClone(base), id: 'manual', workItems: [], openings: [], roomType: 'bedroom' },
    { ...structuredClone(base), id: 'approved-ai', workItems: [], openings: [], aiSource: { spaceId: 'ai-1', suggestedType: 'kitchen', geometryClass: 'ENCLOSED', requiresReview: true, reviewNotes: [], reviewedWarningIds: [] } },
    { ...structuredClone(base), id: 'existing', workItems: [{ id: 'paint', type: 'painting', heightM: 3.2, wastePercent: 9 }, { id: 'floor', type: 'tiling', tilingCategory: 'as' }], openings: [{ id: 'door', type: 'door', widthM: 1, heightM: 2, quantity: 1 }] },
    { ...structuredClone(base), id: 'uncalibrated', pageNumber: 2, workItems: [] },
    { ...structuredClone(base), id: 'duplicate', workItems: [{ id: 'paint-1', type: 'painting' }, { id: 'paint-2', type: 'painting' }] },
    { ...structuredClone(base), id: 'open', closed: false, workItems: [] },
  ] };
}
const configs = [{ type: 'painting' as const, heightM: 2.8, wastePercent: 5, deductOpenings: true }, { type: 'panels' as const, heightM: .07, wastePercent: 0, deductOpenings: true }];
function apply(plan: Plan, ids: string[], policy: 'add-missing' | 'update-existing' | 'skip-conflicts') {
  const preview = planBulkTakeoff(plan, ids, configs, policy);
  let id = 0;
  return { preview, next: materializeBulkTakeoff(plan, preview, () => `new-${++id}`) };
}
test('selection includes manual and approved AI Rooms, excludes unfinished records and unknown suggestion IDs', () => {
  const plan = fixture();
  assert.deepEqual(bulkRooms(plan).map(r => r.id), ['manual', 'approved-ai', 'existing', 'uncalibrated', 'duplicate']);
  const result = planBulkTakeoff(plan, ['manual', 'approved-ai', 'pending-suggestion', 'open', 'manual'], configs, 'add-missing');
  assert.equal(result.selectedCount, 4);
  assert.equal(result.changedCount, 2);
  assert.equal(result.blockedCount, 2);
});
test('add missing never duplicates or overwrites matching types, and preserves geometry, metadata and openings', () => {
  const plan = fixture(), original = structuredClone(plan);
  const { preview, next } = apply(plan, ['manual', 'existing', 'uncalibrated', 'duplicate'], 'add-missing');
  assert.equal(preview.changedCount, 3);
  assert.equal(preview.blockedCount, 1);
  assert.equal(preview.conflictCount, 2);
  assert.deepEqual(plan, original);
  const existing = next.rooms.find(r => r.id === 'existing')!;
  assert.deepEqual(existing.workItems.slice(0, 2), original.rooms[2].workItems);
  assert.equal(existing.workItems.filter(w => w.type === 'painting').length, 1);
  assert.equal(existing.workItems.filter(w => w.type === 'panels').length, 1);
  for (let i = 0; i < plan.rooms.length; i++) {
    const { workItems: _beforeItems, ...before } = plan.rooms[i], { workItems: _afterItems, ...after } = next.rooms[i];
    assert.deepEqual(after, before);
  }
  assert.strictEqual(next.rooms.find(r => r.id === 'uncalibrated'), plan.rooms.find(r => r.id === 'uncalibrated'));
});
test('skip conflicts skips the entire Room even when some selected work is missing', () => {
  const { preview, next } = apply(fixture(), ['manual', 'existing', 'duplicate'], 'skip-conflicts');
  assert.equal(preview.changedCount, 1);
  assert.equal(preview.skippedCount, 2);
  assert.equal(next.rooms.find(r => r.id === 'existing')!.workItems.length, 2);
});
test('update existing retains matching IDs and unrelated types, blocks ambiguous duplicates', () => {
  const plan = fixture();
  const { preview, next } = apply(plan, ['existing', 'duplicate'], 'update-existing');
  assert.equal(preview.changedCount, 1);
  assert.deepEqual(preview.entries[1].issues, ['duplicate']);
  const changed = next.rooms.find(r => r.id === 'existing')!;
  assert.equal(changed.workItems[0].id, 'paint');
  assert.equal(changed.workItems[0].heightM, 2.8);
  assert.equal(changed.workItems[0].wastePercent, 5);
  assert.strictEqual(changed.workItems[1], plan.rooms[2].workItems[1]);
  assert.strictEqual(next.rooms[4], plan.rooms[4]);
});
test('missing calibration and invalid geometry/configuration block mutations; no-op operations return original Plan', () => {
  const plan = fixture();
  plan.rooms.push({ ...plan.rooms[0], id: 'degenerate', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }] });
  const { preview, next } = apply(plan, ['uncalibrated', 'degenerate'], 'add-missing');
  assert.equal(preview.changedCount, 0);
  assert.deepEqual(preview.entries.map(e => e.issues), [['calibration'], ['geometry']]);
  assert.strictEqual(next, plan);
  for (const config of [{ type: 'painting', heightM: NaN }, { type: 'painting', heightM: 0 }, { type: 'tiling', wastePercent: 101 }, { type: 'tiling', wastePercent: -1 }] as const) assert.equal(validBulkConfig(config, plan), false);
  assert.equal(validBulkConfig({ type: 'waterproofing', heightM: 0 }, plan), true);
  assert.equal(planBulkTakeoff(plan, ['manual'], [], 'add-missing').blockedCount, 1);
  assert.equal(planBulkTakeoff(plan, ['manual'], [configs[0], configs[0]], 'add-missing').blockedCount, 1);
});
test('quantities and order use the existing engine with per-Room openings, height, waste and page scale', () => {
  const plan = fixture(), { next } = apply(plan, ['manual', 'existing'], 'update-existing');
  for (const room of next.rooms.filter(r => ['manual', 'existing'].includes(r.id))) {
    const { areaM2, perimeterM } = roomMetrics(room, next.pages[room.pageNumber].calibration);
    const painting = room.workItems.find(w => w.type === 'painting')!;
    const calc = calculateWorkItem(painting, room, areaM2, perimeterM, next);
    const deduction = room.id === 'existing' ? 2 : 0;
    assert.ok(Math.abs(calc.netM2 - (perimeterM * 2.8 - deduction)) < 1e-9);
    const summary = buildRoomSummaries(next).find(s => s.roomId === room.id)!;
    assert.equal(summary.extra.painting.areaM2, Math.round(calc.netM2 * 100) / 100);
    assert.equal(summary.extra.painting.wastePercent, 5);
  }
});
test('repeat assignment is a no-op, and generated work item IDs are unique across Rooms', () => {
  const plan = fixture(), { next } = apply(plan, ['manual', 'approved-ai'], 'add-missing');
  const ids = next.rooms.slice(0, 2).flatMap(r => r.workItems.map(w => w.id));
  assert.equal(new Set(ids).size, 4);
  const again = apply(next, ['manual', 'approved-ai'], 'add-missing');
  assert.equal(again.preview.changedCount, 0);
  assert.strictEqual(again.next, next);
  assert.equal(apply(next, ['manual', 'approved-ai'], 'update-existing').preview.changedCount, 0);
  assert.deepEqual(structuredClone(next), next); // plain persistence payload, no functions or new schema
});
test('preview and materialization cover exactly the same Rooms', () => {
  const plan = fixture();
  const { preview, next } = apply(plan, plan.rooms.map(r => r.id), 'update-existing');
  assert.deepEqual(next.rooms.filter((r, i) => r !== plan.rooms[i]).map(r => r.id), preview.entries.filter(e => e.status === 'updated').map(e => e.roomId));
  assert.strictEqual(materializeBulkTakeoff({ ...plan, id: 'other-plan' }, preview, () => 'bad').rooms, plan.rooms);
  assert.equal(next.measurements, plan.measurements);
});
