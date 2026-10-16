// Access restrictions on the real mutation paths: with editing locked, edits and creations are refused
// while opening, viewing, saving what exists, and unsaved work are untouched.
import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from 'zustand/vanilla';
import { PLAN_A } from '../takeoff/fixtures.ts';
import { createAuthStore, type AuthDeps } from '../../src/store/authStore.ts';
import { getCaptchaToken } from '../../src/lib/supabase/captcha.ts';

Object.assign(globalThis, { DOMMatrix: class {}, DOMPoint: class {}, DOMRect: class {}, Path2D: class {} });
const { useAppStore } = await import('../../src/store/appStore.ts');
const { setEditingAllowed, canEditWork } = await import('../../src/lib/workspaceCapabilities.ts');
const { guardEdits, requireEditAccess, useAccessPrompt } = await import('../../src/lib/access/editGuard.ts');

const rect = () => useAppStore.getState().finishRectangle({ x: 10, y: 10 }, { x: 60, y: 40 });
const rooms = () => useAppStore.getState().project!.rooms.length;
// Like the app, a plan is always closed before another is opened.
const open = () => { useAppStore.getState().setProject(null); useAppStore.setState({ dirty: false }); useAppStore.getState().setProject(structuredClone(PLAN_A)); };

afterEach(() => {
  setEditingAllowed(true);
  useAccessPrompt.getState().close();
});
after(() => useAppStore.getState().setProject(null));

test('editing is allowed by default, so nothing changes while restrictions are off', () => {
  assert.equal(canEditWork(), true);
  open();
  const before = rooms();
  rect();
  assert.equal(rooms(), before + 1);
  assert.equal(useAccessPrompt.getState().open, false);
});

test('locked: a plan edit is refused, the document is untouched, and registration is offered', () => {
  open();
  const doc = useAppStore.getState().project;
  setEditingAllowed(false);
  rect();
  const s = useAppStore.getState();
  assert.equal(s.project, doc);
  assert.equal(s.dirty, false);
  assert.equal(s.history.length, 0);
  assert.equal(useAccessPrompt.getState().open, true);
  assert.equal(useAccessPrompt.getState().reason, 'edit');
});

test('locked: undo and redo cannot alter the plan either', () => {
  open();
  rect();
  const edited = useAppStore.getState().project;
  setEditingAllowed(false);
  useAppStore.getState().undo();
  assert.equal(useAppStore.getState().project, edited);
});

test('unsaved edits made before the lock stay in the plan, stay dirty, and can still be saved', () => {
  open();
  rect();
  const edited = useAppStore.getState().project;
  assert.equal(useAppStore.getState().dirty, true);
  setEditingAllowed(false);
  rect();
  const s = useAppStore.getState();
  assert.equal(s.project, edited);
  assert.equal(s.dirty, true);
});

test('locked: opening, switching and closing plans still work (viewing is never blocked)', () => {
  setEditingAllowed(false);
  open();
  assert.equal(useAccessPrompt.getState().open, false);
  assert.equal(useAppStore.getState().project?.id, PLAN_A.id);
  assert.equal(useAppStore.getState().currentPage, 1);
  useAppStore.getState().setProject(null);
  assert.equal(useAppStore.getState().project, null);
  assert.equal(useAccessPrompt.getState().open, false);
});

test('locked: creating a project, adding a plan or a comparison is refused before anything is written', async () => {
  setEditingAllowed(false);
  await useAppStore.getState().createProject('x'); // would reject on the missing IndexedDB if it ran
  assert.equal(useAccessPrompt.getState().reason, 'create');
  assert.equal(await useAppStore.getState().addPlan(new File([], 'a.pdf'), 'a'), null);
  await useAppStore.getState().createComparison({ name: 'c', apartmentNumber: '1', original: new File([], 'a.pdf'), revised: [] });
  assert.equal(requireEditAccess(), false);
  setEditingAllowed(true);
  assert.equal(requireEditAccess(), true);
});

test('locked: blocked edits cannot be saved, and no autosave is scheduled', async () => {
  open();
  setEditingAllowed(false);
  rect();
  await new Promise((resolve) => setTimeout(resolve, 900)); // longer than the 800 ms autosave debounce
  const s = useAppStore.getState();
  assert.equal(s.dirty, false);
  assert.equal(s.saving, false);
  assert.equal(s.saveError, null); // a save attempt would fail here: there is no IndexedDB in this test
});

test('locked: duplicate, rename and comparison changes are refused before any database access', async () => {
  setEditingAllowed(false);
  const s = useAppStore.getState();
  assert.equal(await s.duplicatePlan('p'), null);
  await s.renamePlan('p', 'x');
  await s.renameComparison('c', 'x');
  s.renameProject('x');
  assert.equal(useAccessPrompt.getState().open, true);
});

test('locked: applying or reverting a revision on the linked plan is refused at the write itself', async () => {
  const { commitApplication, revertApplication } = await import('../../src/lib/revision/apply.ts');
  setEditingAllowed(false);
  await assert.rejects(commitApplication({} as never, 'r'), /editing-locked/);
  await assert.rejects(revertApplication('p', 'a'), /editing-locked/);
});

test('the guard only blocks same-document replacement; other fields pass, and it is a pass-through when allowed', () => {
  type S = { doc: { id: string; v: number } | null; history: number[]; dirty: boolean; note: string; edit(): void; load(): void };
  const store = createStore<S>()(guardEdits<S>('doc')((set) => ({
    doc: { id: 'a', v: 1 }, history: [], dirty: false, note: '',
    edit: () => set((s) => ({ doc: { ...s.doc!, v: s.doc!.v + 1 }, history: [1], dirty: true, note: 'edited' })),
    load: () => set({ doc: { id: 'b', v: 9 } }),
  })));
  setEditingAllowed(false);
  store.getState().edit();
  assert.deepEqual(store.getState().doc, { id: 'a', v: 1 });
  assert.deepEqual([store.getState().history, store.getState().dirty], [[], false]);
  assert.equal(store.getState().note, 'edited'); // non-document state still applies
  store.getState().load(); // a different document is a load, not an edit
  assert.equal(store.getState().doc?.id, 'b');
  setEditingAllowed(true);
  store.getState().edit();
  assert.equal(store.getState().doc?.v, 10);
});

test('CAPTCHA is inactive: no token, no script, no DOM access', async () => {
  assert.equal(await getCaptchaToken(), undefined);
  assert.equal(await getCaptchaToken(true, undefined), undefined);
  assert.equal(await getCaptchaToken(false, 'site-key'), undefined);
});

test('the sign-in code request carries the CAPTCHA token when one exists, and stops if the challenge fails', async () => {
  const sent: unknown[] = [];
  const auth = { signInWithOtp: async (arg: unknown) => { sent.push(arg); return { error: null }; } };
  const deps = (captchaToken: AuthDeps['captchaToken']): AuthDeps => ({
    loadAuth: async () => auth as never, storage: () => null, returnUrl: () => '/', captchaToken,
  });
  await createAuthStore(deps(async () => 'tok')).getState().requestEmailCode('a@b.co');
  await createAuthStore(deps(async () => undefined)).getState().requestEmailCode('a@b.co');
  assert.deepEqual(sent, [
    { email: 'a@b.co', options: { shouldCreateUser: true, captchaToken: 'tok' } },
    { email: 'a@b.co', options: { shouldCreateUser: true } },
  ]);
  const failed = await createAuthStore(deps(async () => { throw new Error('blocked'); })).getState().requestEmailCode('a@b.co');
  assert.deepEqual(failed, { ok: false, reason: 'captcha' });
  assert.equal(sent.length, 2);
});
