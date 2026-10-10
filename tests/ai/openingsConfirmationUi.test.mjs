import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

test('openings use the app AI confirmation without exposing costs', async () => {
  const server = await createServer({ configFile: false, plugins: [react()], server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route(/\/ai\/(?:health|opening-)/, route => { errors.push('Unexpected AI request'); return route.abort(); });
    // Isolate transport only: render the real openings button and app confirmation modal.
    await page.route('**/src/lib/ai/openingsUi.ts', route => route.fulfill({ contentType: 'text/javascript', body: `
      export const useOpeningsAiUi = () => ({jobs:[],planId:'test',pageNumber:1,sourceHash:'source',busy:false,error:null});
      export const initializeOpeningsAiUi = async () => {};
      export const activateOpeningsAiPage = async () => {};
      export const requestOpeningDetection = async confirm => {
        window.preparedOpening = {preview:{estimatedCostUsd:0.205,reservationUsd:5.61,previewId:'bound-preview',requestDigest:'bound-request'},previousPaidAttempt:true};
        window.acceptedOpening = await confirm(window.preparedOpening);
      };
    ` }));
    const html = await server.transformIndexHtml('/confirmation-test', '<html lang="he" dir="rtl"><body><div id="root"></div></body></html>');
    await page.route('**/confirmation-test', route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/confirmation-test`);
    await page.evaluate(async () => {
      const { default: React } = await import('/node_modules/.vite/deps/react.js');
      const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { default: Panel } = await import('/src/components/AiOpeningsPanel.tsx');
      const { default: Dialogs } = await import('/src/components/AppDialogs.tsx');
      const { useAppStore } = await import('/src/store/appStore.ts');
      const { useLanguageStore } = await import('/src/i18n/index.ts');
      useAppStore.setState({project:{id:'test'},currentPage:1});
      window.confirmationLanguage = useLanguageStore;
      createRoot(document.getElementById('root')).render(React.createElement(React.Fragment,null,React.createElement(Panel),React.createElement(Dialogs)));
    });
    for (const language of ['he', 'en']) {
      await page.evaluate(language => window.confirmationLanguage.setState({language}), language);
      await page.getByRole('button', {name:language === 'he' ? 'זיהוי דלתות וחלונות באמצעות AI' : 'Detect doors and windows with AI',exact:true}).click();
      const dialog = page.getByRole('dialog');
      const copy = await dialog.innerText();
      assert.ok(!/0\.205|5\.61|USD|\$|reservation|estimated|שריון|משוערת/i.test(copy));
      assert.ok(copy.includes('OpenAI'));
      assert.ok(copy.includes(language === 'he' ? 'אישור ידני' : 'manual review and approval'));
      assert.ok(copy.includes(language === 'he' ? 'בקשת זיהוי חדשה' : 'new detection request'));
      assert.equal(await page.evaluate(() => window.preparedOpening.preview.requestDigest), 'bound-request');
      const start = dialog.getByRole('button',{name:language === 'he' ? 'התחל זיהוי' : 'Start detection',exact:true});
      assert.equal(await start.count(),1);
      // Escape cancels just as it does for room detection. Submission requires an explicit click.
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.acceptedOpening === false);
      await page.getByRole('button', {name:language === 'he' ? 'זיהוי דלתות וחלונות באמצעות AI' : 'Detect doors and windows with AI',exact:true}).click();
      await start.click();
      await page.waitForFunction(() => window.acceptedOpening === true);
    }
    assert.deepEqual(errors,[]);
  } finally { await browser?.close(); await server.close(); }
});
