/**
 * The work catalog: categories (built-in work types + user-defined ones) and the work items /
 * specifications within them. The global catalog lives in the browser (store/workCatalogStore);
 * every plan keeps a snapshot of the entries it uses (`Plan.workCatalog`), and its quantities and
 * reports read only that snapshot — editing the catalog later never silently changes a plan.
 */

import type { CalculationMethod, CustomColumnQuantity, CustomReportKey, Plan, WorkCatalogSnapshot, WorkCategory, WorkItem, WorkSpec, WorkType } from '../types';
import { t as globalT, type TranslateFn } from '../i18n';
import { builtInMethodKey, isCalculationMethod, workItemDefinition, WORK_TYPE_ORDER, type QuantityUnit } from './workTypes';

const BUILTIN_PREFIX = 'builtin:';

/** Built-in work types are categories too; their specs reference them by this id. */
export function builtinCategoryId(type: WorkType): string {
  return `${BUILTIN_PREFIX}${type}`;
}

export function builtinTypeOf(categoryId: string): WorkType | null {
  if (!categoryId.startsWith(BUILTIN_PREFIX)) return null;
  const type = categoryId.slice(BUILTIN_PREFIX.length) as WorkType;
  return WORK_TYPE_ORDER.includes(type) ? type : null;
}

/** The catalog category a room work item belongs to: its built-in type's, or its own custom category. */
export function itemCategoryId(item: Pick<WorkItem, 'type' | 'categoryId'>): string | null {
  if (item.type === 'custom') return item.categoryId ?? null;
  return WORK_TYPE_ORDER.includes(item.type) ? builtinCategoryId(item.type) : null;
}

export function planCategory(plan: Plan, id: string | null | undefined): WorkCategory | undefined {
  return id ? plan.workCatalog?.categories.find((c) => c.id === id) : undefined;
}

export function planSpec(plan: Plan, id: string | null | undefined): WorkSpec | undefined {
  return id ? plan.workCatalog?.specs.find((s) => s.id === id) : undefined;
}

/** A category's display name: the dictionary's for a built-in one, the plan snapshot's for a custom one. */
export function categoryLabel(categoryId: string, plan: Plan, tr: TranslateFn = globalT): string {
  const builtin = builtinTypeOf(categoryId);
  if (builtin) return tr(`workTypes.${builtin}`);
  return planCategory(plan, categoryId)?.name || tr('workCatalog.unnamedCategory');
}

/** A room work item's display name: a work item with its own method by its own name. */
export function workItemLabel(item: WorkItem, plan: Plan, tr: TranslateFn = globalT): string {
  if (item.type !== 'custom') return WORK_TYPE_ORDER.includes(item.type) ? tr(`workTypes.${item.type}`) : String(item.type);
  const spec = planSpec(plan, item.specId);
  if (spec) return spec.name || tr('workCatalog.unknownItem');
  return item.categoryId ? categoryLabel(item.categoryId, plan, tr) : tr('workCatalog.unnamedCategory');
}

/** The method a category measures with: the built-in type's, or the custom category's (the plan's copy first). */
export function categoryDefaultMethod(categoryId: string, plan: Plan, catalog?: WorkCatalogSnapshot): CalculationMethod | 'floorAndUpturn' | null {
  const builtin = builtinTypeOf(categoryId);
  if (builtin) return builtInMethodKey(builtin);
  return (planCategory(plan, categoryId) ?? catalog?.categories.find((c) => c.id === categoryId))?.method ?? null;
}

/** A work item's effective method: its own, else its category's. */
export function specMethod(spec: WorkSpec, plan: Plan, catalog?: WorkCatalogSnapshot): CalculationMethod | 'floorAndUpturn' | null {
  return spec.method ?? categoryDefaultMethod(spec.categoryId, plan, catalog);
}

/** Whether a work item / spec has a method of its own, different from its category's. */
export function hasOwnMethod(spec: WorkSpec, plan: Plan, catalog?: WorkCatalogSnapshot): boolean {
  return !!spec.method && spec.method !== categoryDefaultMethod(spec.categoryId, plan, catalog);
}

