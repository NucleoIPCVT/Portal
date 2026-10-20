(function(root){
'use strict';
const currency=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value/100).replace(/\u00a0/g,' ');
function buildReport(people,title,generatedAt=new Date()) {
 const groups=[{key:'paid',label:'Quitados',people:[]},{key:'partial',label:'Parciais',people:[]},{key:'pending',label:'Pendentes',people:[]}];
 const report={title:String(title||'Arrecadação'),generatedAt:generatedAt.toISOString(),count:people.length,expected:0,received:0,pending:0,credit:0,groups};
 for(const person of people) {
  const values=root.IPCVTLedger.totals(person);
  const row={name:String(person.name||''),expected:person.expected,paid:values.paid,pending:values.due,credit:values.credit};
  report.expected+=row.expected;report.received+=row.paid;report.pending+=row.pending;report.credit+=row.credit;
  groups[row.pending===0?0:row.paid>0?1:2].people.push(row);
 }
 groups.forEach(group=>group.people.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR',{sensitivity:'base',numeric:true})));
 return report;
}
const emitted=report=>new Date(report.generatedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
const filename=report=>'Relatorio_'+report.title.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'_').slice(0,70)+'_'+report.generatedAt.slice(0,10);
function excelWorkbook(report) {
 if(!root.ExcelJS)throw Error('A biblioteca Excel não carregou. Verifique a conexão e atualize a página.');
 const wb=new root.ExcelJS.Workbook();wb.creator='Núcleo IPCVT';
 const ws=wb.addWorksheet('Relatório',{views:[{state:'frozen',ySplit:4}],pageSetup:{paperSize:9,orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0}});
 const green='FF1B3E31',cream='FFF2ECD8',ink='FF193D30';
 ws.columns=[{width:42},{width:21},{width:21},{width:21}];
 ws.mergeCells('A1:D1');ws.getCell('A1').value='RELATÓRIO DE ARRECADAÇÃO';ws.getCell('A1').font={name:'Calibri',size:16,bold:true,color:{argb:green}};ws.getRow(1).height=30;
 ws.mergeCells('A2:D2');ws.getCell('A2').value=report.title;ws.getCell('A2').font={name:'Calibri',size:13,bold:true,color:{argb:ink}};ws.getCell('A2').alignment={wrapText:true,vertical:'middle'};ws.getRow(2).height=Math.max(25,Math.ceil(report.title.length/90)*18);
 ws.getCell('A3').value='Quantidade de pessoas';ws.getCell('B3').value=report.count;ws.getCell('B3').numFmt='0';
 ws.getCell('A4').value='Emitido em';ws.mergeCells('B4:D4');ws.getCell('B4').value=emitted(report);
 const moneyFormat='"R$" #,##0.00';
 ws.getCell('A6').value='Valor previsto';ws.getCell('B6').value=report.expected/100;ws.getCell('B6').numFmt=moneyFormat;
 ws.getCell('C6').value='Valor recebido';ws.getCell('D6').value=report.received/100;ws.getCell('D6').numFmt=moneyFormat;
 ws.getCell('A7').value='Valor pendente';ws.getCell('B7').value=report.pending/100;ws.getCell('B7').numFmt=moneyFormat;
 if(report.credit){ws.getCell('C7').value='Crédito recebido';ws.getCell('D7').value=report.credit/100;ws.getCell('D7').numFmt=moneyFormat;}
 ws.getRow(9).values=['Quitados','Parciais','Pendentes'];ws.getRow(10).values=report.groups.map(group=>group.people.length);
 let line=12;
 for(const group of report.groups) {
  ws.mergeCells(line,1,line,4);const heading=ws.getCell(line,1);heading.value=group.label+' ('+group.people.length+')';heading.font={name:'Calibri',bold:true,color:{argb:'FFFFFFFF'}};heading.fill={type:'pattern',pattern:'solid',fgColor:{argb:green}};ws.getRow(line).height=26;line++;
  ws.getRow(line).values=['Nome','Devido','Pago','Pendente'];ws.getRow(line).font={bold:true,color:{argb:ink}};ws.getRow(line).fill={type:'pattern',pattern:'solid',fgColor:{argb:cream}};ws.getRow(line).height=23;line++;
  if(!group.people.length){ws.mergeCells(line,1,line,4);ws.getCell(line,1).value='Nenhuma pessoa neste grupo.';line++;}
  for(const person of group.people) {
   ws.getRow(line).values=[person.name,person.expected/100,person.paid/100,person.pending/100];
   ws.getCell(line,1).alignment={wrapText:true,vertical:'middle'};
   for(let col=2;col<=4;col++){ws.getCell(line,col).numFmt=moneyFormat;ws.getCell(line,col).alignment={horizontal:'right',vertical:'middle'};}
   ws.getRow(line).height=Math.max(23,Math.ceil(person.name.length/36)*15);
   line++;
  }
  line++;
 }
 ws.pageSetup.printArea='A1:D'+(line-1);ws.pageSetup.printTitlesRow='1:4';
 ws.headerFooter.oddFooter='Núcleo IPCVT | Página &P de &N';
 return wb;
}
function pdfDocument(report) {
 if(!root.jspdf?.jsPDF)throw Error('A biblioteca PDF não carregou. Verifique a conexão e atualize a página.');
 const doc=new root.jspdf.jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
 if(typeof doc.autoTable!=='function')throw Error('A biblioteca de tabelas do PDF não carregou. Atualize a página.');
 const margin=16,width=doc.internal.pageSize.getWidth(),height=doc.internal.pageSize.getHeight();
 doc.setTextColor(27,62,49);doc.setFont('helvetica','bold');doc.setFontSize(10);doc.text('NÚCLEO IPCVT / RELATÓRIO DE ARRECADAÇÃO',margin,18);
 doc.setDrawColor(184,157,93);doc.line(margin,23,width-margin,23);
 doc.setFontSize(17);const titleLines=doc.splitTextToSize(report.title,width-margin*2);let y=33;
 for(const line of titleLines){if(y>height-24){doc.addPage();y=22;}doc.text(line,margin,y);y+=7;}
 if(y>height-75){doc.addPage();y=22;}
 doc.setFontSize(12);doc.text('Quantidade de pessoas: '+report.count,margin,y+4);
 doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(75,88,70);doc.text('Emitido em '+emitted(report),margin,y+11);
 doc.text('Previsto: '+currency(report.expected)+'   |   Recebido: '+currency(report.received)+'   |   Pendente: '+currency(report.pending),margin,y+20);
 doc.text(report.groups.map(group=>group.label+': '+group.people.length).join('   |   '),margin,y+27);y+=36;
 if(report.credit){doc.text('Recebimentos incluem '+currency(report.credit)+' de crédito acima do devido.',margin,y);y+=8;}
 for(const group of report.groups) {
  if(y>height-42){doc.addPage();y=20;}
  doc.autoTable({
   startY:y,margin:{top:18,left:margin,right:margin,bottom:18},theme:'plain',showHead:'everyPage',rowPageBreak:'avoid',
   head:[[{content:group.label+' ('+group.people.length+')',colSpan:4,styles:{fillColor:[27,62,49],textColor:255,fontStyle:'bold',cellPadding:3}}],['Nome','Devido','Pago','Pendente']],
   body:group.people.length?group.people.map(p=>[p.name,currency(p.expected),currency(p.paid),currency(p.pending)]):[[{content:'Nenhuma pessoa neste grupo.',colSpan:4}]],
   styles:{font:'helvetica',fontSize:9,cellPadding:3,overflow:'linebreak',textColor:[25,61,48],lineColor:[222,216,197],lineWidth:.1},
   headStyles:{fillColor:[242,236,216],textColor:[25,61,48],fontStyle:'bold'},
   alternateRowStyles:{fillColor:[248,246,237]},
   columnStyles:{0:{cellWidth:79},1:{cellWidth:33,halign:'right'},2:{cellWidth:33,halign:'right'},3:{cellWidth:33,halign:'right'}}
  });
  y=doc.lastAutoTable.finalY+9;
 }
 const pages=doc.getNumberOfPages();
 for(let page=1;page<=pages;page++){doc.setPage(page);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(100);doc.text('Núcleo IPCVT',margin,height-9);doc.text('Página '+page+' de '+pages,width-margin,height-9,{align:'right'});}
 return doc;
}
async function download(report,format) {
 if(format==='pdf'){pdfDocument(report).save(filename(report)+'.pdf');return;}
 if(format!=='xlsx')throw Error('Formato de relatório inválido.');
 const buffer=await excelWorkbook(report).xlsx.writeBuffer();
 const url=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
 try{const link=document.createElement('a');link.href=url;link.download=filename(report)+'.xlsx';link.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
root.IPCVTLedgerReports={buildReport,excelWorkbook,pdfDocument,download};
})(typeof window==='undefined'?globalThis:window);
