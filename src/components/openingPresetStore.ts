import { create } from 'zustand';
import type { OpeningPreset } from '../lib/manualOpenings';

/** The opening type chosen in the openings panel, shared with the dock's opening placement tool. */
export const useOpeningPreset = create<{ preset: OpeningPreset; setPreset: (preset: OpeningPreset) => void }>((set) => ({
  preset: 'hinged',
  setPreset: (preset) => set({ preset }),
}));
