/* IPCVT Planner | Painel gerencial visual. Nenhuma IA ou dado demonstrativo. */
import { AGING_BANDS, buildReportModel, focusTasks, dateISO, days, addDay, labelDate, pct } from './planner-reports-data.js?v=20261116-aging-v1'

const STATE={tab:'overview',period:'30',planId:'',team:'',focus:'all',agingKey:'',week:null,
 search:'',historySearch:'',historyAction:'all',visible:12,bucketKey:''}
const COLORS={done:'#5c9e79',danger:'#cc796c',violet:'#9a8abf',warning:'#d5aa63',sage:'#8ab6b0'}
const ACTIONS={created:'Criou',updated:'Editou',completed:'Concluiu',reopened:'Reabriu',
 deleted:'Excluiu',archived:'Arquivou'}
const FIELD={title:'Título',name:'Nome',description:'Descrição',status:'Situação',
 dueDate:'Prazo',startDate:'Início',priority:'Prioridade',assignees:'Responsáveis',
 team:'Equipe',bucketId:'Bucket',planId:'Plano',dependencyIds:'Dependências',
 checklist:'Checklist',eventId:'Evento',deleted:'Arquivamento',recurrence:'Recorrência'}
const txt=(tag,cls='',value='')=>{
 const n=document.createElement(tag)
 if(cls)n.className=cls
 if(value!==null&&value!==undefined)n.textContent=String(value)
 return n
}
function element(tag,cls='',children=[]){
 const n=txt(tag,cls)
 for(const child of children)if(child)n.append(child)
 return n
}
function action(label,fn,cls='',aria=''){
 const b=txt('button',cls,label);b.type='button';b.addEventListener('click',fn)
 if(aria)b.setAttribute('aria-label',aria)
 return b
}
const muted=v=>txt('p','ip-muted',v)
const format=n=>Number.isFinite(Number(n))?Number(n).toLocaleString('pt-BR'):'—'
const owners=t=>(t.assignees||[]).map(p=>p?.name||p?.email).filter(Boolean).join(', ')||'Não atribuído'
const priority=t=>({urgent:'Urgente',high:'Alta',normal:'Normal',low:'Baixa'})[t.priority]||'Normal'
const status=t=>({todo:'Não iniciada',doing:'Em andamento',done:'Concluída'})[t.status]||'Não iniciada'
const domPeriod=['7','30','90','all']
const titleOfFocus={all:'Fila de acompanhamento',late:'Demandas atrasadas',blocked:'Demandas bloqueadas',
 risk:'Demandas em atenção',stale:'Sem atualização há 7 dias ou mais',
 unassigned:'Demandas sem responsável',aging14:'Demandas com aging acima de 14 dias',
 due:'Próximos 7 dias',healthy:'Demandas em dia',done:'Demandas concluídas',
 agingBand:'Demandas por faixa de aging',weekPlanned:'Prazos da semana',weekDone:'Conclusões registradas na semana'}
