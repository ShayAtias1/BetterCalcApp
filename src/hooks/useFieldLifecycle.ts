import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { useCompareStore } from '../store/compareStore';
import { useFieldWorkflowStore } from '../store/fieldWorkflowStore';
import { useMeshLayoutPreviewStore } from '../store/meshLayoutPreviewStore';
import { cancelFieldOperation } from '../lib/fieldLifecycle';

/** Keep completed edits on the existing local save path; transient geometry never enters a save. */
export function useFieldLifecycle() {
  useEffect(() => {
    let flushing = false;
    const flush = async () => {
      if (flushing) return;
      flushing = true;
      try {
        // Allow an in-flight write to finish before flushing a newer completed edit.
        if (useAppStore.getState().saving) await new Promise<void>((resolve) => {
          const unsubscribe = useAppStore.subscribe((state) => { if (!state.saving) { unsubscribe(); resolve(); } });
        });
        if (useAppStore.getState().dirty) await useAppStore.getState().persist();
        if (useCompareStore.getState().saving) await new Promise<void>((resolve) => {
          const unsubscribe = useCompareStore.subscribe((state) => { if (!state.saving) { unsubscribe(); resolve(); } });
        });
        if (useCompareStore.getState().dirty) await useCompareStore.getState().persist();
      } finally { flushing = false; }
    };
    const interrupt = () => {
      const field = useFieldWorkflowStore.getState();
      if (field.pointerType !== 'mouse' || field.draft || field.geometryAction !== 'browse') {
        cancelFieldOperation();
        useAppStore.getState().setToolMode('select');
        field.setDraft(false); field.setCalibrationDialog(false); field.setGeometryAction('browse');
        useMeshLayoutPreviewStore.setState((state) => ({ views: Object.fromEntries(Object.entries(state.views).map(([key, view]) =>
          [key, { ...view, editing: false, overrides: {} }])) }));
      }
      void flush();
    };
    const visibility = () => { if (document.hidden) interrupt(); };
    window.addEventListener('blur', interrupt);
    window.addEventListener('pagehide', interrupt);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', interrupt);
      window.removeEventListener('pagehide', interrupt);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
}
