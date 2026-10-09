import { PDFDocument, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from 'pdf-lib';

export const PLAN_FILE_ACCEPT = 'application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg';
type FileKind = 'pdf' | 'png' | 'jpeg';
export type PlanImportErrorCode = 'unsupported' | 'invalidImage' | 'highBitDepth' | 'animatedPng' | 'imageTooLarge' | 'projectChanged';
export class PlanImportError extends Error {
  readonly code: PlanImportErrorCode;
  constructor(code: PlanImportErrorCode) { super(code); this.name = 'PlanImportError'; this.code = code; }
}
function fail(code: PlanImportErrorCode): never { throw new PlanImportError(code); }
const MAX_IMAGE_BYTES = 100_000_000;
const MAX_IMAGE_PIXELS = 40_000_000;

/** Preserve the historical PDF MIME-or-extension acceptance rule. Images are checked again by signature. */
export function planFileKind(file: Pick<File, 'name' | 'type'>): FileKind | null {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (/\.png$/.test(name) || file.type === 'image/png') return 'png';
  if (/\.jpe?g$/.test(name) || file.type === 'image/jpeg') return 'jpeg';
  return null;
}
function checkDimensions(width: number, height: number) {
  if (!width || !height) fail('invalidImage');
  if (width * height > MAX_IMAGE_PIXELS) fail('imageTooLarge');
}
function pngDimensions(bytes: Uint8Array): [number, number] {
  if (![137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v)) fail('invalidImage');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8, dimensions: [number, number] | undefined;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset), end = offset + 12 + length;
    if (end > bytes.length) fail('invalidImage');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!dimensions && type !== 'IHDR') fail('invalidImage');
    if (type === 'IHDR') {
      if (dimensions || length !== 13) fail('invalidImage');
      const depth = bytes[offset + 16], color = bytes[offset + 17];
      if (depth > 8) fail('highBitDepth');
      const validDepths: Record<number, number[]> = { 0: [1,2,4,8], 2: [8], 3: [1,2,4,8], 4: [8], 6: [8] };
      if (!validDepths[color]?.includes(depth) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] > 1) fail('invalidImage');
      dimensions = [view.getUint32(offset + 8), view.getUint32(offset + 12)];
      checkDimensions(...dimensions);
    }
    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') fail('animatedPng');
    if (type === 'IEND') {
      if (length !== 0 || !dimensions) fail('invalidImage');
      return dimensions;
    }
    offset = end;
  }
  return fail('invalidImage');
}

function exifOrientation(bytes: Uint8Array): number | undefined {
  if (bytes.length < 6 || String.fromCharCode(...bytes.subarray(0, 6)) !== 'Exif\0\0') return;
  const view = new DataView(bytes.buffer, bytes.byteOffset + 6, bytes.byteLength - 6);
  if (view.byteLength < 8) fail('invalidImage');
  const order = view.getUint16(0), little = order === 0x4949;
  if ((!little && order !== 0x4d4d) || view.getUint16(2, little) !== 42) fail('invalidImage');
  const start = view.getUint32(4, little);
  if (start < 8 || start + 2 > view.byteLength) fail('invalidImage');
  const count = view.getUint16(start, little);
  if (start + 2 + count * 12 + 4 > view.byteLength) fail('invalidImage');
  for (let i = 0; i < count; i++) {
    const pos = start + 2 + i * 12;
    if (view.getUint16(pos, little) !== 0x0112) continue;
    if (view.getUint16(pos + 2, little) !== 3 || view.getUint32(pos + 4, little) !== 1) fail('invalidImage');
    const orientation = view.getUint16(pos + 8, little);
    if (orientation < 1 || orientation > 8) fail('invalidImage');
    return orientation;
  }
}
function jpegMetadata(bytes: Uint8Array): { width: number; height: number; orientation: number } {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) fail('invalidImage');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 2, width = 0, height = 0, orientation = 1;
  while (pos < bytes.length) {
    if (bytes[pos++] !== 0xff) fail('invalidImage');
    while (bytes[pos] === 0xff) pos++;
    const marker = bytes[pos++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (pos + 2 > bytes.length) fail('invalidImage');
    const length = view.getUint16(pos);
    if (length < 2 || pos + length > bytes.length) fail('invalidImage');
    if (marker === 0xe1) orientation = exifOrientation(bytes.subarray(pos + 2, pos + length)) ?? orientation;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8 || bytes[pos + 2] !== 8) fail('invalidImage');
      height = view.getUint16(pos + 3); width = view.getUint16(pos + 5);
      checkDimensions(width, height);
    } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4,0xc8,0xcc].includes(marker)) fail('invalidImage');
    pos += length;
  }
  checkDimensions(width, height);
  return { width, height, orientation };
}

/** Image unit-square -> fitted PDF page, with EXIF orientation baked into content (not /Rotate).
 * Matrices use PDF's bottom-left origin; EXIF's mirrored cases are handled without a canvas decode.
 */
export function imagePlacement(width: number, height: number, orientation: number) {
  const swapped = orientation >= 5;
  const factor = Math.min(1, 5500 / Math.max(width, height));
  const w = (swapped ? height : width) * factor, h = (swapped ? width : height) * factor;
  const matrices: Record<number, [number, number, number, number, number, number]> = {
    1: [w,0,0,h,0,0], 2: [-w,0,0,h,w,0], 3: [-w,0,0,-h,w,h], 4: [w,0,0,-h,0,h],
    5: [0,-h,-w,0,w,h], 6: [0,-h,w,0,0,h], 7: [0,h,w,0,0,0], 8: [0,h,-w,0,w,0],
  };
  const matrix = matrices[orientation];
  if (!matrix) fail('invalidImage');
  return { width: w, height: h, matrix };
}

/** Converts once, before any plan record exists. Source pixels and JPEG compressed bytes stay intact. */
export async function normalizePlanFile(file: File): Promise<Blob> {
  const kind = planFileKind(file);
  if (!kind) fail('unsupported');
  if (kind === 'pdf') return file;
  if (file.size > MAX_IMAGE_BYTES) fail('imageTooLarge');
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const metadata = kind === 'png'
      ? (() => { const [width, height] = pngDimensions(bytes); return { width, height, orientation: 1 }; })()
      : jpegMetadata(bytes);
    const placement = imagePlacement(metadata.width, metadata.height, metadata.orientation);
    const doc = await PDFDocument.create();
    const image = kind === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const page = doc.addPage([placement.width, placement.height]);
    const imageName = page.node.newXObject('Image', image.ref);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...placement.matrix), drawObject(imageName), popGraphicsState());
    const pdf = await doc.save();
    return new Blob([pdf.slice().buffer as ArrayBuffer], { type: 'application/pdf' });
  } catch (error) {
    if (error instanceof PlanImportError) throw error;
    throw new PlanImportError('invalidImage');
  }
}