const TAB=[['overview','Visão geral'],['aging','Aging e gargalos'],['teams','Equipes'],['history','Histórico']]
const roleDate=e=>{
 const v=e?.timestamp
 if(!v)return 'Data indisponível'
 const d=v?.toDate?.()||(typeof v.seconds==='number'?new Date(v.seconds*1000):new Date(v))
 return Number.isFinite(d?.getTime?.())?new Intl.DateTimeFormat('pt-BR',
  {timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(d):'Data indisponível'
}
function box(title,description,cls=''){
 const wrapper=element('section','ip-panel '+cls)
 const head=element('div','ip-panel-heading')
 head.append(txt('h3','',title))
 if(description)head.append(txt('p','',description))
 wrapper.append(head)
 return wrapper
}
function infoBubble(message){
 const n=txt('span','ip-help','?')
 n.title=message;n.setAttribute('aria-label',message);n.setAttribute('role','img')
 return n
}
function jumpToTasks(){
 requestAnimationFrame(()=>document.getElementById('ip-report-actions')?.scrollIntoView({behavior:'smooth',block:'start'}))
}
function changeFocus(focus,rerender){
 STATE.focus=focus;STATE.week=null;STATE.agingKey='';STATE.bucketKey=''
 STATE.visible=12;STATE.tab=focus==='aging14'?'aging':'overview'
 rerender();jumpToTasks()
}
function makeSelect(label,items,value,cb){
 const wrap=element('label','ip-filter')
 wrap.append(txt('span','',label))
 const select=document.createElement('select')
 for(const [v,t] of items){const o=txt('option','',t);o.value=v;select.append(o)}
 select.value=items.some(item=>item[0]===value)?value:''
 select.addEventListener('change',e=>cb(e.target.value))
 wrap.append(select);return wrap
}
function kpi(label,value,sub,kind,description,click){
 const b=action('',click,'ip-kpi ip-tone-'+kind,label+': '+value+'. '+sub)
 b.title=description
 b.append(element('span','ip-kpi-top',[txt('span','',label),infoBubble(description)]))
 b.append(txt('strong','ip-kpi-value',value),txt('span','ip-kpi-hint',sub))
 b.append(txt('span','ip-kpi-foot','Ver detalhes  ↗'))
 return b
}
function donut(model,rerender){
 const p=box('Saúde da carteira','Todas as demandas do recorte, divididas em situações exclusivas.','ip-panel-health')
 const frame=element('div','ip-donut-layout'),figure=element('div','ip-donut-figure')
 const sum=model.chosen.length
 let from=0
 const stops=[]
 for(const h of model.health){
  if(!h.count)continue
  const to=from+100*h.count/Math.max(1,sum)
  stops.push('var(--ip-'+h.color+') '+from.toFixed(3)+'% '+to.toFixed(3)+'%')
  from=to
 }
 const ring=element('div','ip-donut-ring')
 ring.style.background=stops.length?'conic-gradient('+stops.join(', ')+')':'var(--ip-line)'
 ring.setAttribute('role','img')
 ring.setAttribute('aria-label','Distribuição: '+model.health.map(h=>h.label+' '+h.count).join('; '))
 const center=element('div','ip-donut-center',[txt('strong','',format(sum)),txt('span','','demandas')])
 ring.append(center);figure.append(ring)
 const list=element('div','ip-legend')
 for(const h of model.health){
  const item=action('',()=>changeFocus(h.key==='late'?'late':h.key==='done'?'done':h.key==='blocked'?'blocked':h.key==='risk'?'risk':'healthy',rerender),'ip-legend-item')
  const dot=txt('i','ip-swatch ip-swatch-'+h.color)
  dot.setAttribute('aria-hidden','true')
  item.append(dot,txt('span','',h.label),txt('strong','',format(h.count)))
  list.append(item)
 }
 frame.append(figure,list);p.append(frame)
 p.append(txt('p','ip-annotation','Atrasadas têm prioridade sobre bloqueadas na divisão visual; nenhuma demanda é contada duas vezes.'))
 return p
}
function weekly(model,rerender,auditReady){
 const p=box('Fluxo semanal','Prazo atual das demandas × conclusões registradas em cada semana.','ip-panel-week')
 const head=element('div','ip-keyline')
 head.append(element('span','',[txt('i','ip-mini-square ip-planned'),txt('span','','Prazos atuais')]))
 head.append(element('span','',[txt('i','ip-mini-square ip-delivered'),txt('span','','Concluídas no histórico')]))
 p.append(head)
 const max=Math.max(1,...model.trends.flatMap(x=>[x.planned,x.delivered]))
 const chart=element('div','ip-week-chart')
 for(const wk of model.trends){
  const col=element('div','ip-week-col')
  const barArea=element('div','ip-week-pair')
  for(const [type,quantity,cls] of [['weekPlanned',wk.planned,'ip-bar-planned'],['weekDone',wk.delivered,'ip-bar-delivered']]){
   const b=action('',()=>{
    if(type==='weekDone'&&!auditReady)return
    STATE.focus=type;STATE.week=wk.key;STATE.visible=12;STATE.bucketKey='';rerender();jumpToTasks()
   },'ip-week-bar '+cls)
   b.disabled=type==='weekDone'&&!auditReady
   b.style.height=type==='weekDone'&&!auditReady?'0%':Math.max(3,quantity/max*100)+'%'
   b.title=(type==='weekPlanned'?'Prazos':'Conclusões')+' na semana de '+labelDate(wk.key)+': '+quantity+'. Clique para detalhar.'
   b.setAttribute('aria-label',b.title)
   barArea.append(b)
  }
  col.append(barArea,txt('span','ip-week-label',wk.label))
  chart.append(col)
 }
 p.append(chart)
 p.append(txt('p','ip-annotation',auditReady
   ?'Semanas iniciam na segunda-feira. A barra de conclusões utiliza apenas registros de auditoria disponíveis.'
   :'Histórico não carregado: conclusões ficam ocultas para evitar confundir ausência de dados com zero entregas.'))
 return p
}
function horizontal(title,description,entries,opts={}){
 const p=box(title,description,opts.extra||'')
 const max=Math.max(1,...entries.map(x=>x.count||0))
 const list=element('div','ip-bar-list')
 for(const entry of entries.slice(0,opts.limit||9)){
  const btn=action('',()=>opts.click?.(entry),'ip-bar-row')
  btn.disabled=!opts.click
  const top=element('div','ip-bar-row-top')
  top.append(txt('span','ip-bar-label',entry.label||entry.name),txt('strong','',format(entry.count||0)))
  const rail=element('div','ip-bar-track')
  const fill=txt('span','ip-bar-fill ip-fill-'+(entry.color||'sage'))
  fill.style.width=((entry.count||0)/max*100)+'%'
  rail.append(fill);btn.append(top,rail);list.append(btn)
 }
 if(!entries.length)list.append(muted('Sem dados disponíveis para este recorte.'))
 p.append(list);return p
}
function agingBands(model,rerender){
 return horizontal('Aging das pendências',
  'Tempo desde a criação da demanda até hoje. Clique numa faixa para abrir as tarefas.',
  [...model.aging.map(b=>({...b,label:b.label,color:b.min>=15?'warning':'sage'})),
   ...(model.unknownAging.length?[{key:'unknown',label:'Sem data verificável',count:model.unknownAging.length,color:'violet'}]:[])],
  {extra:'ip-panel-aging',limit:8,click:band=>{
   STATE.agingKey=band.key;STATE.focus='agingBand';STATE.week=null;STATE.visible=12;STATE.bucketKey='';rerender();jumpToTasks()
  }})
}
function snapshot(model,rerender){
 const banner=element('div','ip-insights')
 const intro=element('div','ip-insights-intro')
 intro.append(txt('span','ip-eyebrow','LEITURA GERENCIAL'))
 intro.append(txt('h3','','O que precisa de atenção'))
 intro.append(txt('p','','Alertas calculados com regras objetivas; não são avaliações geradas por IA.'))
 banner.append(intro)
 const cards=element('div','ip-insight-grid')
 for(const item of model.insight.slice(0,4)){
  const b=action('',()=>changeFocus(item.focus,rerender),'ip-insight ip-insight-'+item.kind)
  b.append(txt('span','ip-insight-pill',item.kind==='danger'?'Prazo':item.kind==='violet'?'Dependências':
   item.kind==='warning'?'Responsabilidade':'Aging'),txt('strong','',item.title),txt('p','',item.description),
   txt('span','ip-insight-cta','Ver demandas →'))
  cards.append(b)
 }
 banner.append(cards);return banner
}
function getFilteredRows(model){
 let selected=focusTasks(model,STATE.focus)
 if(STATE.bucketKey)selected=selected.filter(t=>t.planId+':'+(t.bucketId||'none')===STATE.bucketKey)
 if(STATE.focus==='agingBand'){
  selected=STATE.agingKey==='unknown'?model.unknownAging:
   model.aging.find(x=>x.key===STATE.agingKey)?.tasks||[]
 }
 if(STATE.focus==='weekPlanned'&&STATE.week){
  const end=addDay(STATE.week,6)
  selected=model.chosen.filter(t=>t.dueDate&&t.dueDate>=STATE.week&&t.dueDate<=end)
 }
 if(STATE.focus==='weekDone'&&STATE.week){
  const end=addDay(STATE.week,6)
  const ids=new Set(model.activity.filter(a=>a.entityType==='tasks'&&a.action==='completed'&&
   dateISO(a.timestamp)>=STATE.week&&dateISO(a.timestamp)<=end).map(a=>a.entityId))
  selected=model.chosen.filter(t=>ids.has(t.id))
 }
 const q=STATE.search.trim().toLocaleLowerCase('pt-BR')
 if(q)selected=selected.filter(t=>[
  t.title,t.description,t.team,model.planById.get(t.planId),owners(t)
 ].join(' ').toLocaleLowerCase('pt-BR').includes(q))
 return selected
}
function exportCSV(model){
 const tasks=getFilteredRows(model)
 const cols=['Demanda','Plano','Equipe','Responsáveis','Situação','Prioridade','Prazo','Criada em','Atualizada em','Aging dias']
 const escapeCSV=value=>{
  let text=String(value??'')
  if(/^[\s]*[=+\-@]/.test(text))text="'"+text
  return '"'+text.replace(/"/g,'""')+'"'
 }
 const lines=[cols,...tasks.map(t=>[
  t.title,model.planById.get(t.planId)||'',t.team||'',owners(t),status(t),priority(t),
  t.dueDate||'',dateISO(t.createdAt),dateISO(t.updatedAt),
  t.status==='done'?'':days(dateISO(t.createdAt),model.today)??''
 ])]
 const csv='\uFEFF'+lines.map(row=>row.map(escapeCSV).join(';')).join('\r\n')
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8'})
 const uri=URL.createObjectURL(blob)
 const a=document.createElement('a');a.href=uri;a.download='relatorio-planner-ipcvt.csv'
 document.body.append(a);a.click();a.remove()
 setTimeout(()=>URL.revokeObjectURL(uri),1000)
}
function taskList(model,openTask,rerender,opts={}){
 const p=box('Demandas para acompanhar',
  'Abra uma demanda para ajustar responsáveis, prazos ou dependências.','ip-action-panel')
 p.id='ip-report-actions'
 const heading=element('div','ip-task-tools')
 const options=[['all','Todas abertas'],['late','Atrasadas'],['blocked','Bloqueadas'],
  ['risk','Em atenção'],['aging14','Aging 15+'],['stale','Paradas 7+'],
  ['unassigned','Sem responsável'],['due','Próx. 7 dias']]
 const chips=element('div','ip-chipline')
 for(const [id,label] of options){
  const b=action(label,()=>changeFocus(id,rerender),'ip-chip')
  b.setAttribute('aria-pressed',String(STATE.focus===id));chips.append(b)
 }
 heading.append(chips)
 const actions=element('div','ip-task-right')
 const input=document.createElement('input');input.type='search';input.value=STATE.search
 input.placeholder='Buscar demanda...';input.setAttribute('aria-label','Buscar nas demandas filtradas')
 const exportBtn=action('Exportar CSV',()=>exportCSV(model),'ip-export')
 actions.append(input,exportBtn);heading.append(actions);p.append(heading)
 const subtitle=txt('p','ip-task-subtitle','')
 const list=element('div','ip-task-rows')
 const more=action('Mostrar mais demandas',()=>{STATE.visible+=12;draw()},'ip-more')
 function draw(){
  let items=getFilteredRows(model)
  const bucket=STATE.bucketKey?model.bucketStats.find(b=>b.key===STATE.bucketKey):null
  subtitle.textContent=(bucket?'Bucket: '+bucket.name:(titleOfFocus[STATE.focus]||'Demandas'))+
    ' · '+items.length+' resultado(s)'+(STATE.week?' · semana de '+labelDate(STATE.week):'')
  list.replaceChildren()
  if(!items.length)list.append(muted('Nenhuma demanda encontrada com os filtros atuais.'))
  for(const t of items.slice(0,STATE.visible)){
   const row=action('',()=>openTask(t),'ip-task-row')
   const left=element('span','ip-task-main')
   left.append(txt('strong','',t.title))
   left.append(txt('small','',
    (model.planById.get(t.planId)||'Sem plano')+' · '+(t.team||'Sem equipe')+
    ' · '+owners(t)))
   const right=element('span','ip-task-meta')
   const overdue=t.status!=='done'&&t.dueDate&&t.dueDate<model.today
   const age=days(dateISO(t.createdAt),model.today)
   right.append(txt('span','ip-status '+(overdue?'is-late':t.status==='done'?'is-done':''),
    overdue?'Atrasada':status(t)))
   right.append(txt('span','',t.dueDate?labelDate(t.dueDate):'Sem prazo'))
   if(t.status!=='done'&&age!==null&&age>=0)right.append(txt('span','ip-age',age+'d em aberto'))
   row.append(left,right);list.append(row)
  }
  more.hidden=items.length<=STATE.visible
 }
 input.addEventListener('input',e=>{STATE.search=e.target.value;STATE.visible=12;draw()})
 p.append(subtitle,list,more)
 draw();return p
}
function oldTasksPanel(model,openTask,rerender){
 const grid=element('div','ip-panels-2')
 grid.append(agingBands(model,rerender))
 const agingStat=box('Entendendo o aging','Dois tempos diferentes, duas decisões diferentes.','ip-panel-method')
 const rows=[
  ['Aging da demanda','Dias corridos desde a criação, para demandas ainda abertas.'],
  ['Tempo sem atualização','Dias desde a última alteração registrada na demanda; pode incluir ações automáticas.'],
  ['Atraso','Dias após a data de vencimento, apenas quando a demanda continua aberta.']
 ]
 for(const [title,subtitle] of rows){const r=element('div','ip-method-row');r.append(txt('strong','',title),txt('p','',subtitle));agingStat.append(r)}
 const measure=element('div','ip-metrics-inline')
 measure.append(element('div','',[txt('span','','Aging médio'),txt('strong','',model.avgAging===null?'—':format(model.avgAging)+' dias')]))
 measure.append(element('div','',[txt('span','','Atraso médio'),txt('strong','',model.avgDelay===null?'—':format(model.avgDelay)+' dias')]))
 agingStat.append(measure)
 grid.append(agingStat)
 return grid
}
function bottlenecks(model,openTask,rerender){
 const area=element('div','ip-panels-2')
 const buckets=model.bucketStats.slice(0,8).map(b=>({
  label:b.name,count:b.late,color:b.late?'danger':'sage',tasks:b.tasks
 }))
 area.append(horizontal('Onde os prazos mais vencem','Buckets com mais demandas atrasadas.',
  buckets,{click:bucket=>{
   STATE.focus='all';STATE.search='';STATE.tab='aging';STATE.agingKey=''
   STATE.bucketKey=bucket.tasks?.[0]?bucket.tasks[0].planId+':'+(bucket.tasks[0].bucketId||'none'):''
   STATE.visible=12;rerender();jumpToTasks()
  }}))
 const deps=box('Principais bloqueios','Demandas que impedem o avanço de outras tarefas.')
 if(!model.topBlockers.length)deps.append(muted('Nenhuma dependência pendente identificada.'))
 for(const b of model.topBlockers.slice(0,8)){
  const row=element('div','ip-blocker-row')
  const actionButton=action(b.label,()=>b.task?openTask(b.task):changeFocus('blocked',rerender),'ip-blocker-link')
  row.append(actionButton,txt('span','ip-blocker-badge',b.blocked.length+' bloqueada(s)'))
  deps.append(row)
 }
 area.append(deps)
 const revision=box('Replanejamentos','Alterações de prazo registradas no período selecionado.')
 if(!model.dueChanges.length)revision.append(muted('Nenhum reagendamento registrado neste período.'))
 for(const a of model.dueChanges.slice(0,8)){
  const row=element('div','ip-revision')
  row.append(txt('strong','',a.title||'Demanda'),txt('small','',roleDate(a)))
  const ch=a.changes.find(c=>c.field==='dueDate')
  if(ch)row.append(txt('span','',String(ch.before||'Sem prazo')+'  →  '+String(ch.after||'Sem prazo')))
  const t=model.chosen.find(t=>t.id===a.entityId)
  if(t)row.append(action('Abrir',()=>openTask(t),'ip-inline'))
  revision.append(row)
 }
 area.append(revision)
 area.append(horizontal('Carga em aberto por equipe','Quantidade de demandas pendentes.',
  model.teams.map(x=>({label:x.name,count:x.open,color:'sage'})),
  {click:x=>{STATE.team=x.label==='Sem equipe'?'Sem equipe':x.label;STATE.focus='all';STATE.bucketKey='';rerender()}}))
 return area
}
function teamSection(model,rerender){
 const area=element('div','ip-team-layout')
 const teams=box('Painel por equipe','Clique em uma equipe para filtrar todos os indicadores.')
 const viewport=element('div','ip-table-scroll')
 const table=element('table','ip-team-table')
 const head=element('thead')
 const tr=element('tr')
 for(const h of ['Equipe','Em aberto','Atrasadas','Bloqueadas','Sem dono','Aging médio']){
  tr.append(txt('th','',h))
 }
 head.append(tr);table.append(head)
 const body=element('tbody')
 for(const t of model.teams){
  const line=element('tr')
  const n=element('td')
  n.append(action(t.name,()=>{STATE.team=t.name;STATE.focus='all';rerender()},'ip-team-link'))
  line.append(n)
  for(const value of [t.open,t.late,t.blocked,t.unassigned,t.aging===null?'—':format(t.aging)+'d'])line.append(txt('td','',value))
  body.append(line)
 }
 if(!model.teams.length){const line=element('tr');const td=txt('td','','Sem equipes com demandas neste recorte.');td.colSpan=6;line.append(td);body.append(line)}
 table.append(body);viewport.append(table);teams.append(viewport);area.append(teams)
 const ownersChart=horizontal('Distribuição da carga','Demandas abertas por pessoa. Uma tarefa pode ter mais de um responsável.',
  model.owners.slice(0,12).map(o=>({label:o.name,count:o.count,color:'sage'})),
  {limit:12,click:o=>{
   STATE.focus='all';STATE.search=o.label;STATE.tab='teams';rerender()
  }})
 area.append(ownersChart)
 const pressure=box('Onde estão os maiores riscos','Comparação das equipes que têm demandas em aberto.')
 const minMax=Math.max(1,...model.teams.map(e=>e.open))
 for(const item of model.teams.slice(0,10)){
  const r=element('div','ip-pressure')
  r.append(txt('strong','',item.name))
  const chart=element('div','ip-pressure-track')
  const good=txt('span','ip-pressure-good');good.style.width=(Math.max(0,item.open-item.late)/minMax*100)+'%'
  const bad=txt('span','ip-pressure-bad');bad.style.width=(item.late/minMax*100)+'%'
  chart.append(good,bad)
  r.append(chart,txt('small','',item.late+' atrasadas / '+item.open+' abertas'))
  pressure.append(r)
 }
 if(!model.teams.length)pressure.append(muted('Sem equipes neste recorte.'))
 area.append(pressure)
 const note=box('Como interpretar','Comparar equipes exige considerar a complexidade e o tipo de trabalho.')
 note.append(txt('p','ip-note','Carga e aging mostram distribuição e acúmulo de demandas. Não são notas de desempenho individual.'))
 note.append(txt('p','ip-note','Aging alto pede revisão do escopo, prazo e responsáveis. Atrasos recorrentes podem indicar capacidade insuficiente ou dependências externas.'))
 area.append(note)
 return area
}
function formatChange(value){
 if(value===null||value===undefined||value==='')return 'Vazio'
 if(typeof value==='string')return value.length>130?value.slice(0,127)+'…':value
 if(Array.isArray(value))return value.map(x=>typeof x==='object'?(x.name||x.text||x.email||'Item'):String(x)).join(', ').slice(0,130)
 return String(value)
}
function historySection(model,activityState,activityError,openTask){
 const p=box('Linha do tempo de alterações','Quem fez o quê, quando, e o que mudou.')
 if(activityState==='error')p.append(txt('p','ip-warning',
  'Histórico indisponível: '+(activityError||'o Firestore não autorizou a leitura')+
  '. Verifique as regras de acesso do histórico.'))
 if(activityState==='loading')p.append(muted('Consultando alterações do Firestore…'))
 const toolbar=element('div','ip-history-tools')
 const search=document.createElement('input');search.type='search';search.placeholder='Pesquisar pessoa ou demanda'
 search.value=STATE.historySearch;search.setAttribute('aria-label','Pesquisar no histórico')
 toolbar.append(search)
 const select=makeSelect('Tipo de ação',[['all','Todas as ações'],...Object.entries(ACTIONS).map(([k,v])=>[k,v])],
  STATE.historyAction,x=>{STATE.historyAction=x;draw()})
 toolbar.append(select);p.append(toolbar)
 const list=element('div','ip-timeline')
 const summary=txt('p','ip-task-subtitle','')
 function draw(){
  list.replaceChildren()
  const query=STATE.historySearch.trim().toLocaleLowerCase('pt-BR')
  const events=model.activity.filter(item=>
    (STATE.historyAction==='all'||STATE.historyAction===item.action)&&
    [item.actor,item.title,item.action,...(item.changes||[]).map(x=>x.field)].join(' ').toLocaleLowerCase('pt-BR').includes(query)
  )
  summary.textContent=events.length+' ocorrência(s) no período'
  if(!events.length)list.append(muted('Nenhuma alteração registrada para os filtros selecionados.'))
  for(const evt of events.slice(0,100)){
   const row=element('article','ip-timeline-item')
   row.append(txt('span','ip-timeline-dot'))
   const body=element('div','ip-timeline-main')
   const meta=element('div','ip-timeline-meta')
   meta.append(txt('strong','',evt.origin==='automatic'?'Automação na sessão de '+(evt.actor||'usuário'):evt.actor||'Sistema'))
   meta.append(txt('span','ip-activity-badge',ACTIONS[evt.action]||'Alterou'),txt('time','',roleDate(evt)))
   body.append(meta)
   const t=model.chosen.find(x=>x.id===evt.entityId&&evt.entityType==='tasks')
   if(t)body.append(action(evt.title||t.title,()=>openTask(t),'ip-timeline-title'))
   else body.append(txt('p','ip-timeline-title',evt.title||evt.entityId||'Registro'))
   for(const change of (evt.changes||[]).slice(0,7)){
    const detail=element('div','ip-change')
    detail.append(txt('span','',FIELD[change.field]||change.field))
    if(evt.action!=='created')detail.append(txt('del','',formatChange(change.before)))
    detail.append(txt('strong','',formatChange(change.after)))
    body.append(detail)
   }
   row.append(body);list.append(row)
  }
  if(events.length>100)list.append(muted('Exibindo as 100 alterações mais recentes deste filtro.'))
 }
 search.addEventListener('input',e=>{STATE.historySearch=e.target.value;draw()})
 p.append(summary,list)
 draw()
 p.append(txt('p','ip-annotation',
  'O histórico não é retroativo. Esta listagem depende das permissões do Firestore e das últimas 500 atividades sincronizadas.'))
 return p
}
function glossary(){
 const details=element('details','ip-guide')
 details.append(txt('summary','','Como são calculados os indicadores?'))
 const article=element('div','ip-guide-body')
 const items=[
  ['Aging','Dias corridos desde a criação de uma demanda ainda aberta. O indicador médio exclui registros sem data de criação verificável.'],
  ['Paradas 7+','Demandas abertas sem atualização em pelo menos sete dias. O horário de atualização pode incluir ações automáticas.'],
  ['Em atenção','Prazo nos próximos sete dias, sem atraso nem bloqueio, e com um sinal objetivo: não iniciada, prioridade alta/urgente, sem responsável ou sem atualização recente.'],
  ['Bloqueadas','Demandas abertas cuja dependência ainda não foi concluída ou não foi encontrada. Uma tarefa atrasada e bloqueada aparece apenas como atrasada no gráfico de saúde.'],
  ['Entrega no prazo','Somente demandas concluídas com data de conclusão registrada e prazo conhecido no momento da conclusão entram no percentual.'],
  ['Fluxo semanal','Prazos usam as datas atuais das demandas. Conclusões usam somente eventos de histórico. Os dois números não medem necessariamente a mesma população.'],
  ['Período','O seletor de período afeta a movimentação e o histórico; os indicadores de carteira, aging e gargalos mostram a situação atual de todas as demandas filtradas.']
 ]
 for(const [title,description] of items)article.append(element('div','',[txt('strong','',title),txt('p','',description)]))
 details.append(article);return details
}
export function renderPlannerDashboard({
 content,tasks,plans,buckets,activities,activityState='loading',activityError='',today,openTask,rerender
}){
 const activePlans=(plans||[]).filter(p=>!p.deleted)
 const availableTeams=[...new Set((tasks||[]).filter(t=>t&&!t.deleted&&t.title).map(t=>t.team||'Sem equipe'))].sort((a,b)=>a.localeCompare(b,'pt-BR'))
 if(STATE.planId&&!activePlans.some(p=>p.id===STATE.planId))STATE.planId=''
 if(STATE.team&&!availableTeams.includes(STATE.team))STATE.team=''
 const model=buildReportModel({tasks,plans:activePlans,buckets,activities,today,
  planId:STATE.planId,team:STATE.team,period:STATE.period})
 const root=element('div','ip-report')
 root.setAttribute('aria-label','Relatórios gerenciais do Planner IPCVT')
 const hero=element('header','ip-hero')
 const heading=element('div','ip-hero-title')
 heading.append(txt('span','ip-eyebrow','INTELIGÊNCIA OPERACIONAL · IPCVT'))
 heading.append(txt('h2','','Painel de desempenho'))
 heading.append(txt('p','','Um retrato claro dos prazos, da carga de trabalho e dos pontos de atenção.'))
 const filters=element('div','ip-filters')
 filters.append(makeSelect('Atividades',[['7','7 dias'],['30','30 dias'],['90','90 dias'],['all','Todo o histórico']],
  STATE.period,x=>{STATE.period=x;rerender()}))
 filters.append(makeSelect('Plano',[['','Todos os planos'],...activePlans.map(p=>[p.id,p.name])],
  STATE.planId,x=>{STATE.planId=x;STATE.focus='all';STATE.search='';STATE.week=null;STATE.bucketKey='';rerender()}))
 filters.append(makeSelect('Equipe',[['','Todas as equipes'],...availableTeams.map(t=>[t,t])],
  STATE.team,x=>{STATE.team=x;STATE.focus='all';STATE.search='';STATE.week=null;STATE.bucketKey='';rerender()}))
 const reset=action('Limpar filtros',()=>{
  STATE.planId='';STATE.team='';STATE.period='30';STATE.focus='all';STATE.agingKey=''
  STATE.week=null;STATE.search='';STATE.bucketKey='';rerender()
 },'ip-reset')
 filters.append(reset);hero.append(heading,filters);root.append(hero)
 const tabs=element('nav','ip-tabs');tabs.setAttribute('aria-label','Seções dos relatórios')
 for(const [id,label] of TAB){
  const b=action(label,()=>{STATE.tab=id;STATE.week=null;STATE.focus='all';STATE.search='';STATE.bucketKey='';STATE.visible=12;rerender()},'ip-tab')
  b.setAttribute('aria-current',STATE.tab===id?'page':'false');tabs.append(b)
 }
 root.append(tabs)
 const label=element('div','ip-section-label')
 label.append(txt('strong','','PANORAMA ATUAL'))
 label.append(txt('span','','Carteira em tempo real · Período selecionado filtra entregas e alterações.'))
 root.append(label)
 const kpis=element('section','ip-kpis')
 kpis.append(
  kpi('Em aberto',format(model.openTotal),'Demandas pendentes','neutral',
   'Total de demandas não concluídas, independentemente da data de criação.',()=>changeFocus('all',rerender)),
  kpi('Atrasadas',format(model.late.length),
   model.avgDelay===null?'Sem atrasos':(pct(model.late.length,model.openTotal)||0)+'% das abertas · '+format(model.avgDelay)+'d em média','danger',
   'Abertas com prazo anterior a hoje.',()=>changeFocus('late',rerender)),
  kpi('Bloqueadas',format(model.blocked.length),'Dependências pendentes','violet',
   'Abertas que dependem de outras demandas não concluídas.',()=>changeFocus('blocked',rerender)),
  kpi('Em atenção',format(model.risk.length),'Prazo até 7 dias','warning',
   'Sinais objetivos de risco em tarefas com prazo próximo, excluindo atrasadas e bloqueadas.',()=>changeFocus('risk',rerender)),
  kpi('Aging médio',model.avgAging===null?'—':format(model.avgAging)+'d',
   format(model.over14.length)+' acima de 14 dias','teal',
   'Tempo médio em dias desde a criação das demandas ainda abertas, quando a data é conhecida.',
   ()=>{STATE.tab='aging';changeFocus('aging14',rerender)}),
  kpi('Sem atualização',format(model.stale.length),'Há 7 dias ou mais','neutral',
   'Última alteração de demanda há pelo menos sete dias.',()=>changeFocus('stale',rerender)),
  kpi('Concluídas',activityState==='loaded'?format(model.recentCompletions.length):'—',
   activityState==='loaded'?'Registros no período':'Aguardando histórico','done',
   'Eventos de conclusão efetivamente gravados no histórico durante o período selecionado.',
   ()=>{STATE.tab='history';rerender()}),
  kpi('No prazo',activityState==='loaded'&&model.proven.length?format(model.onTimePercent)+'%':'—',
   format(model.proven.length)+' conclusão(ões) auditáveis','done',
   'Percentual apenas da amostra com data real de conclusão e prazo verificável.',
   ()=>{STATE.tab='history';rerender()})
 )
 root.append(kpis)
 if(activityState==='error')root.append(txt('p','ip-warning',
  'Indicadores históricos indisponíveis: '+(activityError||'não foi possível consultar o histórico do Firestore')+
  '. Os indicadores da carteira continuam disponíveis.'))
 if(STATE.tab==='overview'){
  root.append(snapshot(model,rerender))
  const grid=element('div','ip-panels-2')
  grid.append(donut(model,rerender),weekly(model,rerender,activityState==='loaded'))
  root.append(grid)
  root.append(oldTasksPanel(model,openTask,rerender))
  root.append(taskList(model,openTask,rerender))
 } else if(STATE.tab==='aging'){
  root.append(element('div','ip-aging-lead',[
   txt('strong','','Aging mostra há quanto tempo cada demanda está aberta.'),
   txt('span','','Atraso, por outro lado, só existe quando um prazo já venceu. Use os dois para identificar gargalos reais.')
  ]))
  root.append(oldTasksPanel(model,openTask,rerender))
  root.append(bottlenecks(model,openTask,rerender))
  root.append(taskList(model,openTask,rerender))
 } else if(STATE.tab==='teams'){
  root.append(teamSection(model,rerender))
  root.append(taskList(model,openTask,rerender))
 } else {
  root.append(historySection(model,activityState,activityError,openTask))
 }
 root.append(glossary())
 content.append(root)
}
