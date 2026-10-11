// Browser-only globals that pdf.js touches while it loads. Node has none of them, so a test that
// imports the app store (which imports pdf.js) needs stand-ins before any import runs. Defined only
// when missing; files that install their own stand-ins keep them.
for (const name of ['DOMMatrix', 'DOMPoint', 'DOMRect', 'Path2D']) {
  if (!(name in globalThis)) globalThis[name] = class {};
}
