import { useState } from 'react';
import { useT } from '../i18n';
import { confirmDialog } from '../lib/appDialogs';
import { builtinCategoryId, catalogUpdates } from '../lib/workCatalog';
import { builtInMethodKey, CALCULATION_METHODS, WORK_TYPE_ORDER } from '../lib/workTypes';
import { useAppStore } from '../store/appStore';
import { useCatalogSeed, useWorkCatalog } from '../store/workCatalogStore';
import type { CalculationMethod, Plan, WorkCategory } from '../types';
import AppModal from './AppModal';
import Icon from './Icon';
import './WorkCatalog.css';
import Select from './Select';

/**
 * Manages the local catalog as one expandable hierarchy: work category → its types / specifications.
 * User categories (name, calculation method, unit) and the types of every category, built-in ones
 * included, are all editable. Edits here change the catalog only; the
 * open plan keeps its own copies until the user explicitly updates it.
 */
export default function WorkCatalogDialog({ plan, onClose, initialCategoryId }: { plan: Plan | null; onClose: () => void; initialCategoryId?: string }) {
  const t = useT();
  const catalog = useWorkCatalog();
  useCatalogSeed();
  const applyPlanCatalogUpdates = useAppStore((s) => s.applyPlanCatalogUpdates);
  // Categories open to show their types; the one the user came from starts open.
  const [open, setOpen] = useState<Set<string>>(() => new Set([initialCategoryId ?? builtinCategoryId('painting')]));
  const toggle = (id: string, value?: boolean) => setOpen((old) => {
    const next = new Set(old);
    if (value ?? !next.has(id)) next.add(id); else next.delete(id);
    return next;
  });

  const updates = plan ? catalogUpdates(plan, { categories: catalog.categories, specs: catalog.specs }) : { categories: [], specs: [] };
  const updateCount = updates.categories.length + updates.specs.length;
  const methodName = (m: CalculationMethod | 'floorAndUpturn') => t(`workCatalog.methods.${m}`);

  const addCategory = () => {
    const created = catalog.addCategory({ name: t('workCatalog.newCategoryName'), method: 'floorArea' });
    toggle(created.id, true);
  };

  /** One category: its header row, and when open its settings, its types and "+ Add … type". */
  const node = (id: string, name: string, defaultMethod: CalculationMethod | 'floorAndUpturn', category: WorkCategory | null) => {
    const specs = catalog.specs.filter((s) => s.categoryId === id);
    const expanded = open.has(id);
    return (
      <li key={id} className={`work-catalog-node ${expanded ? 'open' : ''}`}>
        <button type="button" className="work-catalog-node-head" aria-expanded={expanded} onClick={() => toggle(id)}>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={13} />
          <strong dir="auto">{name}</strong>
          <small>{methodName(defaultMethod)}</small>
          <span className="work-catalog-count">{t('workCatalog.types', { count: specs.length })}</span>
          {!category && <span className="work-catalog-builtin">{t('workCatalog.builtIn')}</span>}
        </button>
        {expanded && <div className="work-catalog-node-body">
          {category ? (
            <div className="work-catalog-fields">
              <label>{t('workCatalog.categoryName')}
                <input dir="auto" value={category.name} onChange={(e) => catalog.updateCategory(category.id, { name: e.target.value })} />
              </label>
              <label>{t('workCatalog.method')}
                <Select value={category.method} onChange={(e) => catalog.updateCategory(category.id, { method: e.target.value as CalculationMethod })}>
                  {CALCULATION_METHODS.map((m) => <option key={m} value={m}>{methodName(m)}</option>)}
                </Select>
              </label>
              {category.method === 'manualCount' && <label>{t('workCatalog.unitLabel')}
                <input dir="auto" value={category.unitLabel ?? ''} placeholder={t('workCatalog.unitPlaceholder')} onChange={(e) => catalog.updateCategory(category.id, { unitLabel: e.target.value })} />
              </label>}
              <div className="work-catalog-category-actions">
                <button type="button" className="btn-secondary small" onClick={() => {
                  const copy = catalog.duplicateCategory(category.id, t('workCatalog.copyName', { name: category.name }));
                  if (copy) toggle(copy.id, true);
                }}>{t('workCatalog.duplicate')}</button>
                <button type="button" className="btn-secondary small danger" onClick={async () => {
                  if (await confirmDialog(t('workCatalog.deleteCategoryConfirm', { name: category.name }), { destructive: true })) catalog.deleteCategory(category.id);
                }}>{t('workCatalog.delete')}</button>
              </div>
            </div>
          ) : <p className="muted work-catalog-note">{t('workCatalog.builtInNote')}</p>}

          <span className="section-label">{t('workCatalog.items')}</span>
          {specs.length === 0 && <p className="muted work-catalog-empty">{t('workCatalog.noItems')}</p>}
          <ul className="work-catalog-specs">
            {specs.map((s) => (
              <li key={s.id}>
                <input dir="auto" aria-label={t('workCatalog.itemName')} placeholder={t('workCatalog.itemName')} value={s.name} onChange={(e) => catalog.updateSpec(s.id, { name: e.target.value })} />
                <input dir="auto" aria-label={t('workCatalog.specification')} placeholder={t('workCatalog.specificationPlaceholder')} value={s.specification ?? ''} onChange={(e) => catalog.updateSpec(s.id, { specification: e.target.value })} />
                {/* A type may measure differently from its category (e.g. ceiling paint under Paint). */}
                <span className="work-catalog-spec-method">
                  <Select aria-label={t('workCatalog.itemMethod')} value={s.method ?? ''} onChange={(e) => catalog.updateSpec(s.id, { method: (e.target.value || undefined) as CalculationMethod | undefined })}>
                    <option value="">{t('workCatalog.categoryMethod', { method: methodName(defaultMethod) })}</option>
                    {CALCULATION_METHODS.map((m) => <option key={m} value={m}>{methodName(m)}</option>)}
                  </Select>
                  {s.method === 'manualCount' && <input dir="auto" aria-label={t('workCatalog.unitLabel')} placeholder={t('workCatalog.unitPlaceholder')} value={s.unitLabel ?? ''} onChange={(e) => catalog.updateSpec(s.id, { unitLabel: e.target.value })} />}
                </span>
                <button type="button" className="icon-btn" title={t('workCatalog.duplicate')} aria-label={t('workCatalog.duplicate')} onClick={() => catalog.duplicateSpec(s.id, t('workCatalog.copyName', { name: s.name }))}>
                  <Icon name="copy" size={14} />
                </button>
                <button type="button" className="icon-btn" title={t('workCatalog.delete')} aria-label={t('workCatalog.delete')} onClick={async () => {
                  if (await confirmDialog(t('workCatalog.deleteItemConfirm', { name: s.name }), { destructive: true })) catalog.deleteSpec(s.id);
                }}>
                  <Icon name="trash" size={14} />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="work-catalog-add-type" onClick={() => catalog.addSpec({ categoryId: id, name: t('workCatalog.newItemName') })}>
            {t('workCatalog.newItem', { category: name })}
          </button>
        </div>}
      </li>
    );
  };

  return (
    <AppModal title={t('workCatalog.title')} onCancel={onClose} wide showClose className="work-catalog-dialog">
      <p className="work-catalog-intro">{t('workCatalog.intro')}</p>
      <ul className="work-catalog-tree" aria-label={t('workCatalog.categories')}>
        {WORK_TYPE_ORDER.map((type) => node(builtinCategoryId(type), t(`workTypes.${type}`), builtInMethodKey(type), null))}
        {catalog.categories.map((c) => node(c.id, c.name || t('workCatalog.unnamedCategory'), c.method, c))}
      </ul>
      <button type="button" className="btn-secondary small work-catalog-new" onClick={addCategory}>{t('workCatalog.newCategory')}</button>

      {plan && updateCount > 0 && <div className="work-catalog-updates" role="status">
        <span>{t('workCatalog.planUpdates', { count: updateCount })}</span>
        <button type="button" className="btn-secondary small" onClick={() => applyPlanCatalogUpdates(updates)}>{t('workCatalog.applyUpdates')}</button>
      </div>}
      <div className="modal-actions">
        <button type="button" className="btn-primary" onClick={onClose}>{t('workCatalog.close')}</button>
      </div>
    </AppModal>
  );
}
