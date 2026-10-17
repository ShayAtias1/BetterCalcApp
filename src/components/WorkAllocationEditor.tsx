import { v4 as uuid } from 'uuid';
import { useLanguage, useT, formatNumber } from '../i18n';
import { promptDialog } from '../lib/appDialogs';
import { allocateWorkItem } from '../lib/workAllocation';
import { categoryDefaultMethod, categoryLabel, compatibleSpecs, itemCategoryId, itemMethod, itemUnitLabel } from '../lib/workCatalog';
import { useWorkCatalog } from '../store/workCatalogStore';
import type { Plan, Room, WorkAllocation, WorkCatalogSnapshot, WorkItem, WorkSpec } from '../types';
import Icon from './Icon';
import './WorkCatalog.css';
import Select from './Select';

/**
 * Splits one room work item's quantity between work items / specifications of its category. The
 * calculated (or typed) quantity stays the baseline: shares are typed, one share may be the automatic
 * remainder, and the summary always says what is calculated, allocated and still free.
 */
export default function WorkAllocationEditor({ plan, room, item, onChange }: {
  plan: Plan;
  room: Room;
  item: WorkItem;
  onChange: (allocations: WorkAllocation[], catalog?: Partial<WorkCatalogSnapshot>) => void;
}) {
  const t = useT();
  const language = useLanguage();
  const catalogCategories = useWorkCatalog((s) => s.categories);
  const catalogSpecs = useWorkCatalog((s) => s.specs);
  const addSpec = useWorkCatalog((s) => s.addSpec);
  const result = allocateWorkItem(item, room, plan);
  const categoryId = itemCategoryId(item);
  if (!result || !categoryId) return null;

  const catalog = { categories: catalogCategories, specs: catalogSpecs };
  // Only work items measured the same way can share this quantity (wall paint never splits into ceiling paint).
  const options = compatibleSpecs(plan, catalog, item);
  const method = itemMethod(item);
  const ownMethod = method && method !== 'floorAndUpturn' && method !== categoryDefaultMethod(categoryId, plan, catalog) ? method : undefined;
  const allocations = item.allocations ?? [];
  const unit = itemUnitLabel(item, plan, t);
  const fmt = (n: number) => formatNumber(n, language);
  const specById = (id: string) => options.find((s) => s.id === id);
  // A share pointing at a spec only the plan's snapshot used to hold still shows by id.
  const nameOf = (id: string) => specById(id)?.name || t('workCatalog.unknownItem');

  const createSpec = async (): Promise<WorkSpec | null> => {
    const name = await promptDialog(t('workCatalog.newItemPrompt', { category: categoryLabel(categoryId, plan, t) }), '');
    if (!name?.trim()) return null;
    // A new item created from a split of an own-method item measures the same way.
    return addSpec({ categoryId, name: name.trim(), ...(ownMethod ? { method: ownMethod } : {}) });
  };
  // A spec chosen from the catalog is copied into the plan in the same step as the share that uses it.
  const commit = (next: WorkAllocation[], spec?: WorkSpec) => onChange(next, spec ? { specs: [spec] } : undefined);

  const categoryName = categoryLabel(categoryId, plan, t);
  const unused = options.filter((s) => !allocations.some((a) => a.specId === s.id));

  // Adding a type is a choice from this category's types (or a new one), right where the split is.
  const addLine = async (value: string) => {
    const spec = value === '__new__' ? await createSpec() : options.find((s) => s.id === value) ?? null;
    if (!spec) return;
    // The first type takes the whole quantity automatically; later ones start at 0 and the
    // remainder adjusts as they are typed.
    const hasRemainder = allocations.some((a) => a.quantity === null);
    commit([...allocations, { id: uuid(), specId: spec.id, quantity: hasRemainder || allocations.length > 0 ? 0 : null }], spec);
  };

  const setSpec = async (index: number, value: string) => {
    const spec = value === '__new__' ? await createSpec() : specById(value) ?? null;
    if (!spec) return;
    commit(allocations.map((a, i) => (i === index ? { ...a, specId: spec.id } : a)), spec);
  };

  const setQuantity = (index: number, raw: string) => {
    const parsed = parseFloat(raw);
    const otherRemainder = allocations.some((a, i) => i !== index && a.quantity === null);
    // Clearing a field makes it the remainder, unless another share already is.
    const quantity = Number.isFinite(parsed) ? Math.max(0, parsed) : otherRemainder ? 0 : null;
    commit(allocations.map((a, i) => (i === index ? { ...a, quantity } : a)));
  };

  const makeRemainder = (index: number) => {
    commit(allocations.map((a, i) => {
      if (i === index) return { ...a, quantity: null };
      // The previous remainder keeps the amount it showed, now as a typed value.
      if (a.quantity === null) return { ...a, quantity: Math.round((result.lines[i]?.quantity ?? 0) * 100) / 100 };
      return a;
    }));
  };

  const remove = (index: number) => commit(allocations.filter((_, i) => i !== index));

  const baselineText = result.baseline === null ? '—' : `${fmt(result.baseline)} ${unit}`;
  const allocated = result.baseline === null ? null : result.baseline - (result.unassigned ?? 0);
  const balanced = result.baseline !== null && result.over === 0 && (result.unassigned ?? 0) === 0;
  const addPicker = (
    <Select className="wi-allocation-add" value="" aria-label={t('workCatalog.addAllocation', { category: categoryName })} title={t('workCatalog.splitHint')}
      onChange={(e) => { if (e.target.value) void addLine(e.target.value); }}>
      <option value="">{t('workCatalog.addAllocation', { category: categoryName })}</option>
      {unused.map((s) => <option key={s.id} value={s.id}>{s.name || t('workCatalog.unknownItem')}{s.specification ? ` · ${s.specification}` : ''}</option>)}
      <option value="__new__">{t('workCatalog.newItemOption')}</option>
    </Select>
  );

  // No split yet: one obvious action. With a split: calculated quantity → types → total, in one block.
  if (allocations.length === 0) return <div className="wi-allocations">{addPicker}</div>;
  return (
    <div className="wi-allocations wi-split">
      <div className="wi-split-head">
        <span>{result.def.basis === 'manual'
          ? t('workCatalog.splitEntered', { amount: '' })
          : t('workCatalog.splitBaseline', { method: method ? t(`workCatalog.methods.${method}`) : '', amount: '' })}</span>
        <bdi>{baselineText}</bdi>
      </div>
      <ul className="wi-allocation-list">
        {allocations.map((a, i) => {
          const line = result.lines[i];
          const remainder = line && !line.manual;
          return (
            <li key={a.id} className={remainder ? 'is-remainder' : ''}>
              <Select className="wi-allocation-spec" value={a.specId} aria-label={t('workCatalog.itemName')} title={specById(a.specId)?.specification || undefined}
                onChange={(e) => void setSpec(i, e.target.value)}>
                {!specById(a.specId) && <option value={a.specId}>{nameOf(a.specId)}</option>}
                {options.map((s) => <option key={s.id} value={s.id}>{s.name || t('workCatalog.unknownItem')}{s.specification ? ` · ${s.specification}` : ''}</option>)}
                <option value="__new__">{t('workCatalog.newItemOption')}</option>
              </Select>
              <input
                className="wi-allocation-qty"
                type="number"
                min="0"
                step="0.01"
                aria-label={t('workCatalog.quantityLabel', { name: nameOf(a.specId) })}
                value={remainder ? '' : a.quantity ?? ''}
                placeholder={remainder ? (line.quantity === null ? '—' : fmt(line.quantity)) : '0'}
                onChange={(e) => setQuantity(i, e.target.value)}
              />
              <span className="wi-allocation-unit">{unit}</span>
              {remainder
                ? <span className="wi-source auto" title={t('workCatalog.remainder')}>{t('workCatalog.remainder')}</span>
                : <button type="button" className="wi-source manual" title={t('workCatalog.makeRemainder')} onClick={() => makeRemainder(i)}>{t('workCatalog.manual')}</button>}
              <button type="button" className="icon-btn wi-allocation-remove" title={t('workCatalog.removeAllocation')} aria-label={t('workCatalog.removeAllocation')} onClick={() => remove(i)}>
                <Icon name="close" size={12} />
              </button>
            </li>
          );
        })}
      </ul>
      <div className={`wi-split-total ${balanced ? 'balanced' : ''}`}>
        <span>{t('workCatalog.splitTotal', { amount: '' })}</span>
        <bdi>{allocated === null ? '—' : `${fmt(allocated + result.over)} ${unit}`}</bdi>
        {balanced && <span className="wi-split-ok">✓ {t('workCatalog.splitBalanced')}</span>}
      </div>
      {result.over > 0 && <p className="wi-allocation-warning" role="alert">{t('workCatalog.overAllocated', { amount: fmt(result.over), unit })}</p>}
      {result.over === 0 && (result.unassigned ?? 0) > 0 && <p className="wi-allocation-note" role="status">{t('workCatalog.unassignedNote', { amount: fmt(result.unassigned!), unit })}</p>}
      {addPicker}
    </div>
  );
}
