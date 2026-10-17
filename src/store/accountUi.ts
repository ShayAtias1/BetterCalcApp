import { create } from 'zustand';
import type { LegalKind } from '../lib/legal/legalDocs';

export type AccountSection = 'profile' | 'subscription' | 'plans' | 'billing';

/** Which account surface is open. Pure view state; nothing here is stored or sent. */
export const useAccountUi = create<{
  pageOpen: boolean;
  section: AccountSection;
  legal: LegalKind | null;
  cloudOpen: boolean;
  /** The AI explanation dialog: 'guest' asks for an account, 'soon' says the tools are coming (signed-in users). */
  aiDialog: 'guest' | 'soon' | null;
  /** The locked action that opened the dialog (a dictionary key), named in the explanation. */
  aiAction: 'aiRowSpaces' | 'aiRowClick' | 'aiRowOpenings' | 'aiRowMulti' | null;
  setAiDialog(kind: 'guest' | 'soon' | null, action?: 'aiRowSpaces' | 'aiRowClick' | 'aiRowOpenings' | 'aiRowMulti'): void;
  openPage(section?: AccountSection): void;
  closePage(): void;
  openLegal(kind: LegalKind): void;
  closeLegal(): void;
  setCloudOpen(open: boolean): void;
}>((set) => ({
  pageOpen: false,
  section: 'profile',
  legal: null,
  cloudOpen: false,
  aiDialog: null,
  aiAction: null,
  setAiDialog: (aiDialog, action) => set({ aiDialog, aiAction: action ?? null }),
  openPage: (section = 'profile') => set({ pageOpen: true, section }),
  closePage: () => set({ pageOpen: false }),
  openLegal: (legal) => set({ legal }),
  closeLegal: () => set({ legal: null }),
  setCloudOpen: (cloudOpen) => set({ cloudOpen }),
}));
