import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useAppStore } from '../../src/store/appStore.ts';
import { setWorkspaceWidth } from '../../src/lib/workspaceCapabilities.ts';
import { PLAN_A } from './fixtures.ts';
import type { Plan } from '../../src/types/index.ts';

// Use the real store/history/autosave scheduler; intercept only the IndexedDB persistence boundary.
test('bulk commits once, autosaves, restores through one undo/redo, and rejects stale/unconfirmed requests', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  setWorkspaceWidth(1200);
  const plan = structuredClone(PLAN_A);
  plan.rooms = plan.rooms.slice(0, 2).map(room => ({ ...room, workItems: [] }));
  const saved: Plan[] = [];
  useAppStore.setState({ project: plan, history: [], future: [], dirty: false, persist: async () => {
    saved.push(structuredClone(useAppStore.getState().project!));
    useAppStore.setState({ dirty: false });
  } });
  const configs = [{ type: 'painting' as const, heightM: 2.8, wastePercent: 5, deductOpenings: true }];
  const ids = plan.rooms.map(r => r.id);
  assert.equal(useAppStore.getState().applyBulkTakeoff(plan, ids, configs, 'update-existing', false), 'blocked');
  assert.equal(useAppStore.getState().history.length, 0);
  assert.equal(useAppStore.getState().applyBulkTakeoff({ ...plan }, ids, configs, 'add-missing', false), 'stale');
  assert.equal(useAppStore.getState().applyBulkTakeoff(plan, ids, configs, 'add-missing', false), 'applied');
  const after = useAppStore.getState().project!;
  assert.equal(after.rooms.filter(r => r.workItems.length === 1).length, 2);
  assert.equal(useAppStore.getState().history.length, 1);
  assert.equal(useAppStore.getState().dirty, true);
  assert.equal(saved.length, 0);
  t.mock.timers.tick(800);
  await Promise.resolve();
  assert.deepEqual(saved[0], after);
  useAppStore.getState().undo();
  assert.strictEqual(useAppStore.getState().project, plan);
  assert.equal(useAppStore.getState().future.length, 1);
  t.mock.timers.tick(800);
  assert.deepEqual(saved[1], plan);
  useAppStore.getState().redo();
  assert.strictEqual(useAppStore.getState().project, after);
  t.mock.timers.tick(800);
  assert.deepEqual(saved[2], after);
  assert.equal(useAppStore.getState().applyBulkTakeoff(after, ids, configs, 'add-missing', false), 'no-change');
  assert.equal(useAppStore.getState().history.length, 1);
  // A preceding text edit stays a separate history action when bulk flushes its debounce.
  useAppStore.getState().updateRoom(ids[0], { name: 'Edited Room' });
  const edited = useAppStore.getState().project!;
  assert.equal(useAppStore.getState().applyBulkTakeoff(after, ids, configs, 'add-missing', false), 'stale');
  assert.equal(useAppStore.getState().applyBulkTakeoff(edited, ids, [{ type: 'panels', heightM: .07 }], 'add-missing', false), 'applied');
  assert.equal(useAppStore.getState().history.length, 3);
  useAppStore.getState().undo();
  assert.strictEqual(useAppStore.getState().project, edited);
  useAppStore.getState().undo();
  assert.strictEqual(useAppStore.getState().project, after);
  t.mock.timers.tick(800);
  setWorkspaceWidth(600);
  assert.equal(useAppStore.getState().applyBulkTakeoff(after, ids, configs, 'add-missing', false), 'blocked');
  setWorkspaceWidth(1200);
});