/**
 * The report column of a custom room item: one per category and method, so "Paint · ceiling area"
 * never mixes with wall paint, and a category's metres never mix with its m².
 */
export function customReportKey(item: Pick<WorkItem, 'type' | 'categoryId' | 'method'>): CustomReportKey | null {
  if (item.type !== 'custom' || !item.categoryId || !isCalculationMethod(item.method)) return null;
  return `custom:${item.categoryId}|${item.method}`;
}

/** A custom column's name in the given language. */
export function customColumnLabel(info: Pick<CustomColumnQuantity, 'categoryName' | 'builtinType' | 'method' | 'showMethod'>, tr: TranslateFn = globalT): string {
  const base = info.builtinType ? tr(`workTypes.${info.builtinType}`) : info.categoryName || tr('workCatalog.unnamedCategory');
  return info.showMethod ? `${base} · ${tr(`workCatalog.methods.${info.method}`)}` : base;
}

/** A custom column's unit text in the given language. */
export function customUnitLabel(info: Pick<CustomColumnQuantity, 'unit' | 'unitName'>, tr: TranslateFn = globalT): string {
  return info.unit === 'unit' ? info.unitName?.trim() || tr('units.unit') : tr(`units.${info.unit}`);
}

/** The method an item is measured with, for labels ('floorAndUpturn' is waterproofing's). null = not calculable. */
export function itemMethod(item: WorkItem): CalculationMethod | 'floorAndUpturn' | null {
  if (item.type === 'custom') return isCalculationMethod(item.method) ? item.method : null;
  return WORK_TYPE_ORDER.includes(item.type) ? builtInMethodKey(item.type) : null;
}

/** The unit text of an item's primary quantity (a counted category may name its own unit). */
export function itemUnitLabel(item: WorkItem, plan: Plan, tr: TranslateFn = globalT): string {
  const unit: QuantityUnit = workItemDefinition(item)?.unit ?? 'm2';
  if (unit === 'unit') return itemUnitName(item, plan) || tr('units.unit');
  return tr(`units.${unit}`);
}

/** The catalog's unit name for a counted item: its work item's own, else its category's. */
export function itemUnitName(item: WorkItem, plan: Plan): string | null {
  return planSpec(plan, item.specId)?.unitLabel?.trim() || planCategory(plan, item.categoryId)?.unitLabel?.trim() || null;
}

const sameCategory = (a: WorkCategory, b: WorkCategory) => a.name === b.name && a.method === b.method && (a.unitLabel ?? '') === (b.unitLabel ?? '');
const sameSpec = (a: WorkSpec, b: WorkSpec) => a.name === b.name && (a.specification ?? '') === (b.specification ?? '') && a.categoryId === b.categoryId &&
  a.method === b.method && (a.unitLabel ?? '') === (b.unitLabel ?? '');

/**
 * Copies catalog entries into the plan's snapshot when it does not hold them yet. An entry the plan
 * already holds is kept as it is (the plan's version wins). Returns the same plan when nothing is new.
 */
export function withCatalogEntries(plan: Plan, entries: Partial<WorkCatalogSnapshot>): Plan {
  const current = plan.workCatalog ?? { categories: [], specs: [] };
  const categories = (entries.categories ?? []).filter((c) => !current.categories.some((x) => x.id === c.id));
  const specs = (entries.specs ?? []).filter((s) => !current.specs.some((x) => x.id === s.id));
  if (!categories.length && !specs.length) return plan;
  return {
    ...plan,
    workCatalog: {
      categories: [...current.categories, ...categories.map((c) => ({ ...c }))],
      specs: [...current.specs, ...specs.map((s) => ({ ...s }))],
    },
  };
}

