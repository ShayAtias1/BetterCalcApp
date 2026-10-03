import { everything, isEverything, NO_CONTENT, type ExportContent, type ExportSection } from '../lib/exportContent';
import { useT } from '../i18n';

/** The words of each section: the plan PDF says "Plan with markings / Finishes quantities..."; the workbooks and the project report just name the domain. */
const PDF_LABEL = {
  plan: 'quantityExport.contentPlan',
  finishes: 'quantityExport.contentFinishes',
  concrete: 'quantityExport.contentConcrete',
  rebar: 'quantityExport.contentRebar',
} as const;
const DOMAIN_LABEL = {
  plan: 'quantityExport.contentPlan',
  finishes: 'workspace.tabs.rooms',
  concrete: 'workspace.tabs.concrete',
  rebar: 'workspace.tabs.rebar',
} as const;

/**
 * "What to export": one checkbox per section the export can contain, plus "Everything" (every
 * section the plan or project actually has). Sections with nothing to export are disabled. Shared by
 * the plan PDF, the plan Excel and the project exports, so the choice looks and works the same.
 */
export default function ExportContentPicker({
  sections,
  content,
  available,
  labels = 'domain',
  onChange,
}: {
  sections: readonly ExportSection[];
  content: ExportContent;
  available: ExportContent;
  labels?: 'pdf' | 'domain';
  onChange: (next: ExportContent) => void;
}) {
  const t = useT();
  const names = labels === 'pdf' ? PDF_LABEL : DOMAIN_LABEL;
  // "Everything" is judged on the sections this export offers only.
  const offered = Object.fromEntries((['plan', 'finishes', 'concrete', 'rebar'] as const).map((s) => [s, sections.includes(s) && available[s]])) as ExportContent;
  return (
    <>
      <span className="section-label">{t('quantityExport.whatToExport')}</span>
      <ul className="page-checkbox-list export-content-list">
        {sections.map((section) => (
          <li key={section}>
            <label>
              <input type="checkbox" disabled={!available[section]} checked={content[section]} onChange={(e) => onChange({ ...content, [section]: e.target.checked })} />
              {t(names[section])}
            </label>
          </li>
        ))}
        <li className="export-content-all">
          <label>
            <input type="checkbox" checked={isEverything(content, offered)} onChange={(e) => onChange(e.target.checked ? everything(offered) : NO_CONTENT)} />
            {t('quantityExport.contentEverything')}
          </label>
        </li>
      </ul>
    </>
  );
}
