import { useCallback } from 'react';
import { loadPdfBlob } from '../db/database';
import { useViewerPdfSource } from './useViewerPdfSource';

/** Main-viewer storage binding for the shared Main/Compare document lifecycle. */
export function useMainPdfSource(
  planId: string | undefined,
  pdfFileName: string | undefined,
  pageNumber: number,
  setNumPages: (count: number) => void,
  errorMessage: string,
) {
  const loadBlob = useCallback(() => planId ? loadPdfBlob(planId) : Promise.resolve(undefined), [planId]);
  const result = useViewerPdfSource(planId ? `plan:${planId}` : undefined, pdfFileName,
    loadBlob, pageNumber, setNumPages, errorMessage);
  return { ...result, sourceKey: planId ? `${planId}:${pageNumber}` : '' };
}
