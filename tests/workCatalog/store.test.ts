import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_A } from '../takeoff/fixtures.ts';
const { useAppStore } = await import('../../src/store/appStore.ts');
const { useWorkCatalog } = await import('../../src/store/workCatalogStore.ts');
const state = () => useAppStore.getState();
const catalog = () => useWorkCatalog.getState();
after(() => state().setProject(null));

test('a custom category is copied into the plan when used; later catalog edits never change the plan until applied', () => {
  state().setProject(structuredClone(PLAN_A));
  const roomId = state().project!.rooms[0].id;
  const drywall = catalog().addCategory({ name: 'Drywall', method: 'manualArea' });
  const board = catalog().addSpec({ categoryId: drywall.id, name: 'Board 12.5 mm' });
  const history = state().history.length;
  state().addCustomWorkItem(roomId, drywall);
  assert.equal(state().history.length, history + 1);
  const item = state().project!.rooms[0].workItems.at(-1)!;
  assert.deepEqual([item.type, item.categoryId, item.method], ['custom', drywall.id, 'manualArea']);
  assert.equal(state().project!.workCatalog!.categories[0].name, 'Drywall');

  state().updateWorkItem(roomId, item.id, { manualQuantity: 20, allocations: [{ id: 'a', specId: board.id, quantity: null }] }, { specs: [board] });
  assert.equal(state().project!.workCatalog!.specs[0].name, 'Board 12.5 mm');

  catalog().updateCategory(drywall.id, { name: 'Drywall walls', method: 'manualLength' });
  catalog().updateSpec(board.id, { name: 'Board 15 mm' });
  assert.equal(state().project!.workCatalog!.categories[0].name, 'Drywall');
  assert.equal(state().project!.rooms[0].workItems.at(-1)!.method, 'manualArea');

  const plan = state().project!;
  state().applyPlanCatalogUpdates({ categories: catalog().categories.filter((c) => c.id === drywall.id), specs: catalog().specs.filter((s) => s.id === board.id) });
  assert.equal(state().project!.workCatalog!.categories[0].name, 'Drywall walls');
  assert.equal(state().project!.workCatalog!.specs[0].name, 'Board 15 mm');
  assert.equal(state().project!.rooms[0].workItems.at(-1)!.method, 'manualLength');
  state().undo();
  assert.deepEqual(state().project, plan);
});

test('catalog CRUD: duplicate copies a category with its items; delete removes both from the catalog only', () => {
  const grout = catalog().addCategory({ name: 'Grout', method: 'manualCount', unitLabel: 'sacks' });
  catalog().addSpec({ categoryId: grout.id, name: 'Epoxy' });
  catalog().addSpec({ categoryId: grout.id, name: 'Cementitious', specification: 'Grey' });
  const copy = catalog().duplicateCategory(grout.id, 'Grout (copy)')!;
  assert.deepEqual(catalog().specs.filter((s) => s.categoryId === copy.id).map((s) => s.name), ['Epoxy', 'Cementitious']);
  const spec = catalog().specs.find((s) => s.categoryId === copy.id)!;
  assert.equal(catalog().duplicateSpec(spec.id, 'Epoxy (copy)')!.categoryId, copy.id);
  catalog().deleteSpec(spec.id);
  catalog().deleteCategory(copy.id);
  assert.ok(!catalog().categories.some((c) => c.id === copy.id));
  assert.ok(!catalog().specs.some((s) => s.categoryId === copy.id));
  assert.ok(catalog().categories.some((c) => c.id === grout.id));
});

test('a work item with its own method is added as its own room item under its category', () => {
  state().setProject(structuredClone(PLAN_A));
  const roomId = state().project!.rooms[0].id;
  const ceiling = catalog().addSpec({ categoryId: 'builtin:painting', name: 'Ceiling paint', method: 'ceilingArea' });
  const before = state().project;
  state().addCustomWorkItem(roomId, null, ceiling);
  const item = state().project!.rooms[0].workItems.at(-1)!;
  assert.deepEqual([item.type, item.categoryId, item.method, item.specId], ['custom', 'builtin:painting', 'ceilingArea', ceiling.id]);
  assert.equal(state().project!.workCatalog!.specs.find((s) => s.id === ceiling.id)!.method, 'ceilingArea');
  // Clearing the method in the catalog returns it to the category's, without storing undefined.
  catalog().updateSpec(ceiling.id, { method: undefined });
  assert.equal('method' in catalog().specs.find((s) => s.id === ceiling.id)!, false);
  state().undo();
  assert.equal(state().project, before);
});

test('the starting catalog is added once and never duplicates or replaces entries', async () => {
  const { ensureCatalogSeeded } = await import('../../src/store/workCatalogStore.ts');
  ensureCatalogSeeded();
  const count = catalog().specs.length;
  assert.ok(catalog().specs.some((s) => s.id === 'seed:paint-ceiling' && s.method === 'ceilingArea'));
  assert.ok(catalog().categories.some((c) => c.id === 'seed:drywall'));
  ensureCatalogSeeded();
  assert.equal(catalog().specs.length, count);
});