/** Plan snapshot entries whose catalog version now differs — offered as an explicit update, never applied silently. */
export function catalogUpdates(plan: Plan, catalog: WorkCatalogSnapshot): WorkCatalogSnapshot {
  const snapshot = plan.workCatalog ?? { categories: [], specs: [] };
  return {
    categories: snapshot.categories.flatMap((c) => {
      const latest = catalog.categories.find((x) => x.id === c.id);
      return latest && !sameCategory(latest, c) ? [latest] : [];
    }),
    specs: snapshot.specs.flatMap((s) => {
      const latest = catalog.specs.find((x) => x.id === s.id);
      return latest && !sameSpec(latest, s) ? [latest] : [];
    }),
  };
}

/** Applies explicitly accepted catalog updates; items of a category whose method changed follow it. */
export function applyCatalogUpdates(plan: Plan, updates: WorkCatalogSnapshot): Plan {
  if (!plan.workCatalog || (!updates.categories.length && !updates.specs.length)) return plan;
  const categories = plan.workCatalog.categories.map((c) => updates.categories.find((u) => u.id === c.id) ?? c);
  const specs = plan.workCatalog.specs.map((s) => updates.specs.find((u) => u.id === s.id) ?? s);
  const next: Plan = { ...plan, workCatalog: { categories, specs } };
  // Items follow their own work item's method when it has one, else their category's.
  const methodOf = (w: WorkItem): CalculationMethod | undefined => {
    const spec = planSpec(next, w.specId);
    if (spec?.method) return spec.method;
    const category = planCategory(next, w.categoryId);
    return category?.method;
  };
  const touched = (w: WorkItem) => w.type === 'custom' && (updates.categories.some((c) => c.id === w.categoryId) || updates.specs.some((x) => x.id === w.specId));
  const rooms = plan.rooms.map((room) => {
    if (!room.workItems.some(touched)) return room;
    return {
      ...room,
      workItems: room.workItems.map((w) => {
        const method = touched(w) ? methodOf(w) : undefined;
        return method && method !== w.method ? { ...w, method } : w;
      }),
    };
  });
  return { ...next, rooms };
}

/** Custom categories to offer: the plan's own first (its versions), then the catalog's others. */
export function categoryOptions(plan: Plan, catalog: WorkCatalogSnapshot): WorkCategory[] {
  const own = plan.workCatalog?.categories ?? [];
  return [...own, ...catalog.categories.filter((c) => !own.some((x) => x.id === c.id))];
}

/** Work items / specs of one category to offer: the plan's versions first, then the catalog's others. */
export function specOptions(plan: Plan, catalog: WorkCatalogSnapshot, categoryId: string | null): WorkSpec[] {
  if (!categoryId) return [];
  const own = (plan.workCatalog?.specs ?? []).filter((s) => s.categoryId === categoryId);
  return [...own, ...catalog.specs.filter((s) => s.categoryId === categoryId && !own.some((x) => x.id === s.id))];
}

/** Work items a room item can be split into: same category and the same effective method as the item. */
export function compatibleSpecs(plan: Plan, catalog: WorkCatalogSnapshot, item: WorkItem): WorkSpec[] {
  const method = itemMethod(item);
  return specOptions(plan, catalog, itemCategoryId(item)).filter((s) => specMethod(s, plan, catalog) === method);
}

/** Work items with a method of their own, offered as their own room items (e.g. "Ceiling paint" under Paint). */
export function ownMethodSpecs(plan: Plan, catalog: WorkCatalogSnapshot): WorkSpec[] {
  const own = plan.workCatalog?.specs ?? [];
  return [...own, ...catalog.specs.filter((s) => !own.some((x) => x.id === s.id))].filter((s) => hasOwnMethod(s, plan, catalog));
}

