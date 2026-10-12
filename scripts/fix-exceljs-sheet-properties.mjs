import { readFile, rm, writeFile } from 'node:fs/promises';

// ExcelJS 4.4.0 writes CT_SheetPr children in the wrong order. Fix the serializer itself,
// including the browser bundle Vite uses; do not rewrite exported workbooks.
const root = new URL('../node_modules/exceljs/', import.meta.url);
const fixes = [
  {
    path: 'lib/xlsx/xform/sheet/sheet-properties-xform.js',
    before: 'inner = this.map.pageSetUpPr.render(xmlStream, model.pageSetup) || inner;\n      inner = this.map.outlinePr.render(xmlStream, model.outlineProperties) || inner;',
    after: 'inner = this.map.outlinePr.render(xmlStream, model.outlineProperties) || inner;\n      inner = this.map.pageSetUpPr.render(xmlStream, model.pageSetup) || inner;',
  },
  {
    path: 'dist/exceljs.min.js',
    before: 'r=this.map.pageSetUpPr.render(e,t.pageSetup)||r,r=this.map.outlinePr.render(e,t.outlineProperties)||r',
    after: 'r=this.map.outlinePr.render(e,t.outlineProperties)||r,r=this.map.pageSetUpPr.render(e,t.pageSetup)||r',
  },
];

for (const fix of fixes) {
  const path = new URL(fix.path, root);
  const source = await readFile(path, 'utf8');
  if (source.includes(fix.after) && !source.includes(fix.before)) continue;
  if (source.split(fix.before).length !== 2) {
    throw new Error(`ExcelJS serializer changed: review the sheetPr ordering fix for ${fix.path}.`);
  }
  await writeFile(path, source.replace(fix.before, fix.after));
}

// Vite's prebundled copy otherwise retains the old serializer after a server restart.
await rm(new URL('../node_modules/.vite', import.meta.url), { recursive: true, force: true });
