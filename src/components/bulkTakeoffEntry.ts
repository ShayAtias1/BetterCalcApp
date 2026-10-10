import { create } from 'zustand';

/** Plan/page identity in the entry keeps future multi-Plan selection explicit. */
export const useBulkTakeoffDialog = create<{
  planId: string | null; pageNumber: number | null;
  openFor: (planId: string, pageNumber?: number) => void;
  close: () => void;
}>(set => ({
  planId: null, pageNumber: null,
  openFor: (planId, pageNumber) => set({ planId, pageNumber: pageNumber ?? null }),
  close: () => set({ planId: null, pageNumber: null }),
}));
