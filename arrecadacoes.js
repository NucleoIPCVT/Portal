(function(root){
'use strict';
const key=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ');
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v/100);
function cents(v){const n=Number(v);if(!Number.isFinite(n)||n<0||n>10000000)throw Error('Informe um valor válido, maior ou igual a zero.');return Math.round(n*100)}
function totals(p){const paid=p.payments.reduce((sum,x)=>sum+x.amount,0);return {paid,due:Math.max(0,p.expected-paid),credit:Math.max(0,paid-p.expected)}}
function merge(people,rows){const seen=new Set(),existing=new Set(people.map(p=>key(p.name)));const added=[];let skipped=0;for(const row of rows){const name=String(row.name||'').trim();if(!name||name.length>120)throw Error('Informe um nome com até 120 caracteres.');const k=key(name);if(seen.has(k))throw Error('Nome repetido na planilha: '+name);seen.add(k);const expected=cents(row.expected),paid=cents(row.paid||0);if(paid>expected)throw Error('O valor pago não pode ultrapassar o devido: '+name);if(existing.has(k)){skipped++;continue}added.push({id:crypto.randomUUID(),name,expected,payments:paid?[{id:crypto.randomUUID(),amount:paid,date:new Date().toISOString(),note:'Pagamento inicial'}]:[]})}return {added,skipped}}
let api,data,id,dialog,busy=false,pending=[],defaultPrice=0;
const el=id=>document.getElementById(id);
function message(t){el('ledger-message').textContent=t}
function initialize(){if(dialog)return;dialog=document.createElement('section');dialog.id='ledger-dialog';dialog.hidden=true;dialog.innerHTML=
'<header><div><small>ACESSO ADMINISTRATIVO</small><h2 id="ledger-title"></h2></div><div class="ledger-header-actions"><button id="ledger-delete-request" type="button">Excluir</button><button id="ledger-close" aria-label="Voltar às arrecadações"><span class="ledger-back-full">Voltar às arrecadações</span><span class="ledger-back-short" aria-hidden="true">Voltar</span></button></div></header>'+ 
'<section id="ledger-delete-confirmation" hidden role="alert"><h3>Excluir arrecadação?</h3><p>A arrecadação e seus registros de participantes e pagamentos serão apagados. Esta ação não pode ser desfeita.</p><div><button id="ledger-delete-cancel" type="button">Cancelar</button><button id="ledger-delete-confirm" type="button">Excluir definitivamente</button></div></section>'+
'<details class="ledger-description-block"><summary>Sobre esta arrecadação</summary><p id="ledger-description">Controle de participantes e pagamentos. Estes lançamentos são separados das ofertas públicas.</p></details><div id="ledger-totals" class="ledger-totals"></div>'+ 
'<div class="ledger-tools"><input id="ledger-search" type="search" aria-label="Buscar participante" placeholder="Buscar participante"><select id="ledger-status" aria-label="Filtrar pagamento"><option value="">Todos</option><option value="pending">Com pendência</option><option value="paid">Quitados</option></select><details class="ledger-excel-tools"><summary>Excel</summary><div><button id="ledger-template">Baixar modelo</button><button id="ledger-import">Importar lista</button></div></details><input id="ledger-file" type="file" accept=".xlsx" hidden></div>'+ 
'<details id="ledger-add-section"><summary>Cadastrar participante</summary><form id="ledger-add"><label>Nome<input id="ledger-name" maxlength="120" required></label><label>Valor devido (R$)<input id="ledger-expected" type="number" min="0" step="0.01" required><small id="ledger-price-hint"></small></label><label>Já pago (R$)<input id="ledger-paid" type="number" min="0" step="0.01" value="0" required></label><button>Adicionar</button></form></details>'+ 
'<section id="ledger-preview" hidden><h3>Revisar importação</h3><p id="ledger-preview-text"></p><ul id="ledger-preview-list"></ul><button id="ledger-cancel-import">Cancelar</button><button id="ledger-apply-import">Confirmar inclusão</button></section>'+ 
'<p id="ledger-message" role="status"></p><div class="ledger-table-wrap"><table role="table" aria-label="Participantes e pagamentos"><thead role="rowgroup"><tr role="row"><th scope="col">Participante</th><th scope="col">Devido</th><th scope="col">Pago</th><th scope="col">Falta</th><th scope="col">Pagamento</th></tr></thead><tbody id="ledger-rows" role="rowgroup"></tbody></table></div>';
document.querySelector('main').appendChild(dialog);el('ledger-close').onclick=()=>{if(busy)return;hide();api.onClose?.()};dialog.addEventListener('close',()=>{data=null;id=null;pending=[];el('ledger-rows').replaceChildren();el('ledger-preview').hidden=true});dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault()});el('ledger-search').oninput=render;el('ledger-status').onchange=render;
el('ledger-add').onsubmit=async e=>{e.preventDefault();try{const result=merge(data.people,[{name:el('ledger-name').value,expected:el('ledger-expected').value,paid:el('ledger-paid').value}]);if(result.skipped)throw Error('Esse nome já está cadastrado. Registre o pagamento na linha existente.');await persist([...data.people,...result.added]);resetParticipantForm()}catch(e){message(e.message)}};
el('ledger-delete-request').onclick=()=>{if(busy)return;el('ledger-delete-confirmation').hidden=false;el('ledger-delete-cancel').focus()};
el('ledger-delete-cancel').onclick=()=>{el('ledger-delete-confirmation').hidden=true;el('ledger-delete-request').focus()};
el('ledger-delete-confirm').onclick=async()=>{
 if(busy || !data)return;
 busy=true;dialog.querySelectorAll('button').forEach(button=>button.disabled=true);message('Excluindo…');
 try {
  await api.remove(id,data.version||0);
  busy=false;hide();api.onClose?.();
 } catch(e) { message('Não foi possível excluir: '+e.message); }
 finally { busy=false;dialog.querySelectorAll('button').forEach(button=>button.disabled=false); }
};
el('ledger-template').onclick=template;el('ledger-import').onclick=()=>el('ledger-file').click();el('ledger-file').onchange=importFile;el('ledger-cancel-import').onclick=()=>{pending=[];el('ledger-preview').hidden=true};el('ledger-apply-import').onclick=async()=>{try{await persist([...data.people,...pending]);pending=[];el('ledger-preview').hidden=true}catch(e){message(e.message)}};
}
async function persist(people){if(busy)throw Error('Aguarde o salvamento.');busy=true;dialog.querySelectorAll('button').forEach(b=>b.disabled=true);message('Salvando…');try{const candidate={...data,people};await api.save(id,candidate,data.version||0);data={...candidate,version:(data.version||0)+1};render();message('Alterações salvas.')}finally{busy=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false)}}
async function removeParticipant(participantId, trigger) {
 if(busy || !data)return;
 const campaignId=id,person=data.people.find(p=>p.id===participantId);
 if(!person)return;
 busy=true;dialog.querySelectorAll('button').forEach(button=>button.disabled=true);
 try {
  const authorized=await api.reauthenticateRemoval({name:person.name});
  if(!authorized){trigger?.focus();return;}
  if(!data || id!==campaignId)throw Error('A arrecadação mudou. Abra o controle novamente.');
  busy=false;
  await persist(data.people.filter(p=>p.id!==participantId));
  message('Cadastro e pagamentos de '+person.name+' excluídos.');
  el('ledger-search').focus();
 } catch(e) { message('Não foi possível excluir o cadastro: '+e.message); }
 finally { busy=false;dialog.querySelectorAll('button').forEach(button=>button.disabled=false); }
}

