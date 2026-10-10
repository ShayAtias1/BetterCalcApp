import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { PDFArray, PDFDocument, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { imagePlacement, normalizePlanFile, planFileKind, PlanImportError } from '../../src/lib/planFileImport.ts';
import { useAppStore } from '../../src/store/appStore.ts';

const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAIBAQEBAQIBAQECAgICAgQDAgICAgUEBAMEBgUGBgYFBgYGBwkIBgcJBwYGCAsICQoKCgoKBggLDAsKDAkKCgr/2wBDAQICAgICAgUDAwUKBwYHCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgr/wAARCAACAAMDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnf2+fgj8F7f8Aa98b2dv8IvC8cNtqEMFvEmgWwWKKO2iRI1ATCqqqqgDgAADgUUUV/qv4I/8AJmOGv+xfgv8A1GpH9GcJf8kpgP8ArxS/9NxP/9k=', 'base64');
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array) {
  const body = Buffer.concat([Buffer.from(type), data]), result = Buffer.alloc(body.length + 8);
  result.writeUInt32BE(data.length, 0); body.copy(result, 4); result.writeUInt32BE(crc32(body), result.length - 4);
  return result;
}
function png({ depth = 8, animated = false, width = 2, height = 1 } = {}) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = depth; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header),
    ...(animated ? [chunk('acTL', Buffer.from([0,0,0,1,0,0,0,0]))] : []),
    chunk('IDAT', deflateSync(width === 6000 && height === 1 ? Buffer.alloc(24001) : Buffer.from([0,255,0,0,0,0,255,0,128]))), chunk('IEND', Buffer.alloc(0))]);
}
function jpegWithOrientation(orientation: number, little: boolean) {
  const exif = Buffer.alloc(32); exif.write('Exif\0\0'); exif.write(little ? 'II' : 'MM', 6);
  const short = (v: number, p: number) => little ? exif.writeUInt16LE(v, p) : exif.writeUInt16BE(v, p);
  const long = (v: number, p: number) => little ? exif.writeUInt32LE(v, p) : exif.writeUInt32BE(v, p);
  short(42, 8); long(8, 10); short(1, 14); short(0x0112, 16); short(3, 18); long(1, 20); short(orientation, 24);
  const segment = Buffer.alloc(4); segment[0] = 0xff; segment[1] = 0xe1; segment.writeUInt16BE(exif.length + 2, 2);
  return Buffer.concat([JPEG.subarray(0, 2), segment, exif, JPEG.subarray(2)]);
}
function file(bytes: Uint8Array, name: string, type = '') { return new File([new Uint8Array(bytes).buffer], name, { type }); }
async function pdfOf(upload: File) { return PDFDocument.load(await (await normalizePlanFile(upload)).arrayBuffer()); }
function images(doc: PDFDocument) {
  return doc.context.enumerateIndirectObjects().map(([, obj]) => obj).filter((obj): obj is PDFRawStream =>
    obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
}
test('PDFs pass through unchanged; allowed extensions/MIME and unsupported formats', async () => {
  const pdf = new File(['historical pass-through'], 'plan.pdf');
  assert.strictEqual(await normalizePlanFile(pdf), pdf);
  assert.equal(planFileKind({ name: 'scan.JPEG', type: '' }), 'jpeg');
  assert.equal(planFileKind({ name: 'scan', type: 'image/png' }), 'png');
  assert.equal(planFileKind({ name: 'scan.webp', type: 'image/webp' }), null);
  await assert.rejects(normalizePlanFile(file(png(), 'scan.gif', 'image/gif')), { code: 'unsupported' });
  await assert.rejects(normalizePlanFile(file(JPEG, 'scan.png')), { code: 'invalidImage' });
  await assert.rejects(normalizePlanFile(file(png(), 'scan.jpg')), { code: 'invalidImage' });
});
test('PNG preserves RGB pixels, alpha mask, page box and raster dimensions', async () => {
  const doc = await pdfOf(file(png(), 'transparent.PNG'));
  assert.equal(doc.getPageCount(), 1); assert.deepEqual(doc.getPage(0).getSize(), { width: 2, height: 1 });
  assert.deepEqual(doc.getPage(0).getMediaBox(), { x: 0, y: 0, width: 2, height: 1 });
  assert.equal(doc.getPage(0).getRotation().angle, 0);
  const rgb = images(doc).find(s => s.dict.has(PDFName.of('SMask')))!;
  assert.deepEqual([...decodePDFRawStream(rgb).decode()], [255,0,0,0,255,0]);
  const alpha = doc.context.lookup(rgb.dict.get(PDFName.of('SMask'))!);
  assert.ok(alpha instanceof PDFRawStream);
  assert.deepEqual([...decodePDFRawStream(alpha).decode()], [0,128]);
});
test('all eight EXIF orientations, both byte orders: correct corner placement and unchanged JPEG bytes', async () => {
  // Expected displayed order of raw TL, TR, BL, BR corners (PDF coordinates).
  const orders = [[0,1,2,3],[1,0,3,2],[3,2,1,0],[2,3,0,1],[0,2,1,3],[1,3,0,2],[3,1,2,0],[2,0,3,1]];
  for (const little of [true, false]) for (let orientation = 1; orientation <= 8; orientation++) {
    const bytes = jpegWithOrientation(orientation, little), doc = await pdfOf(file(bytes, 'scan.jpeg'));
    const width = orientation >= 5 ? 2 : 3, height = orientation >= 5 ? 3 : 2;
    assert.deepEqual(doc.getPage(0).getSize(), { width, height });
    assert.equal(doc.getPage(0).getRotation().angle, 0);
    const embedded = images(doc)[0];
    assert.equal(embedded.dict.lookup(PDFName.of('Width'), PDFNumber).asNumber(), 3);
    assert.equal(embedded.dict.lookup(PDFName.of('Height'), PDFNumber).asNumber(), 2);
    assert.deepEqual(Buffer.from(embedded.getContents()), bytes);
    const { matrix: [a,b,c,d,e,f] } = imagePlacement(3, 2, orientation);
    const corners = [[0,height],[width,height],[0,0],[width,0]];
    [[0,1],[1,1],[0,0],[1,0]].forEach(([u,v], index) => {
      const actual = [a*u+c*v+e, b*u+d*v+f].map(n => n === 0 ? 0 : n);
      assert.deepEqual(actual, corners[orders[orientation-1][index]], `orientation ${orientation}`);
    });
    const content = doc.getPage(0).node.Contents();
    assert.ok(content);
    const stream = content instanceof PDFArray ? content.lookup(0) : content;
    assert.ok(stream instanceof PDFRawStream);
    assert.ok(Buffer.from(decodePDFRawStream(stream).decode()).toString().includes(`${a} ${b} ${c} ${d} ${e} ${f} cm`));
  }
});
test('plain JPEG is embedded without recompression; large placement changes units, not pixels', async () => {
  const doc = await pdfOf(file(JPEG, 'scan.jpg', 'image/jpeg'));
  assert.deepEqual(Buffer.from(images(doc)[0].getContents()), JPEG);
  const wide = await pdfOf(file(png({ width: 6000 }), 'wide.png'));
  assert.deepEqual(wide.getPage(0).getSize(), { width: 5500, height: 5500 / 6000 });
  for (const raster of images(wide)) assert.equal(raster.dict.lookup(PDFName.of('Width'), PDFNumber).asNumber(), 6000);
  const p = imagePlacement(10000, 5000, 1);
  assert.deepEqual([p.width, p.height], [5500, 2750]);
});
test('high-bit-depth, animated, corrupt, excessive and malformed EXIF inputs fail explicitly', async () => {
  for (const [bytes, code] of [[png({ depth: 16 }), 'highBitDepth'], [png({ animated: true }), 'animatedPng'],
    [png({ width: 10000, height: 5000 }), 'imageTooLarge'], [png().subarray(0, 25), 'invalidImage'],
    [jpegWithOrientation(9, true), 'invalidImage']] as const) {
    await assert.rejects(normalizePlanFile(file(bytes, code === 'invalidImage' && bytes[0] === 255 ? 'bad.jpg' : 'bad.png')),
      error => error instanceof PlanImportError && error.code === code);
  }
  const huge = file(png(), 'huge.png'); Object.defineProperty(huge, 'size', { value: 100_000_001 });
  await assert.rejects(normalizePlanFile(huge), { code: 'imageTooLarge' });
});
test('conversion failure leaves plans and project untouched before any IndexedDB write', async () => {
  const project = { id: 'import-project', name: 'Import', createdAt: 1, updatedAt: 1, planIds: [] };
  useAppStore.setState({ currentProject: project, projectPlans: [], project: null });
  await assert.rejects(useAppStore.getState().addPlan(file(png({ depth: 16 }), 'unsupported.png'), 'Image'), { code: 'highBitDepth' });
  assert.strictEqual(useAppStore.getState().currentProject, project);
  assert.deepEqual(useAppStore.getState().projectPlans, []);
  assert.equal(useAppStore.getState().project, null);
  useAppStore.setState({ currentProject: null });
});
test('changing the project while conversion is pending prevents saving to either project', async () => {
  const project = { id: 'first', name: 'First', createdAt: 1, updatedAt: 1, planIds: [] };
  useAppStore.setState({ currentProject: project, projectPlans: [] });
  const upload = file(png(), 'plan.png');
  let resolve!: (bytes: ArrayBuffer) => void;
  upload.arrayBuffer = () => new Promise<ArrayBuffer>(done => { resolve = done; });
  const pending = useAppStore.getState().addPlan(upload, 'Image');
  useAppStore.setState({ currentProject: { ...project, id: 'second' } });
  resolve(new Uint8Array(png()).buffer);
  await assert.rejects(pending, { code: 'projectChanged' });
  assert.deepEqual(useAppStore.getState().projectPlans, []);
  useAppStore.setState({ currentProject: null });
});
