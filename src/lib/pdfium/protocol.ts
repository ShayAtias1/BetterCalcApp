export type PdfMatrix = [number, number, number, number, number, number];
export interface ViewerRegion { x: number; y: number; width: number; height: number }
export interface PdfiumRasterRequest {
  kind: 'render';
  pageNumber: number;
  rotation: number;
  nativeTransform: PdfMatrix;
  scale: number;
  region: ViewerRegion;
  width: number;
  height: number;
  transparent?: boolean;
}
export type PdfiumRequest =
  | { kind: 'open'; bytes: ArrayBuffer }
  | PdfiumRasterRequest
  | { kind: 'release'; pageNumber: number }
  | { kind: 'close' };
export type PdfiumResult =
  | { kind: 'open'; numPages: number }
  | { kind: 'render'; width: number; height: number; pixels: ArrayBuffer }
  | { kind: 'release' | 'close' };
export type PdfiumReply = { id: number; result: PdfiumResult } | { id: number; error: string };
export type PdfiumMessage = PdfiumRequest & { id: number };
