import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

test('space checkboxes, select all, one confirmation and safe cancellation', async () => {
  const server = await createServer({ configFile: false, plugins: [react()], define: { __APP_VERSION__: JSON.stringify('test') }, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser;
  try {
    await server.listen(); browser = await chromium.launch({ headless: true });
    const page = await browser.newPage(); page.setDefaultTimeout(5000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/src/components/AiSpaceDetectionPanel.tsx', route => route.fulfill({ contentType: 'text/javascript', body: 'export default function AiSpaceDetectionPanel(){return null;}' }));
    const html = await server.transformIndexHtml('/bulk-delete-test', '<html lang="he" dir="rtl"><body><div id="root"></div></body></html>');
    await page.route('**/bulk-delete-test', route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/bulk-delete-test`);
    await page.evaluate(async () => {
      const { default: React } = await import('/node_modules/.vite/deps/react.js');
      const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { default: Panel } = await import('/src/components/RoomPanel.tsx');
      const { default: Dialogs } = await import('/src/components/AppDialogs.tsx');
      const { useAppStore: store } = await import('/src/store/appStore.ts');
      const { PLAN_A } = await import('/tests/takeoff/fixtures.ts');
      await import('/src/index.css');
      window.deletionCalls = [];
      store.setState({project: structuredClone(PLAN_A),currentPage:1,selectedRoomId:null,manuallyCreatedRoomId:null,
        deleteRooms: ids => { window.deletionCalls.push(ids); store.setState({project:{...store.getState().project,rooms:store.getState().project.rooms.filter(r=>!ids.includes(r.id))}}); },
      });
      window.bulkDeleteStore = store;
      window.originalRooms = PLAN_A.rooms.length;
      createRoot(document.getElementById('root')).render(React.createElement(React.Fragment,null,React.createElement(Panel),React.createElement(Dialogs)));
    });
    const remove = page.getByRole('button', { name: 'מחק נבחרים', exact: true });
    assert.equal(await remove.count(), 0);
    assert.equal(await page.getByRole('checkbox', {name:'בחר הכל',exact:true}).count(), 0);
    const rooms = page.getByRole('checkbox', { name: /למחיקה$/ });
    assert.equal(await rooms.count(), await page.evaluate(() => window.originalRooms));
    assert.equal(await page.locator('.room-row-actions').first().evaluate(n=>getComputedStyle(n).opacity), '1');
    const actions = page.locator('.room-row-actions').first();
    const box = await actions.locator('input[type=checkbox]').boundingBox();
    const edit = await actions.locator('button').first().boundingBox();
    assert.ok(box.x < edit.x);
    await rooms.first().check(); await rooms.nth(1).check();
    assert.equal(await page.evaluate(() => window.bulkDeleteStore.getState().selectedRoomId), null);
    assert.ok(await page.getByRole('status').allTextContents().then(text => text.some(s => s.includes('2 חללים נבחרו'))));
    await remove.click();
    assert.equal(await page.getByRole('dialog').count(), 1);
    assert.ok(await page.getByRole('dialog').innerText().then(text => text.includes('2 החללים')));
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.deletionCalls.length), 0);
    assert.equal(await rooms.first().isChecked(), true);
    await remove.click(); await page.getByRole('dialog').getByRole('button', { name: 'מחק', exact: true }).click();
    assert.equal(await page.evaluate(() => window.deletionCalls.length), 1);
    assert.equal(await page.evaluate(() => window.deletionCalls[0].length), 2);
    assert.equal(await remove.count(), 0);
    await rooms.first().check();
    const all = page.getByRole('checkbox', { name: 'בחר הכל', exact: true });
    await all.check();
    assert.ok((await rooms.all()).length > 0);
    for (const checkbox of await rooms.all()) assert.equal(await checkbox.isChecked(), true);
    await all.click(); assert.equal(await remove.count(), 0);
    await rooms.first().check();
    // Navigation while the confirmation is open cannot delete the replacement plan.
    await all.check(); await remove.click();
    await page.evaluate(() => window.bulkDeleteStore.setState({project:{...window.bulkDeleteStore.getState().project,id:'replacement-plan'}}));
    await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(() => window.deletionCalls.length), 1);
    assert.equal(await remove.count(), 0);
    assert.ok(await page.locator('.room-row-actions .danger').count() > 0);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server.close(); }
});
