import type { Plan } from '../types';
import { useLanguage, useT } from '../i18n';
import { exportContext } from '../lib/exportLanguage';
import { buildOpeningQuantityReport, openingReportTables } from '../lib/openingQuantityReport';
export default function OpeningQuantitySummary({plan}:{plan:Plan}) {
 const language=useLanguage(),t=useT();
 const tables=openingReportTables([plan],exportContext(language));
 if(!tables.length)return null;
 const partial=buildOpeningQuantityReport(plan).incomplete;
 return <><p className="opening-help" role="status">{partial?t('openingQuantities.partialNote'):''}</p><details className="opening-quantity-summary"><summary>{t('openingQuantities.schedule')}</summary>
  {buildOpeningQuantityReport(plan).incomplete&&<p className="opening-placement-note" role="status">{t('openingQuantities.partialNote')}</p>}
  {tables.map(table=><div key={table.title} className="opening-report-table"><strong>{table.title}</strong><div className="opening-table-scroll"><table className="quantity-table"><thead><tr>{table.headers.map((header,i)=><th key={i}>{header}</th>)}</tr></thead><tbody>{table.rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody></table></div></div>)}
 </details></>;
}
