import { useEffect, useState } from 'react';
import { loadPdfBlob } from '../db/database';
import { pdfjsLib } from '../lib/pdfjsSetup';
import { parseLocalAiResult } from '../lib/localAiImport';
import { subscribePdfBlobChanges } from '../lib/pdfBlobEvents';
import { useAppStore } from '../store/appStore';

async function hash(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2,'0')).join('');
}

/** Local files only. No research assets or network endpoints are bundled into the app. */
export default function LocalAiImportPanel() {
  const planId=useAppStore(s => s.project?.id);
  const pageNumber=useAppStore(s => s.currentPage);
  const [result,setResult]=useState<File|null>(null);
  const [manifest,setManifest]=useState<File|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  useEffect(() => { setMessage(''); }, [planId,pageNumber]);
  useEffect(() => subscribePdfBlobChanges(id => {
    if (id === `plan:${planId}` && useAppStore.getState().detectionCandidates.some(c => c.localAi)) {
      useAppStore.getState().clearDetectionCandidates();
      setMessage('The PDF changed. Import the matching results again.');
    }
  }), [planId]);
  if (!import.meta.env.DEV || !planId) return null;

  async function importResult() {
    if (!result || !manifest || !planId) return;
    const sourcePlanId=planId, sourcePage=pageNumber;
    setBusy(true); setMessage('Checking local PDF and preparation metadata…');
    let task: ReturnType<typeof pdfjsLib.getDocument> | undefined;
    try {
      if (result.size > 10_000_000 || manifest.size > 10_000_000) throw new Error('JSON files must be smaller than 10 MB each.');
      const blob=await loadPdfBlob(sourcePlanId);
      if (!blob) throw new Error('The local PDF could not be found.');
      const bytes=await blob.arrayBuffer();
      const sourceHash=await hash(bytes);
      task=pdfjsLib.getDocument({data:bytes});
      const doc=await task.promise;
      const page=await doc.getPage(sourcePage), viewport=page.getViewport({scale:1});
      const resultBytes=await result.arrayBuffer();
      const importId=await hash(resultBytes);
      const spaces=parseLocalAiResult(JSON.parse(new TextDecoder().decode(resultBytes)),JSON.parse(await manifest.text()),{
        planId:sourcePlanId,sourceHash,importId,pageNumber:sourcePage,width:viewport.width,height:viewport.height,
        rotation:page.rotate,userUnit:page.userUnit,view:page.view,
      });
      const state=useAppStore.getState();
      if (state.project?.id !== sourcePlanId || state.currentPage !== sourcePage) throw new Error('The active plan/page changed during import. Return to the source page and import again.');
      // Recheck bytes as well: equal-sized replacements must not inherit a verified binding.
      const currentBlob=await loadPdfBlob(sourcePlanId);
      if (!currentBlob || await hash(await currentBlob.arrayBuffer()) !== sourceHash) throw new Error('The PDF changed during import.');
      const live=useAppStore.getState();
      if (live.project?.id !== sourcePlanId || live.currentPage !== sourcePage) throw new Error('The active plan/page changed during import.');
      const candidates=spaces.filter(s => !live.project?.rooms.some(r => r.id === s.id));
      useAppStore.setState({selectedDetectionCandidateId:null,detectionCandidates:candidates,detectionCandidatesPage:candidates.length ? sourcePage : null,detectionSummary:null});
      const invalid=candidates.filter(c => c.validationProblems.length).length;
      setMessage(`${candidates.length} AI suggestions on page ${sourcePage}; ${invalid} blocked by geometry validation. ${spaces.length-candidates.length} already approved. Remaining suggestions are replaced; existing Rooms are unchanged.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Import failed.');
    } finally {
      await task?.destroy().catch(() => undefined);
      setBusy(false);
    }
  }

  return <div className="auto-detect-panel">
    <span className="section-label">AI Space Detection · local development import</span>
    <p className="auto-detect-hint">Select parsed-spaces.json and its benchmark.json. PDF hash and page {pageNumber} must match. Files stay on this device. Suggestions are not approved Rooms.</p>
    <label className="auto-detect-hint">AI result <input type="file" accept=".json,application/json" disabled={busy} onChange={e => setResult(e.target.files?.[0] ?? null)} /></label>
    <label className="auto-detect-hint">Preparation metadata <input type="file" accept=".json,application/json" disabled={busy} onChange={e => setManifest(e.target.files?.[0] ?? null)} /></label>
    <button className="btn-secondary full-width" disabled={busy || !result || !manifest} onClick={() => void importResult()}>{busy ? 'Checking…' : 'Import AI suggestions'}</button>
    {message && <p className="auto-detect-hint" role="status">{message}</p>}
  </div>;
}
