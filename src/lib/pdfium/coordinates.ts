import type { PdfMatrix } from './protocol';

/** compose(a,b) applies b first, then a; tuples use the PDF affine convention. */
export function compose(a: PdfMatrix, b: PdfMatrix): PdfMatrix {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
    a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
    a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}
export function inverse(m: PdfMatrix): PdfMatrix {
  const d=m[0]*m[3]-m[1]*m[2];
  if (!Number.isFinite(d) || d === 0) throw new Error('Non-invertible PDF page mapping');
  return [m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,
    (m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d];
}
export function apply(m: PdfMatrix, x: number, y: number): [number, number] {
  return [m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
}

/** PDFium's default display matrix, derived from its effective CropBox ∩ MediaBox.
 * This includes intrinsic rotation and the top-left origin, but not PDF.js UserUnit.
 * Render matrix = raster crop × canonical PDF.js viewport × inverse(PDFium display).
 * Consequently UserUnit and any page-box origin differences stay visual transforms.
 */
export function pdfiumDisplayMatrix(box: [number, number, number, number], rotation: number): PdfMatrix {
  const [left,bottom,right,top]=box;
  switch (rotation) {
    case 0: return [1,0,0,-1,-left,top];
    case 90: return [0,1,1,0,-bottom,-left];
    case 180: return [-1,0,0,1,right,-bottom];
    case 270: return [0,-1,-1,0,top,right];
    default: throw new Error('Unsupported PDF page rotation');
  }
}
