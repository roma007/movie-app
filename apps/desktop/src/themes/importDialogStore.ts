import { create } from 'zustand';

interface ImportDialogState {
  aiImportOpen: boolean;
  openAiImport: () => void;
  closeAiImport: () => void;
}

export const useImportDialogStore = create<ImportDialogState>((set) => ({
  aiImportOpen: false,

  openAiImport: () => {
    set({ aiImportOpen: true });
  },

  closeAiImport: () => {
    set({ aiImportOpen: false });
  },
}));
