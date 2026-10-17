import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { create } from 'zustand';

// Read the fixture's current store state when server-rendering these browser components.
const createForRender = (initializer) => {
  if (!initializer) return createForRender;
  const store = create(initializer);
  return Object.assign((selector = (state) => state) => selector(store.getState()), store);
};
await mock.module('zustand', { namedExports: { create: createForRender, useStore: (store, selector = (state) => state) => selector(store.getState()) } });
registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); }
    catch (error) {
      if (specifier.startsWith('.') && !specifier.endsWith('.tsx')) return next(`${specifier}.tsx`, context);
      throw error;
    }
  },
  load(url, context, next) {
    if (url.endsWith('.svg')) return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(url)}` };
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: '' };
    if (!url.endsWith('.tsx')) return next(url, context);
    return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText };
  },
});
const { authStore } = await import('../../src/store/authStore.ts');
const { accountStore } = await import('../../src/store/accountStore.ts');
const { FLAGS_OFF } = await import('../../src/lib/account/accountApi.ts');
const { AuthForm } = await import('../../src/components/AuthDialog.tsx');
const { default: Gate } = await import('../../src/components/LegalAccessGate.tsx');
const { default: AccountPage } = await import('../../src/components/AccountPage.tsx');
const { useAccountUi } = await import('../../src/store/accountUi.ts');
const { translate } = await import('../../src/i18n/index.ts');
const render = (Component, props) => renderToStaticMarkup(createElement(Component, props));
const accepted = { displayName: 'Dana', termsVersion: 'pending', termsAcceptedAt: 1, privacyAcceptedAt: 1, onboardingCompleted: true };

test('both Google sign-in modes render an unchecked agreement and a disabled OAuth button before acceptance', () => {
  for (const initialMode of ['signIn', 'create']) {
    const html = render(AuthForm, { reason: 'account', initialMode, onClose() {}, t: (key, params) => translate('en', key, params) });
    assert.match(html, /type="checkbox"/);
    assert.doesNotMatch(html, /type="checkbox"[^>]*checked/);
    assert.match(html, /auth-google" disabled=""/);
    assert.match(html, /href="\/terms"/);
    assert.match(html, /href="\/privacy"/);
  }
});

test('an unsigned account cannot mount service controls or dismiss required consent', () => {
  authStore.setState({ status: 'signedIn', user: { id: 'test' } });
  accountStore.setState({ profile: { ...accepted, termsVersion: null }, flags: FLAGS_OFF, needsOnboarding: true, loading: false, loadFailed: false });
  const html = render(Gate, { children: createElement('button', null, 'service-marker') });
  assert.doesNotMatch(html, /service-marker|app-dialog-close/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /type="submit"[^>]*disabled/);
  accountStore.setState({ profile: accepted, needsOnboarding: false });
  assert.match(render(Gate, { children: createElement('button', null, 'service-marker') }), /service-marker/);
});

test('a signed-in billing page has no invoice collection form while payments are unavailable', () => {
  authStore.setState({ status: 'signedIn', user: { id: 'test' } });
  accountStore.setState({ flags: FLAGS_OFF, profile: accepted });
  useAccountUi.setState({ pageOpen: true, section: 'billing' });
  const html = render(AccountPage);
  assert.doesNotMatch(html, /<input|<form/);
  assert.ok(html.includes(translate('he', 'acct.billing.detailsUnavailable')));
});

test('temporary verification failure keeps local controls mounted with one non-modal notice', () => {
  authStore.setState({ status: 'signedIn', user: { id: 'test' } });
  accountStore.setState({ profile: accepted, flags: FLAGS_OFF, needsOnboarding: false, needsName: false, loading: false, loadFailed: true });
  const html = render(Gate, { children: createElement('button', null, 'local-project-controls') });
  assert.match(html, /local-project-controls/);
  assert.doesNotMatch(html, /<dialog/);
  assert.equal((html.match(/class="access-notice"/g) ?? []).length, 1);
});