/** Tolerant reader for stored catalogs (local storage, older or hand-edited data): drops malformed entries. */
export function sanitizeCatalog(raw: unknown): WorkCatalogSnapshot {
  const source = raw && typeof raw === 'object' ? (raw as Partial<Record<keyof WorkCatalogSnapshot, unknown>>) : {};
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  const time = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const categories = (Array.isArray(source.categories) ? source.categories : []).flatMap((c): WorkCategory[] => {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !isCalculationMethod(c.method)) return [];
    return [{ id: c.id, name: text(c.name), method: c.method, ...(typeof c.unitLabel === 'string' ? { unitLabel: c.unitLabel } : {}), createdAt: time(c.createdAt), updatedAt: time(c.updatedAt) }];
  });
  const specs = (Array.isArray(source.specs) ? source.specs : []).flatMap((s): WorkSpec[] => {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || typeof s.categoryId !== 'string') return [];
    return [{
      id: s.id, categoryId: s.categoryId, name: text(s.name), ...(typeof s.specification === 'string' ? { specification: s.specification } : {}),
      ...(isCalculationMethod(s.method) ? { method: s.method } : {}), ...(typeof s.unitLabel === 'string' ? { unitLabel: s.unitLabel } : {}),
      createdAt: time(s.createdAt), updatedAt: time(s.updatedAt),
    }];
  });
  return { categories, specs };
}

/**
 * The starting catalog: common types under the built-in categories (wall and ceiling paint, floor
 * tile sizes) and two ready categories (drywall, grout). Fixed ids so every plan that uses them
 * refers to the same entries; all of it is ordinary, editable and deletable catalog data.
 */
export function seedCatalog(tr: TranslateFn = globalT): WorkCatalogSnapshot {
  const at = 0;
  const category = (id: string, name: string, method: CalculationMethod, unitLabel?: string): WorkCategory =>
    ({ id, name, method, ...(unitLabel ? { unitLabel } : {}), createdAt: at, updatedAt: at });
  const spec = (id: string, categoryId: string, name: string, extra: Partial<WorkSpec> = {}): WorkSpec =>
    ({ id, categoryId, name, ...extra, createdAt: at, updatedAt: at });
  const painting = builtinCategoryId('painting'), tiling = builtinCategoryId('tiling');
  return {
    categories: [
      category('seed:drywall', tr('workCatalog.seed.drywall'), 'wallArea'),
      category('seed:grout', tr('workCatalog.seed.grout'), 'manualCount', tr('workCatalog.seed.kg')),
    ],
    specs: [
      spec('seed:paint-white', painting, tr('workCatalog.seed.whitePaint')),
      spec('seed:paint-grey', painting, tr('workCatalog.seed.greyPaint')),
      spec('seed:paint-ceiling', painting, tr('workCatalog.seed.ceilingPaint'), { method: 'ceilingArea' }),
      spec('seed:tile-60', tiling, tr('workCatalog.seed.porcelain60')),
      spec('seed:tile-80', tiling, tr('workCatalog.seed.porcelain80')),
      spec('seed:tile-120', tiling, tr('workCatalog.seed.porcelain120')),
      spec('seed:drywall-walls', 'seed:drywall', tr('workCatalog.seed.drywallWalls')),
      spec('seed:drywall-ceilings', 'seed:drywall', tr('workCatalog.seed.drywallCeilings'), { method: 'ceilingArea' }),
      spec('seed:drywall-tracks', 'seed:drywall', tr('workCatalog.seed.drywallTracks'), { method: 'manualLength' }),
      spec('seed:drywall-studs', 'seed:drywall', tr('workCatalog.seed.drywallStuds'), { method: 'manualCount', unitLabel: tr('workCatalog.seed.pieces') }),
      spec('seed:grout-cement', 'seed:grout', tr('workCatalog.seed.groutCement')),
      spec('seed:grout-epoxy', 'seed:grout', tr('workCatalog.seed.groutEpoxy')),
    ],
  };
}

/** Adds the starting entries the catalog does not hold yet (an entry the user kept or edited stays as it is). */
export function withSeedEntries(catalog: WorkCatalogSnapshot, seed: WorkCatalogSnapshot): WorkCatalogSnapshot {
  return {
    categories: [...catalog.categories, ...seed.categories.filter((c) => !catalog.categories.some((x) => x.id === c.id))],
    specs: [...catalog.specs, ...seed.specs.filter((s) => !catalog.specs.some((x) => x.id === s.id))],
  };
}
