import { useEffect } from 'react';
import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type { CalculationMethod, WorkCatalogSnapshot, WorkCategory, WorkSpec } from '../types';
import { sanitizeCatalog, seedCatalog, withSeedEntries } from '../lib/workCatalog';

/**
 * The reusable local catalog of work categories and work items / specifications, kept in this
 * browser. Plans copy the entries they use (Plan.workCatalog), so edits here never change a plan's
 * quantities until the user explicitly updates that plan.
 */
const STORAGE_KEY = 'bettercalc.workCatalog.v1';
/** Set once the starting types were offered, so ones the user deletes never come back. */
const SEEDED_KEY = 'bettercalc.workCatalog.seeded.v1';

function load(): WorkCatalogSnapshot {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? sanitizeCatalog(JSON.parse(raw)) : { categories: [], specs: [] };
  } catch {
    return { categories: [], specs: [] };
  }
}

function save(catalog: WorkCatalogSnapshot) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(catalog));
  } catch {
    // Storage full or blocked: the catalog still works for this session.
  }
}

interface WorkCatalogState extends WorkCatalogSnapshot {
  addCategory: (input: { name: string; method: CalculationMethod; unitLabel?: string }) => WorkCategory;
  updateCategory: (id: string, patch: Partial<Pick<WorkCategory, 'name' | 'method' | 'unitLabel'>>) => void;
  /** Copies the category and all its work items under new ids. */
  duplicateCategory: (id: string, name: string) => WorkCategory | null;
  /** Removes the category and its work items from the catalog; plans keep their own copies. */
  deleteCategory: (id: string) => void;
  addSpec: (input: { categoryId: string; name: string; specification?: string; method?: CalculationMethod; unitLabel?: string }) => WorkSpec;
  /** `method: undefined` returns the work item to its category's method. */
  updateSpec: (id: string, patch: Partial<Pick<WorkSpec, 'name' | 'specification' | 'method' | 'unitLabel'>>) => void;
  duplicateSpec: (id: string, name: string) => WorkSpec | null;
  deleteSpec: (id: string) => void;
}

export const useWorkCatalog = create<WorkCatalogState>((set, get) => {
  const commit = (next: WorkCatalogSnapshot) => {
    set(next);
    save(next);
  };
  const snapshot = () => ({ categories: get().categories, specs: get().specs });
  return {
    ...load(),
    addCategory: ({ name, method, unitLabel }) => {
      const now = Date.now();
      const category: WorkCategory = { id: uuid(), name, method, ...(unitLabel ? { unitLabel } : {}), createdAt: now, updatedAt: now };
      commit({ ...snapshot(), categories: [...get().categories, category] });
      return category;
    },
    updateCategory: (id, patch) => {
      commit({ ...snapshot(), categories: get().categories.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c)) });
    },
    duplicateCategory: (id, name) => {
      const source = get().categories.find((c) => c.id === id);
      if (!source) return null;
      const now = Date.now();
      const copy: WorkCategory = { ...source, id: uuid(), name, createdAt: now, updatedAt: now };
      const specs = get().specs.filter((s) => s.categoryId === id).map((s) => ({ ...s, id: uuid(), categoryId: copy.id, createdAt: now, updatedAt: now }));
      commit({ categories: [...get().categories, copy], specs: [...get().specs, ...specs] });
      return copy;
    },
    deleteCategory: (id) => {
      commit({ categories: get().categories.filter((c) => c.id !== id), specs: get().specs.filter((s) => s.categoryId !== id) });
    },
    addSpec: ({ categoryId, name, specification, method, unitLabel }) => {
      const now = Date.now();
      const spec: WorkSpec = {
        id: uuid(), categoryId, name, ...(specification ? { specification } : {}), ...(method ? { method } : {}), ...(unitLabel ? { unitLabel } : {}),
        createdAt: now, updatedAt: now,
      };
      commit({ ...snapshot(), specs: [...get().specs, spec] });
      return spec;
    },
    updateSpec: (id, patch) => {
      commit({
        ...snapshot(),
        specs: get().specs.map((s) => {
          if (s.id !== id) return s;
          const next: WorkSpec = { ...s, ...patch, updatedAt: Date.now() };
          // An absent method means "the category's": never store an explicit undefined.
          if (!next.method) delete next.method;
          if (!next.unitLabel) delete next.unitLabel;
          return next;
        }),
      });
    },
    duplicateSpec: (id, name) => {
      const source = get().specs.find((s) => s.id === id);
      if (!source) return null;
      const now = Date.now();
      const copy: WorkSpec = { ...source, id: uuid(), name, createdAt: now, updatedAt: now };
      commit({ ...snapshot(), specs: [...get().specs, copy] });
      return copy;
    },
    deleteSpec: (id) => {
      commit({ ...snapshot(), specs: get().specs.filter((s) => s.id !== id) });
    },
  };
});

/**
 * Adds the starting types once per browser, in the UI language of that first use. Called from the
 * components that show the catalog (after the app has applied its language), never at module load.
 */
export function ensureCatalogSeeded(): void {
  try {
    if (globalThis.localStorage?.getItem(SEEDED_KEY) === '1') return;
  } catch {
    // Blocked storage: seed in memory for this session.
  }
  const state = useWorkCatalog.getState();
  const next = withSeedEntries({ categories: state.categories, specs: state.specs }, seedCatalog());
  if (next.categories.length !== state.categories.length || next.specs.length !== state.specs.length) {
    useWorkCatalog.setState(next);
    save(next);
  }
  try {
    globalThis.localStorage?.setItem(SEEDED_KEY, '1');
  } catch {
    // Offered again next session; existing entries are never replaced.
  }
}

/** Seeds the starting catalog when a catalog-showing component mounts. */
export function useCatalogSeed(): void {
  useEffect(() => ensureCatalogSeeded(), []);
}
