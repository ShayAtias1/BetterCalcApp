import { create } from 'zustand';

/** Presentation and draft control only. Existing appStore mutations own every saved edit. */
export const useFieldWorkflowStore = create<{
  pointerType: string;
  geometryAction: 'browse' | 'move' | 'reshape';
  draft: boolean;
  calibrationDialog: boolean;
  setPointer: (type: string) => void;
  setGeometryAction: (action: 'browse' | 'move' | 'reshape') => void;
  setDraft: (draft: boolean) => void;
  setCalibrationDialog: (open: boolean) => void;
}>((set) => ({
  pointerType: typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse',
  geometryAction: 'browse', draft: false, calibrationDialog: false,
  setPointer: (pointerType) => set({ pointerType }),
  setGeometryAction: (geometryAction) => set({ geometryAction }),
  setDraft: (draft) => set({ draft }),
  setCalibrationDialog: (calibrationDialog) => set({ calibrationDialog }),
}));
