import { pdfjsLib, SAFE_PDF_OPTIONS } from './pdfjsSetup';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { loadPdfBlob } from '../db/database';

const cache = new Map<string, Promise<PDFDocumentProxy>>();

/** Load (and cache) a PDF document by an arbitrary cache key, fetching its Blob lazily on first use. */
export function getPdfDocumentByKey(cacheKey: string, loadBlob: () => Promise<Blob | undefined>): Promise<PDFDocumentProxy> {
  let promise = cache.get(cacheKey);
  if (!promise) {
    promise = loadBlob()
      .then((blob) => {
        if (!blob) throw new Error('PDF file not found in local storage');
        return blob.arrayBuffer();
      })
      .then((buf) => pdfjsLib.getDocument({ ...SAFE_PDF_OPTIONS, data: buf }).promise);
    cache.set(cacheKey, promise);
  }
  return promise;
}

export function getPdfDocument(projectId: string): Promise<PDFDocumentProxy> {
  return getPdfDocumentByKey(projectId, () => loadPdfBlob(projectId));
}

export function clearPdfCache(cacheKey: string) {
  cache.delete(cacheKey);
}
