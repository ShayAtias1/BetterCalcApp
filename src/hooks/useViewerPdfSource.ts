import { useEffect, useRef, useState } from 'react';
import { subscribePdfBlobChanges } from '../lib/pdfBlobEvents';
import { ViewerPdfDocument, isViewerRenderCancelled, type ViewerPageSource } from '../lib/pdfViewerSource';
import { trackError } from '../lib/analytics';

/** Owned viewer document/page lifecycle shared by Main and Compare; exports retain their own PDF.js cache. */
export function useViewerPdfSource(
  documentId: string | undefined,
  pdfFileName: string | undefined,
  loadBlob: () => Promise<Blob | undefined>,
  pageNumber: number,
  setNumPages: (count: number) => void,
  errorMessage: string,
) {
  const [revision, setRevision] = useState(0);
  const [session, setSession] = useState<{ key: string; document: ViewerPdfDocument } | null>(null);
  const [page, setPage] = useState<{ key: string; source: ViewerPageSource } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const errorText = useRef(errorMessage);
  errorText.current = errorMessage;
  const documentKey = documentId ? JSON.stringify([documentId, pdfFileName, revision]) : '';
  const pageKey = `${documentKey}:${pageNumber}`;

  useEffect(() => subscribePdfBlobChanges((changedId) => {
    if (changedId === documentId) setRevision((value) => value + 1);
  }), [documentId]);

  useEffect(() => {
    setLoadError(null);
    setSession(null);
    if (!documentId) return;
    const controller = new AbortController();
    let owned: ViewerPdfDocument | null = null;
    void ViewerPdfDocument.open(loadBlob, controller.signal).then((document) => {
      if (controller.signal.aborted) { document.dispose(); return; }
      owned = document;
      setNumPages(document.numPages);
      setSession({ key: documentKey, document });
    }, (error: unknown) => {
      if (controller.signal.aborted || isViewerRenderCancelled(error)) return;
      setLoadError(error instanceof Error ? error.message : errorText.current);
      trackError('pdf_load', error);
    });
    return () => { controller.abort(); owned?.dispose(); };
  }, [documentId, documentKey, loadBlob, setNumPages]);

  const document = session?.key === documentKey ? session.document : null;
  useEffect(() => {
    setPage(null);
    if (!document) return;
    let disposed = false;
    let owned: ViewerPageSource | null = null;
    setLoadError(null);
    void document.getPage(pageNumber).then((source) => {
      if (disposed) { source.release(); return; }
      owned = source;
      setPage({ key: pageKey, source });
    }, (error: unknown) => {
      if (disposed || isViewerRenderCancelled(error)) return;
      setLoadError(error instanceof Error ? error.message : errorText.current);
      trackError('pdf_load', error);
    });
    return () => { disposed = true; owned?.release(); };
  }, [document, pageNumber, pageKey]);

  return {
    planSource: document && page?.key === pageKey ? page.source : null,
    sourceKey: documentId ? `${documentId}:${pageNumber}` : '',
    loadError,
    setLoadError,
  };
}
