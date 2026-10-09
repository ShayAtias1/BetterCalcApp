import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

test('opening review reuses room dock/editor and keeps review decisions explicit', async () => {
  const server = await createServer({ configFile: false, plugins: [(await import('@vitejs/plugin-react')).default()], define: { __APP_VERSION__: JSON.stringify('test') }, server: { host: '127.0.0.1', port: 0, open: false }, logLevel: 'error' });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route(/\/ai\/(?:health|opening-)/, route => { errors.push('Unexpected AI request'); return route.abort(); });
    const html = await server.transformIndexHtml('/review-test', '<html lang="he" dir="rtl"><body><div id="root"></div></body></html>');
    await page.route('**/review-test', route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/review-test`);
    await page.evaluate(async () => {
      const { default: React } = await import('/node_modules/.vite/deps/react.js');
      const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { default: Review } = await import('/src/components/AiOpeningsReviewWorkspace.tsx');
      const { default: Panel } = await import('/src/components/OpeningsPanel.tsx');
      const { default: RoomReview } = await import('/src/components/AiReviewWorkspace.tsx');
      const { useAiWorkflow } = await import('/src/lib/ai/workflow.ts');
      const { default: Dialogs } = await import('/src/components/AppDialogs.tsx');
      const { default: Overlay } = await import('/src/components/OpeningsOverlay.tsx');
      const { useAppStore: store } = await import('/src/store/appStore.ts');
      const { useOpeningsAiUi: ui } = await import('/src/lib/ai/openingsUi.ts');
      const { PLAN_A } = await import('/tests/takeoff/fixtures.ts');
      const { reviewPlanOpening, updatePlanOpening } = await import('/src/lib/planOpenings.ts');
      await import('/src/index.css');
      const plan = structuredClone(PLAN_A);
      const base = { planId: plan.id, pageNumber: 1, geometry: { endpointA: { x: 50, y: 50 }, endpointB: { x: 100, y: 50 } },
        kind: 'door', mechanism: 'hinged', walkableAccess: 'supported', source: 'import', roomIds: [], legacyRefs: [],
        widthM: null, heightM: null, sillHeightM: null, quantity: null, approval: { status: 'draft', reviewedAt: null }, createdAt: 1, updatedAt: 1,
        aiDetection: { sourceHash: 'fixture', reviewKey: 'review', bbox: { x1: 50, y1: 40, x2: 100, y2: 60 } } };
      plan.openings = [{ ...base, id: 'a', label: 'Door A' }, { ...base, id: 'b', label: 'Window B', kind: 'window', mechanism: 'fixed', walkableAccess: 'unsupported' },
        { ...base, id: 'uncertain', label: 'Uncertain C', geometry: null, kind: 'unknown', mechanism: 'unknown', walkableAccess: 'unknown' },
        { ...base, id: 'manual', label: 'Manual', source: 'manual', aiDetection: undefined },
        { ...base, id: 'stale', label: 'Old source', aiDetection: { ...base.aiDetection, sourceHash: 'old' } },
        { ...base, id: 'other-page', label: 'Other page', pageNumber: 2 }];
      // Mutations use existing canonical helpers; nothing is written to project storage.
      store.setState({ project: plan, currentPage: 1, selectedOpeningId: null, openingPlacement: null,
        approvePlanOpening: id => store.setState({ project: reviewPlanOpening(store.getState().project, id, 'approved', 2) }),
        rejectPlanOpening: id => store.setState({ project: reviewPlanOpening(store.getState().project, id, 'rejected', 2) }),
        draftPlanOpening: id => store.setState({ project: reviewPlanOpening(store.getState().project, id, 'draft', 2) }),
        updatePlanOpening: (id, patch) => store.setState({ project: updatePlanOpening(store.getState().project, id, patch, 2) }),
        beginOpeningEndpointEdit: id => { store.getState().selectPlanOpening(id); store.setState({ openingPlacement: { openingId: id, preset: 'unknown', start: null } }); },
      });
      ui.setState({ planId: plan.id, pageNumber: 1, sourceHash: 'fixture' });
      useAiWorkflow.setState({resolvedIds:['handled-space'],reviewScope:{planId:plan.id,pageNumber:1}});
      window.openingDeletionCalls = [];
      store.setState({removePlanOpenings: ids => {window.openingDeletionCalls.push(ids);store.setState({project:{...store.getState().project,openings:store.getState().project.openings.filter(o=>!ids.includes(o.id))}});}});
      window.reviewStore = store;
      window.reviewRoot = createRoot(document.getElementById('root'));
      window.renderReview = () => window.reviewRoot.render(React.createElement(React.Fragment, null,
        React.createElement('svg', { width: 500, height: 150 }, React.createElement(Overlay, { zoom: 1, screenToNative: (x, y) => ({ x, y }), hoverPoint: null, editable: true, isPanGesture: () => false })),
        React.createElement('div', {className:'ai-review-workspaces-row',style:{position:'fixed',bottom:0,left:0,right:0}}, React.createElement(RoomReview), React.createElement(Review)), React.createElement('aside', null, React.createElement(Panel, { hideAiEditor: true })), React.createElement(Dialogs)));
      window.renderReview();
    });
    const dock = page.getByRole('region', { name: 'בדיקת דלתות וחלונות AI' });
    const queue = dock.locator('.ai-review-queue');
    assert.equal(await dock.locator('.ai-review-window').count(), 0);
    const roomDock = page.getByRole('region',{name:'בדיקת חללי AI',exact:true});
    assert.equal(await roomDock.locator('.ai-review-window').count(),0);
    const roomLauncherBefore = await roomDock.locator('.ai-review-launcher').boundingBox();
    const openingLauncherBefore = await dock.locator('.ai-review-launcher').boundingBox();
    assert.equal(roomLauncherBefore.y,openingLauncherBefore.y);
    await dock.getByRole('button', {name:'בדיקת דלתות וחלונות AI',exact:true}).click();
    assert.equal(await queue.locator('li').count(), 3);
    assert.deepEqual(await roomDock.locator('.ai-review-launcher').boundingBox(),roomLauncherBefore);
    assert.deepEqual(await dock.locator('.ai-review-launcher').boundingBox(),openingLauncherBefore);
    const compact = await dock.locator('.ai-review-window').boundingBox();
    await dock.getByRole('button',{name:'הארכת תצוגה',exact:true}).click();
    const extended = await dock.locator('.ai-review-window').boundingBox();
    assert.ok(extended.height > compact.height); assert.equal(extended.width,compact.width);
    await dock.getByRole('button',{name:'צמצם תצוגה',exact:true}).click();
    assert.equal((await dock.locator('.ai-review-window').boundingBox()).height,compact.height);
    await roomDock.getByRole('button',{name:'בדיקת חללי AI',exact:true}).click();
    assert.equal(await roomDock.locator('.ai-review-window').count(),1);
    assert.deepEqual(await roomDock.locator('.ai-review-launcher').boundingBox(),roomLauncherBefore);
    await page.setViewportSize({width:900,height:900});
    const narrowRoom = await roomDock.locator('.ai-review-launcher').boundingBox();
    const narrowOpening = await dock.locator('.ai-review-launcher').boundingBox();
    assert.equal(narrowRoom.y,narrowOpening.y);
    assert.equal(narrowRoom.height,narrowOpening.height);
    for (const review of [roomDock,dock]) {
      const popup = await review.locator('.ai-review-window').boundingBox();
      assert.ok(popup.width <= 450); assert.ok(popup.y >= 0);
      assert.ok(await review.locator('.ai-review-window').evaluate(n=>n.scrollWidth <= n.clientWidth + 1));
    }
    await page.setViewportSize({width:1400,height:900});
    await roomDock.getByRole('button',{name:'סגירת החלונית',exact:true}).click();
    assert.equal(await roomDock.locator('.ai-review-window').count(),0);
    assert.equal(await dock.locator('.ai-review-window').count(),1);
    assert.ok(await dock.locator('.ai-review-launcher').innerText().then(t => t.includes('0 / 3')));
    await queue.getByRole('button', { name: /Door A/ }).click();
    assert.equal(await page.evaluate(() => window.reviewStore.getState().selectedOpeningId), 'a');
    assert.ok(await page.locator('[data-opening-id="a"] circle').count() === 2);
    assert.equal(await dock.locator('.opening-creation-methods').count(), 0);
    assert.equal(await page.locator('aside .opening-editor').count(), 0);
    assert.equal(await page.locator('aside .opening-creation-methods').count(), 1);
    await dock.getByRole('button', { name: 'דילוג', exact: true }).click();
    assert.equal(await page.evaluate(() => window.reviewStore.getState().project.openings[0].approval.status), 'draft');
    assert.equal(await page.evaluate(() => window.reviewStore.getState().selectedOpeningId), 'b');
    await dock.getByRole('button', { name: 'הפתח הקודם', exact: true }).click();
    const width = dock.locator('.form-row').filter({ hasText: /^רוחב/ }).locator('input');
    await width.fill('0.9');
    await width.blur();
    assert.equal(await page.evaluate(() => window.reviewStore.getState().project.openings[0].widthM), 0.9);
    await dock.locator('.form-row').filter({ hasText: /^גובה \(מ׳\)/ }).locator('input').fill('2.1');
    assert.equal(await page.evaluate(() => window.reviewStore.getState().project.openings[0].heightM), 2.1);
    await dock.locator('.opening-advanced summary').click();
    await dock.locator('.opening-coordinate-grid label').filter({ hasText: 'A x' }).locator('input').fill('55');
    assert.equal(await page.evaluate(() => window.reviewStore.getState().project.openings[0].geometry.endpointA.x), 55);
    // The existing side selector assigns one/two rooms, without confirming quantities implicitly.
    const sides = dock.locator('.opening-side-selector');
    await sides.nth(0).locator('summary').click();
    await sides.nth(0).getByRole('button', { name: /חדר הורים/ }).click();
    await sides.nth(1).locator('summary').click();
    await sides.nth(1).getByRole('button', { name: /חדר שינה/ }).first().click();
    assert.equal(await page.evaluate(() => window.reviewStore.getState().project.openings[0].roomIds.length), 2);
    assert.equal(await page.evaluate(() => window.reviewStore.getState().project.openings[0].quantityReview.associationsConfirmed), false);
    assert.equal(await dock.getByRole('button', { name: 'אישור', exact: true }).count(), 2);
    await dock.getByRole('button', { name: 'אישור', exact: true }).last().click();
    assert.equal(await page.evaluate(() => window.reviewStore.getState().selectedOpeningId), 'b');
    await dock.getByRole('button', { name: 'דחיית הפתח', exact: true }).click();
    assert.equal(await page.evaluate(() => window.reviewStore.getState().selectedOpeningId), 'uncertain');
    assert.equal(await dock.getByRole('button', { name: 'אישור', exact: true }).last().isDisabled(), true);
    await dock.locator('.form-row').filter({ hasText: /^סוג פתח/ }).locator('select').selectOption('window');
    assert.equal(await dock.getByRole('button', { name: 'אישור', exact: true }).last().isDisabled(), true);
    await dock.getByRole('button', { name: 'בחירת נקודות קצה מחדש בתכנית', exact: true }).click();
    assert.equal(await page.evaluate(() => window.reviewStore.getState().openingPlacement.openingId), 'uncertain');
    assert.equal(await page.evaluate(() => window.reviewStore.getState().project.openings[2].geometry), null);
    assert.ok(await dock.locator('.ai-review-launcher').innerText().then(t => t.includes('2 / 3')));
    // Manual openings still use their original sidebar editor; stale AI sources remain editable there.
    await page.evaluate(() => window.reviewStore.getState().selectPlanOpening('manual'));
    assert.equal(await page.locator('aside .opening-editor').count(), 1);
    await page.evaluate(() => window.reviewStore.getState().selectPlanOpening('stale'));
    assert.equal(await page.locator('aside .opening-editor').count(), 1);
    // Review progress comes from saved opening approval states, rather than component state.
    await page.evaluate(() => { window.reviewRoot.render(null); });
    await page.evaluate(() => { window.renderReview(); });
    assert.ok(await dock.locator('.ai-review-launcher').innerText().then(t => t.includes('2 / 3')));
    assert.equal(await dock.locator('.ai-review-window').count(),0);
    await page.locator('aside').getByRole('button',{name:'עריכה · Door A',exact:true}).click();
    assert.equal(await dock.locator('.ai-review-window').count(),1);
    await dock.getByRole('button',{name:'סגירת החלונית',exact:true}).click();
    assert.equal(await dock.locator('.ai-review-window').count(),0);
    // Opening selection uses the same conditional toolbar and explicit deletion modal.
    const allOpenings = page.locator('aside').getByRole('checkbox',{name:'בחר הכל',exact:true});
    assert.equal(await allOpenings.count(),0);
    const openingBoxes = page.locator('aside').getByRole('checkbox',{name:/למחיקה$/});
    const firstRow = page.locator('aside .opening-list-row').first();
    const box = await firstRow.locator('input[type=checkbox]').boundingBox();
    const edit = await firstRow.getByRole('button',{name:'עריכה · Door A',exact:true}).boundingBox();
    assert.ok(box.x < edit.x);
    await openingBoxes.first().check();
    await allOpenings.check();
    assert.ok(await page.locator('aside').getByRole('status').innerText().then(t=>t.includes('5 פתחים נבחרו')));
    const deleteSelected = page.locator('aside').getByRole('button',{name:'מחק נבחרים',exact:true});
    await deleteSelected.click();
    assert.equal(await page.getByRole('dialog').count(),1);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>window.openingDeletionCalls.length),0);
    await deleteSelected.click();
    await page.getByRole('dialog').getByRole('button',{name:'מחק',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.openingDeletionCalls.length),1);
    assert.equal(await page.evaluate(()=>window.openingDeletionCalls[0].length),5);
    assert.equal(await page.evaluate(()=>window.reviewStore.getState().project.openings[0].pageNumber),2);
    assert.equal(await allOpenings.count(),0);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server.close(); }
});