function resetParticipantForm() {
 const input = el('ledger-expected');
 input.defaultValue = (defaultPrice / 100).toFixed(2);
 el('ledger-add').reset();
 input.value = input.defaultValue;
 el('ledger-paid').value = '0';
 el('ledger-price-hint').textContent = 'Valor padrão: ' + money(defaultPrice) + '. Edite para aplicar desconto.';
}
function participantGroups(people, query='', status='') {
 const term=key(query);
 const visible=people.filter(p=>key(p.name).includes(term));
 return [
  {label:'Pagamentos pendentes',status:'pending',people:visible.filter(p=>totals(p).due>0)},
  {label:'Quitados',status:'paid',people:visible.filter(p=>totals(p).due===0)}
 ].filter(group=>!status||group.status===status);
}
function adjustExpected(people, participantId, value) {
 const expected=cents(value), result=structuredClone(people);
 const person=result.find(p=>p.id===participantId);
 if(!person)throw Error('Participante não encontrado.');
 if(expected<totals(person).paid)throw Error('O valor devido não pode ser menor que o valor já pago.');
 person.expected=expected;
 return result;
}
function render() {
 if(!data)return;
 let expected=0,paid=0,due=0;
 data.people.forEach(p=>{const t=totals(p);expected+=p.expected;paid+=t.paid;due+=t.due});
 const metrics=el('ledger-totals');metrics.replaceChildren();
 for(const [label,value] of [['Previsto',expected],['Recebido',paid],['Pendente',due]]) {
  const item=document.createElement('div');item.className='ledger-metric';
  const caption=document.createElement('span');caption.textContent=label;
  const amount=document.createElement('strong');amount.textContent=money(value);
  item.append(caption,amount);metrics.append(item);
 }
 const body=el('ledger-rows');body.replaceChildren();
 const groups=participantGroups(data.people,el('ledger-search').value,el('ledger-status').value);
 let count=0;
 for(const group of groups) {
  if(!group.people.length)continue;
  const heading=document.createElement('tr');heading.className='ledger-group-row';heading.setAttribute('role','row');
  const label=document.createElement('th');label.colSpan=5;label.setAttribute('scope','rowgroup');
  label.textContent=group.label+' ('+group.people.length+')';heading.append(label);body.append(heading);
  for(const p of group.people) {
   count++;
   const t=totals(p),tr=document.createElement('tr');tr.className='ledger-person-row '+(group.status==='paid'?'is-paid':'is-pending');tr.setAttribute('role','row');
   const name=document.createElement('td');name.setAttribute('role','cell');
   const nameLine=document.createElement('div');nameLine.className='ledger-person-name';
   const nameText=document.createElement('span');nameText.textContent=p.name;
   const remove=document.createElement('button');remove.type='button';remove.className='ledger-person-delete';remove.title='Excluir cadastro de '+p.name;remove.setAttribute('aria-label','Excluir cadastro de '+p.name);
   const cross=document.createElement('span');cross.textContent='×';cross.setAttribute('aria-hidden','true');remove.append(cross);remove.onclick=()=>removeParticipant(p.id,remove);
   nameLine.append(nameText,remove);name.append(nameLine);tr.append(name);
   const dueCell=document.createElement('td'),dueValue=document.createElement('span');dueValue.textContent=money(p.expected);dueCell.setAttribute('data-label','Devido');dueCell.setAttribute('role','cell');dueCell.append(dueValue);
   const adjustment=document.createElement('details');adjustment.className='ledger-adjustment';
   const adjustLabel=document.createElement('summary');adjustLabel.textContent='Ajustar valor';adjustment.append(adjustLabel);
   const adjustForm=document.createElement('form');adjustForm.className='ledger-adjustment-form';
   const adjustInput=document.createElement('input');adjustInput.type='number';adjustInput.min='0';adjustInput.step='.01';adjustInput.required=true;adjustInput.value=(p.expected/100).toFixed(2);adjustInput.setAttribute('aria-label','Valor devido de '+p.name);
   const adjustButton=document.createElement('button');adjustButton.textContent='Salvar';adjustForm.append(adjustInput,adjustButton);
   adjustForm.onsubmit=async e=>{e.preventDefault();try{await persist(adjustExpected(data.people,p.id,adjustInput.value))}catch(e){message(e.message)}};
   adjustment.append(adjustForm);tr.append(dueCell);
   for(const [label,value] of [['Pago',money(t.paid)],['Falta',money(t.due)+(t.credit?' · crédito '+money(t.credit):'')]]) {
    const cell=document.createElement('td');cell.textContent=value;cell.setAttribute('data-label',label);cell.setAttribute('role','cell');tr.append(cell);
   }
   const paymentCell=document.createElement('td');paymentCell.className='ledger-person-actions';paymentCell.setAttribute('role','cell');
   if(t.due>0) {
    const form=document.createElement('form');form.className='ledger-payment';
    const amount=document.createElement('input');amount.type='number';amount.min='.01';amount.max=(t.due/100).toFixed(2);amount.step='.01';amount.required=true;amount.placeholder='R$';amount.setAttribute('aria-label','Novo pagamento de '+p.name);
    const button=document.createElement('button');button.textContent='Registrar';form.append(amount,button);
    form.onsubmit=async e=>{e.preventDefault();try {
     const value=cents(amount.value);
     if(value<=0)throw Error('Informe um pagamento maior que zero.');
     if(value>totals(data.people.find(x=>x.id===p.id)).due)throw Error('O pagamento ultrapassa o saldo pendente desta pessoa.');
     const people=structuredClone(data.people);
     people.find(x=>x.id===p.id).payments.push({id:crypto.randomUUID(),amount:value,date:new Date().toISOString(),note:'Pagamento registrado'});
     await persist(people);
    }catch(e){message(e.message)}};
    paymentCell.append(form);
   } else {
    const badge=document.createElement('span');badge.className='ledger-paid-badge';badge.textContent='Quitado';paymentCell.append(badge);
   }
   const history=document.createElement('details'),summary=document.createElement('summary');
   summary.textContent='Histórico ('+p.payments.length+')';history.append(summary);
   p.payments.forEach(payment=>{const line=document.createElement('div');line.textContent=new Date(payment.date).toLocaleDateString('pt-BR')+' · '+money(payment.amount);history.append(line)});
   paymentCell.append(adjustment,history);tr.append(paymentCell);body.append(tr);
  }
 }
 if(!count) {
  const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.textContent='Nenhum participante encontrado.';tr.append(td);body.append(tr);
 }
}
async function template(){try{if(!root.ExcelJS)throw Error('A biblioteca Excel não carregou. Atualize a página e verifique a conexão.');const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Participantes');ws.addRow(['Nome','Valor devido','Valor pago']);ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF173F35'}};ws.getColumn(1).width=36;[2,3].forEach(c=>{ws.getColumn(c).width=20;ws.getColumn(c).numFmt='"R$" #,##0.00'});const guide=wb.addWorksheet('Instruções');['Preencha Participantes a partir da linha 2. Valores em reais, sem fórmulas.','Nome é obrigatório. Valor devido vazio usa o preço por pessoa do evento. Valor pago é opcional.','Nomes já existentes são ignorados: pagamentos e valores existentes são preservados.','Registre pagamentos posteriores no portal. Use nomes completos para distinguir pessoas.'].forEach(t=>guide.addRow([t]));guide.getColumn(1).width=110;const url=URL.createObjectURL(new Blob([await wb.xlsx.writeBuffer()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),a=document.createElement('a');a.href=url;a.download='Modelo_Participantes.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){message(e.message)}}
async function importFile(){try{const file=el('ledger-file').files[0];if(!file)return;if(!root.ExcelJS)throw Error('A biblioteca Excel não carregou.');if(!/\.xlsx$/i.test(file.name)||file.size>5*1024*1024)throw Error('Use um arquivo .xlsx de até 5 MB.');const wb=new ExcelJS.Workbook();await wb.xlsx.load(await file.arrayBuffer());const ws=wb.getWorksheet('Participantes');if(!ws||ws.rowCount>2001)throw Error('Use o modelo Participantes, com até 2.000 pessoas.');['Nome','Valor devido','Valor pago'].forEach((h,i)=>{if(ws.getCell(1,i+1).text.trim()!==h)throw Error('Cabeçalho inválido. Baixe o modelo.')});const rows=[];for(let n=2;n<=ws.rowCount;n++){const cells=[1,2,3].map(c=>ws.getCell(n,c));if(cells.every(c=>c.value==null||c.value===''))continue;if(cells.some(c=>c.type===ExcelJS.ValueType.Formula))throw Error('Remova as fórmulas na linha '+n);rows.push({name:cells[0].text,expected:cells[1].value==null||cells[1].value==='' ? defaultPrice/100 : cells[1].value,paid:cells[2].value||0})}const result=merge(data.people,rows);pending=result.added;el('ledger-preview-text').textContent=pending.length+' novas pessoas · '+result.skipped+' nomes existentes preservados.';const list=el('ledger-preview-list');list.replaceChildren();pending.forEach(p=>{const li=document.createElement('li');li.textContent=p.name+' · devido '+money(p.expected)+' · pago '+money(totals(p).paid);list.append(li)});el('ledger-preview').hidden=!pending.length;message(pending.length?'Revise a lista antes de confirmar.':'Nenhuma pessoa nova para incluir.')}catch(e){message(e.message)}finally{el('ledger-file').value=''}}
function hide(){if(!dialog||busy)return;dialog.hidden=true;data=null;id=null;pending=[];el('ledger-rows').replaceChildren();el('ledger-preview').hidden=true;el('ledger-delete-confirmation').hidden=true}
root.IPCVTLedger={hide,configure:options=>api=options,open:async(campaignId,title,price=0,description='')=>{initialize();try{const loaded=await api.load(campaignId);id=campaignId;data=loaded;defaultPrice=cents(Number(price)/100);resetParticipantForm();el('ledger-delete-confirmation').hidden=true;el('ledger-add-section').open=false;dialog.querySelector('.ledger-excel-tools').open=false;dialog.querySelector('.ledger-description-block').open=false;el('ledger-title').textContent=title;el('ledger-search').value='';el('ledger-status').value='';message('');render();el('ledger-description').textContent=description || 'Controle de participantes e pagamentos. Acesso reservado.';api.onOpen?.();dialog.hidden=false}catch(e){alert('Não foi possível abrir o controle: '+e.message)}},merge,totals,cents,participantGroups,adjustExpected};
})(typeof window==='undefined'?globalThis:window);
