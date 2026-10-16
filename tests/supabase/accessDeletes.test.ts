// Approved policy: an expired guest can still view, export and delete local projects; only creating and
// editing need registration. Real IndexedDB (fake-indexeddb) so nothing here is mocked.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_A } from '../takeoff/fixtures.ts';

Object.assign(globalThis, { DOMMatrix: class {}, DOMPoint: class {}, DOMRect: class {}, Path2D: class {} });
const db = await import('../../src/db/database.ts');
const { useAppStore } = await import('../../src/store/appStore.ts');
const { setEditingAllowed } = await import('../../src/lib/workspaceCapabilities.ts');
const { useAccessPrompt } = await import('../../src/lib/access/editGuard.ts');
const { exportProjects } = await import('../../src/lib/backup/backupService.ts');

async function seed(id: string) {
  const plan = { ...structuredClone(PLAN_A), id: `${id}-plan` };
  await db.savePlan(plan);
  await db.saveProject({ id, name: id, createdAt: 1, updatedAt: 1, planIds: [plan.id] });
  return plan;
}

test('a locked (expired) guest can still view, export and delete local projects', async () => {
  const keep = await seed('keep');
  await seed('gone');
  await seed('gone-plan-only');
  setEditingAllowed(false);
  try {
    // view
    assert.equal((await db.loadPlan(keep.id))?.id, keep.id);
    const ids = async () => (await db.listProjects()).map((p) => p.project.id);
    assert.deepEqual((await ids()).filter((id) => id.startsWith('keep') || id.startsWith('gone')).sort(), ['gone', 'gone-plan-only', 'keep']);
    // export
    const exported = await exportProjects(['keep']);
    assert.ok(exported && exported.projectCount === 1);
    // delete a project (as the start screen does) and a plan (as the project overview does)
    await db.deleteProject('gone');
    await useAppStore.getState().deletePlan('gone-plan-only-plan');
    await useAppStore.getState().deleteComparison('missing');
    assert.deepEqual((await ids()).filter((id) => id.startsWith('keep') || id.startsWith('gone')).sort(), ['gone-plan-only', 'keep']);
    assert.equal(await db.loadPlan('gone-plan-only-plan'), undefined);
    // nothing asked the user to register
    assert.equal(useAccessPrompt.getState().open, false);
    // the kept project is untouched
    const after = await db.loadPlan(keep.id);
    assert.equal(after?.rooms.length, keep.rooms.length);
    assert.equal(after?.updatedAt, keep.updatedAt);
  } finally {
    setEditingAllowed(true);
  }
});
