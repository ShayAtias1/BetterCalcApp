import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Options every untrusted PDF is opened with. XFA forms (scripted, HTML-like content) are never
 * rendered; pdf.js 6 has no eval-based font path left to disable, and the app uses no annotation or
 * scripting layer. Keep pdfjs-dist at or above 6.2.108 (GHSA-hq66-cqwq-w95j).
 */
export const SAFE_PDF_OPTIONS = { enableXfa: false } as const;

export { pdfjsLib };
