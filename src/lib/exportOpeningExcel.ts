import type ExcelJS from 'exceljs';
import type { Plan } from '../types';
import { openingReportTables, buildOpeningQuantityReport } from './openingQuantityReport';
import type { ExportContext } from './exportLanguage';

export function addOpeningQuantitySheets(workbook:ExcelJS.Workbook,plans:Plan[],x:ExportContext,roomScope?:Set<string>,pageScope?:Set<number>) {
 const tables=openingReportTables(plans,x,roomScope,pageScope);
 const reports=plans.map(plan=>buildOpeningQuantityReport(plan,roomScope,pageScope));
 for(const [index,table] of tables.entries()){
  const name=table.title.replace(/[\\/*?:\[\]]/g,' ').slice(0,31);
  const sheet=workbook.addWorksheet(name,{views:[{rightToLeft:x.rtl}]});
  table.widths.forEach((width,i)=>sheet.getColumn(i+1).width=width);
  const header=sheet.addRow(table.headers);header.height=32;
  header.eachCell(c=>{c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1F4E79'}};c.alignment={wrapText:true,horizontal:'center'};});
  table.rows.forEach((values,i)=>{
   const row=sheet.addRow(values);
   // Keep dimensions and counts genuinely numeric in Excel, including blank unknown values.
   if(index===0){row.getCell(2).value=reports[i]?.doors??reports.reduce((n,r)=>n+r.doors,0);row.getCell(3).value=reports[i]?.windows??reports.reduce((n,r)=>n+r.windows,0);}
   else if(index===1){const source=reports.flatMap(r=>r.schedule)[i];[source.widthM,source.heightM,source.baseM,source.quantity,source.countedQuantity].forEach((n,j)=>row.getCell(j+3).value=n);}
   else if(table.title===x.t('openingQuantities.deductions')){
    const source=reports.flatMap(r=>r.work)[i];
    if(typeof values[3]==='string'&&values[3]!==x.t('exports.common.notCalibrated'))[source.gross,source.deducted,source.net].forEach((n,j)=>row.getCell(j+4).value=Math.round(n*100)/100);
   }
   row.eachCell({includeEmpty:true},cell=>{cell.alignment={wrapText:true,vertical:'top',horizontal:'center'};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:i%2?'FFFDFEFE':'FFEBF5FB'}};if(typeof cell.value==='number')cell.numFmt='#,##0.00';});
  });
 }
}
