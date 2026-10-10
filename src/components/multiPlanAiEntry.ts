import { create } from 'zustand';

/** Presentation only: the project-scoped dialog remains mounted once in App. */
export const useMultiPlanAiDialog = create<{open:boolean;setOpen:(open:boolean)=>void}>(set=>({
  open:false,
  setOpen:open=>set({open}),
}));
