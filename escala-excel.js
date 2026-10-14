/* Excel import/export uses the same role keys as the stored schedule. */
(function (root) {
'use strict';
const key = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
function text(cell) {
 if (cell.type === ExcelJS.ValueType.Formula) throw Error('Fórmulas não são permitidas na base. Use nomes ou células vazias.');
 return typeof cell.value === 'string' ? cell.value.trim() : cell.value == null ? '' : cell.value instanceof Date ? cell.value : cell.text.trim();
}
function validate(rows, state, roles) {
 if (!rows.length || rows.length > 370) throw Error('A base deve conter entre 1 e 370 datas.');
 const seen = new Set(), changes = [];
 for (const row of rows) {
  if (seen.has(row.date)) throw Error('Data repetida: ' + row.date); seen.add(row.date);
  const schedule = state.schedules.find(s => s.date === row.date);
  if (!schedule) throw Error('Data fora da escala atual: ' + row.date);
  for (const role of roles) {
   const raw = String(row[role] || '').trim();
   const current = schedule.assignments[role] || '';
   const allowed = [...(state.members[role] || []), current].filter(Boolean);
   const matched = allowed.find(name => key(name) === key(raw));
   if (raw && !matched) throw Error(row.date + ' · ' + role + ': integrante não cadastrado (' + raw + ').');
   const after = raw ? matched : '';
   if (after !== current) changes.push({date:row.date, role, before:current, after});
  }
 }
 return changes;
}
function apply(state, changes) {
 const result = structuredClone(state);
 for (const c of changes) {
  const schedule = result.schedules.find(s => s.date === c.date);
  if (!schedule || (schedule.assignments[c.role] || '') !== c.before) throw Error('A escala mudou durante a revisão. Importe a planilha novamente.');
  if(c.after) schedule.assignments[c.role] = c.after; else delete schedule.assignments[c.role];
 }
 return result;
}
async function download(state, roles, year) {
 if (![2026,2027].includes(year)) throw Error("Selecione 2026 ou 2027.");
 const schedules = state.schedules.filter(s => s.date.startsWith(year + "-"));
 if (!schedules.length) throw Error("Não há domingos preparados para este ano.");
 if (!root.ExcelJS) throw Error('A biblioteca Excel não carregou. Verifique a conexão e atualize a página.');
 const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Escala'); const members = wb.addWorksheet('Integrantes');
 ws.addRow(['Data', ...roles]); members.addRow(roles);
 ws.views = [{state:'frozen',xSplit:1,ySplit:1}]; ws.autoFilter = {from:'A1',to:{row:1,column:roles.length+1}};
 ws.getColumn(1).width = 16;
 roles.forEach((role,i) => {
  ws.getColumn(i+2).width = 24; members.getColumn(i+1).width = 24;
  const names = [...new Set([...(state.members[role] || []), ...state.schedules.map(s => s.assignments[role]).filter(Boolean)])].sort();
  names.forEach((name,j) => members.getCell(j+2,i+1).value = name);
  const col = members.getColumn(i+1).letter;
  wb.definedNames.add('Integrantes!$' + col + '$2:$' + col + '$' + Math.max(2,names.length+1), 'Equipe_' + i);
 });
 schedules.forEach(s => {
  const row = ws.addRow([s.date,...roles.map(role => s.assignments[role] || '')]);
  roles.forEach((role,i) => row.getCell(i+2).dataValidation = {type:'list',allowBlank:true,formulae:['Equipe_'+i],showErrorMessage:true,errorStyle:'stop',errorTitle:'Integrante inválido',error:'Selecione um integrante cadastrado para esta função.'});
 });
 for (const sheet of [ws,members]) {
  sheet.getRow(1).font = {bold:true,color:{argb:'FFFFFFFF'}};
  sheet.getRow(1).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FF173F35'}};
  sheet.getRow(1).height = 26;
 }
 const guide = wb.addWorksheet('Como usar');
 ['Edite apenas a aba Escala. A base sempre contém o ano selecionado inteiro, independente dos filtros do portal.', 'Selecione os integrantes nas listas ou digite nomes já cadastrados.', 'Mantenha as datas e os títulos das colunas. Células vazias removem a pessoa da função.', 'Cadastre novos integrantes no portal antes de baixar a base.', 'Importe o arquivo .xlsx no modo edição e revise as alterações antes de aplicar.', 'Registros de trocas e funções retiradas da interface são preservados.'].forEach(t=>guide.addRow([t]));
 guide.getColumn(1).width = 110;
 const blob = new Blob([await wb.xlsx.writeBuffer()], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download='Base_Escala_IPCVT_' + year + '.xlsx'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function read(file,state,roles) {
 if (!root.ExcelJS) throw Error('A biblioteca Excel não carregou. Atualize a página.');
 if (!/\.xlsx$/i.test(file.name) || file.size > 5*1024*1024) throw Error('Selecione uma planilha .xlsx de até 5 MB.');
 const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await file.arrayBuffer());
 const ws = wb.getWorksheet('Escala'); if(!ws) throw Error('A aba Escala não foi encontrada. Baixe a base pelo portal.');
 if(ws.rowCount>371 || ws.columnCount!==roles.length+1)throw Error('Estrutura inválida. Use a base exportada pelo portal.');
 const headers=['Data',...roles]; headers.forEach((h,i)=>{if(text(ws.getCell(1,i+1))!==h && !(h==='Litúrgico' && text(ws.getCell(1,i+1))==='Seleção de Repertório'))throw Error('Cabeçalho inválido: esperado '+h+'.');});
 const rows=[];
 for(let n=2;n<=ws.rowCount;n++) {
  const cells=headers.map((h,i)=>text(ws.getCell(n,i+1)));
  if(cells.every(v=>v===''))continue;
  let date=cells[0];
  if(date instanceof Date)date=date.toISOString().slice(0,10);
  if(typeof date==='string' && /^\d{2}\/\d{2}\/\d{4}$/.test(date)) date=date.split('/').reverse().join('-');
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Data inválida na linha '+n+'.');
  const row={date};roles.forEach((r,i)=>row[r]=cells[i+1]);rows.push(row);
 }
 return validate(rows,state,roles);
}
root.IPCVTExcel={download,read,validate,apply};
})(typeof window === 'undefined' ? globalThis : window);
