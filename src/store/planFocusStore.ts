import { create } from 'zustand';
import type { Point } from '../types';

/** A one-shot viewport request; never saved with a plan. */
export interface PlanFocus {
  planId: string;
  pageNumber: number;
  domain: 'room' | 'concrete' | 'rebar';
  itemId: string;
  points: Point[];
  barId?: string;
  placementId?: string;
}
export const usePlanFocusStore = create<{
  request: PlanFocus | null;
  focus: (request: PlanFocus) => void;
  clear: () => void;
}>((set) => ({ request: null, focus: (request) => set({ request }), clear: () => set({ request: null }) }));
