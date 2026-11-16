/* Relatórios e atividade do Planner IPCVT.
 * Sem dados fictícios; todas as métricas usam os registros autorizados do Planner.
 */
let tab = 'overview'
let period = '30'
let planId = ''
let teamName = ''
let historyQuery = ''
const statusLabels = {todo:'Não iniciada',doing:'Em andamento',done:'Concluída'}
const fieldLabels = {
  title:'Título',name:'Nome',description:'Descrição',status:'Situação',dueDate:'Prazo',
  startDate:'Início',priority:'Prioridade',assignees:'Responsáveis',team:'Equipe',
  bucketId:'Bucket',planId:'Plano',dependencyIds:'Dependências',checklist:'Checklist',
  eventId:'Evento-alvo',kind:'Tipo de plano',deleted:'Arquivamento',order:'Ordem',
  recurrence:'Recorrência',reviewRequired:'Revisão',reviewReason:'Motivo da revisão',
  source:'Fonte',active:'Ativo'
}
const actions = {
  created:'criou',updated:'editou',completed:'concluiu',reopened:'reabriu',
  deleted:'excluiu',archived:'arquivou'
}
const $el = (tag,cls='',value='')=>{
  const e=document.createElement(tag)
  if(cls)e.className=cls
  if(value!==undefined && value!==null && value!=='')e.textContent=String(value)
  return e
}
const fullDate=(value)=>{
  if(!value)return 'Sem prazo'
  const [y,m,d]=String(value).split('-')
  return (d&&m&&y)?[d,m,y].join('/'):'Data inválida'
}
function stampDate(stamp){
  if(!stamp)return null
  if(typeof stamp.toDate==='function')return stamp.toDate()
  if(typeof stamp.seconds==='number')return new Date(stamp.seconds*1000)
  if(stamp instanceof Date)return stamp
  const date=new Date(stamp)
  return Number.isFinite(date.getTime())?date:null
}
function dateLabel(stamp){
  const d=stampDate(stamp)
  return d&&Number.isFinite(d.getTime())
    ?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(d)
    :'Horário indisponível'
}
function isoOf(stamp){
  const d=stampDate(stamp)
  if(!d||!Number.isFinite(d.getTime()))return ''
  return new Intl.DateTimeFormat('sv-SE',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'America/Sao_Paulo'}).format(d)
}
function compact(value){
  if(value===null||value===undefined||value==='')return 'Vazio'
  if(typeof value==='boolean')return value?'Sim':'Não'
  if(typeof value==='string')return value.length>180?value.slice(0,177)+'…':value
  if(Array.isArray(value)){
    const all=value.map(item=>item && typeof item==='object'
      ?(item.name||item.text||item.email||item.title||item.id||'Item')
      :String(item))
    return all.join(', ').slice(0,180)||'Vazio'
  }
  return String(value).slice(0,180)
}
function panel(heading){
  const section=$el('section','pm-report-card')
  section.append($el('h3','',heading))
  return section
}
function note(text){return $el('p','pm-report-note',text)}
function muted(text){return $el('p','pm-report-muted',text)}
function sameDateOrEarlier(a,b){return a && b && a<=b}
function daysBetween(a,b){
  const ms=Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z')
  return Number.isFinite(ms)?Math.round(ms/86400000):0
}
function chart(title,entries,onSelect,showZeros=false){
  const section=panel(title)
  const valid=entries.filter(([name,n])=>name && (showZeros||n>0))
    .sort(showZeros?()=>0:(a,b)=>b[1]-a[1]).slice(0,12)
  if(!valid.length){section.append(muted('Sem dados para este recorte.'));return section}
  const bars=$el('div','pm-report-bars'),max=Math.max(...valid.map(v=>v[1]),1)
  valid.forEach(([name,count])=>{
    const row=$el('div','pm-report-row')
    const label=$el('button','',name);label.type='button'
    label.addEventListener('click',()=>onSelect?.(name))
    const track=$el('div','pm-report-bar')
    const fill=$el('span')
    fill.style.width=Math.max(0,Math.min(100,count/max*100))+'%'
    track.append(fill)
    row.append(label,track,$el('strong','',count))
    bars.append(row)
  })
  section.append(bars)
  return section
}
function statsCard(label,value,desc,click){
  const e=$el(click?'button':'article','pm-report-stat')
  if(click){e.type='button';e.addEventListener('click',click)}
  e.append($el('span','',label),$el('strong','',value),$el('small','',desc))
  return e
}
function showTasks(section,tasks,openTask,plans,limit=14){
  if(!tasks.length){section.append(muted('Nenhuma demanda encontrada.'));return}
  const box=$el('div','pm-report-list')
  tasks.slice(0,limit).forEach(task=>{
    const row=$el('div')
    const button=$el('button','',task.title||'Demanda')
    button.type='button';button.addEventListener('click',()=>openTask(task))
    const name=plans.find(p=>p.id===task.planId)?.name||'Sem plano'
    const detail=(task.dueDate?fullDate(task.dueDate):'Sem prazo')+' · '+name
    row.append(button,$el('small','',detail));box.append(row)
  })
  section.append(box)
  if(tasks.length>limit)section.append(muted('Exibindo as primeiras '+limit+' de '+tasks.length+' demandas.'))
}
function activityEntry(item){
  const line=$el('article','pm-report-entry')
  line.append($el('span','pm-report-dot'))
  const body=$el('div')
  const actor=item.origin==='automatic'
    ?'Geração automática (sessão de '+(item.actor||'usuário')+')'
    :(item.actor||'Sistema')
  const verb=actions[item.action]||'alterou'
  body.append($el('strong','',actor+' '+verb+' '+(item.entityType==='tasks'?'a demanda':item.entityType==='plans'?'o plano':item.entityType==='buckets'?'o bucket':'o registro')))
  body.append($el('p','',item.title||item.entityId||'Registro'))
  body.append($el('small','',dateLabel(item.timestamp)))
  for(const change of (Array.isArray(item.changes)?item.changes:[]).slice(0,8)){
    const row=$el('div','pm-report-change')
    row.append($el('span','',(fieldLabels[change.field]||change.field)+': '))
    if(item.action!=='created')row.append($el('em','',compact(change.before)))
    if(item.action!=='created')row.append($el('span','','→'))
    row.append($el('b','',compact(change.after)))
    body.append(row)
  }
  line.append(body)
  return line
}
export function renderTaskActivity(target,task,activity,activityState='loading'){
  target.replaceChildren()
  if(!task){target.hidden=true;return}
  target.hidden=false
  const title=$el('summary','','Histórico de alterações')
  target.append(title)
  const items=(activity||[]).filter(item=>item.entityType==='tasks'&&item.entityId===task.id)
  if(activityState==='error')target.append(muted('Histórico indisponível. É necessário autorizar a leitura da coleção de atividades no Firestore.'))
  else if(!items.length)target.append(muted(activityState==='loading'?'Consultando histórico…':'Nenhuma alteração registrada desde a ativação do histórico.'))
  else target.append(...items.slice(0,30).map(activityEntry))
}
export function renderPlannerReports({
  content,tasks,plans,buckets,activities,activityState,activityError,today,openTask,rerender
}){
  const allTasks=(tasks||[]).filter(t=>t&&!t.deleted&&!String(t.id||'').startsWith('rotation_v1_')&&!String(t.id||'').startsWith('plan_cycle_v1_'))
  const activePlans=(plans||[]).filter(p=>p&&!p.deleted)
  const root=$el('section','pm-report-shell')
  const heading=$el('header','pm-report-heading')
  const title=$el('div')
  title.append($el('span','pm-report-eyebrow','GESTÃO DE PLANOS E DEMANDAS'),$el('h2','','Relatórios'))
  const filters=$el('div','pm-report-filters')
  function selector(label,choices,current,change){
    const wrap=$el('label');wrap.append($el('span','',label))
    const select=$el('select')
    for(const [value,text] of choices){const opt=$el('option','',text);opt.value=value;select.append(opt)}
    select.value=current
    select.addEventListener('change',e=>{change(e.target.value);rerender()})
    wrap.append(select);return wrap
  }
  const teams=[...new Set(allTasks.map(t=>t.team||'Sem equipe'))].sort((a,b)=>a.localeCompare(b,'pt-BR'))
  filters.append(
    selector('Período',[['7','7 dias'],['30','30 dias'],['90','90 dias'],['all','Todo o histórico']],period,x=>period=x),
    selector('Plano',[['','Todos os planos'],...activePlans.map(p=>[p.id,p.name])],planId,x=>planId=x),
    selector('Equipe',[['','Todas as equipes'],...teams.map(t=>[t,t])],teamName,x=>teamName=x)
  )
  heading.append(title,filters);root.append(heading)
  const nav=$el('nav','pm-report-tabs')
  const tabs=[['overview','Visão geral'],['bottlenecks','Gargalos'],['teams','Equipes'],['history','Histórico']]
  for(const [key,name] of tabs){
    const b=$el('button','',name);b.type='button';b.setAttribute('aria-pressed',String(tab===key))
    b.addEventListener('click',()=>{tab=key;rerender()});nav.append(b)
  }
  root.append(nav)
  const first=period==='all'?'':new Date(Date.parse(today+'T12:00:00Z')-(Number(period)-1)*86400000).toISOString().slice(0,10)
  const filtered=allTasks.filter(task=>{
    if(planId&&task.planId!==planId)return false
    if(teamName&&(task.team||'Sem equipe')!==teamName)return false
    if(!first)return true
    const created=isoOf(task.createdAt)
    // Mantém pendências de períodos anteriores, sem esconder atrasos persistentes.
    return (task.dueDate&&task.dueDate>=first&&task.dueDate<=today)
      || (task.dueDate&&task.dueDate<first&&task.status!=='done')
      || (!task.dueDate&&created>=first&&created<=today)
      || (task.dueDate&&task.dueDate>today&&task.dueDate<=new Date(Date.parse(today+'T12:00:00Z')+7*86400000).toISOString().slice(0,10))
  })
  const byId=new Map(allTasks.map(t=>[t.id,t]))
  const overdue=filtered.filter(t=>t.status!=='done'&&t.dueDate&&t.dueDate<today)
  const done=filtered.filter(t=>t.status==='done')
  const next7=new Date(Date.parse(today+'T12:00:00Z')+7*86400000).toISOString().slice(0,10)
  const soon=filtered.filter(t=>t.status!=='done'&&t.dueDate&&t.dueDate>=today&&t.dueDate<=next7)
  const blocked=filtered.filter(t=>t.status!=='done'&&(t.dependencyIds||[]).some(id=>!byId.get(id)||byId.get(id).status!=='done'))
  const unassigned=filtered.filter(t=>t.status!=='done'&&!(t.assignees||[]).length)
  const pending=filtered.filter(t=>t.status!=='done')
  const recent=(activities||[]).filter(a=>(!planId||a.planId===planId)&&(!teamName||a.team===teamName)&&(!first||isoOf(a.timestamp)>=first))
  const byTaskCompleted=new Map()
  for(const item of (activities||[])){
    if(item.entityType==='tasks'&&item.action==='completed'&&!byTaskCompleted.has(item.entityId))byTaskCompleted.set(item.entityId,item)
  }
  const risks=soon.filter(t=>t.status==='todo'||blocked.includes(t)||['high','urgent'].includes(t.priority))
  const provable=done.filter(t=>byTaskCompleted.has(t.id)&&byTaskCompleted.get(t.id).dueDate)
  const onTime=provable.filter(t=>sameDateOrEarlier(isoOf(byTaskCompleted.get(t.id).timestamp),byTaskCompleted.get(t.id).dueDate))
  const top=$el('section','pm-report-stats')
  top.append(
    statsCard('Demandas',filtered.length,'No recorte selecionado'),
    statsCard('Concluídas',done.length,'Situação atual'),
    statsCard('Atrasadas',overdue.length,'Prazo vencido',()=>{tab='bottlenecks';rerender()}),
    statsCard('Próximos 7 dias',soon.length,'Entregas pendentes',()=>{tab='bottlenecks';rerender()}),
    statsCard('Bloqueadas',blocked.length,'Dependências pendentes',()=>{tab='bottlenecks';rerender()}),
    statsCard('Em risco',risks.length,'Vencendo sem segurança',()=>{tab='bottlenecks';rerender()}),
    statsCard('Sem responsável',unassigned.length,'Pendências sem atribuição',()=>{tab='teams';rerender()})
  )
  root.append(top)
  if(tab==='overview'){
    const overview=$el('div','pm-report-panels')
    overview.append(chart('Andamento das demandas',Object.entries({
      'Não iniciadas':filtered.filter(t=>t.status==='todo').length,
      'Em andamento':filtered.filter(t=>t.status==='doing').length,'Concluídas':done.length
    }),null))
    const priorityEntries=[['Urgente',0],['Alta',0],['Normal',0],['Baixa',0]]
    const labelMap={urgent:'Urgente',high:'Alta',normal:'Normal',low:'Baixa'}
    for(const task of pending)priorityEntries.find(x=>x[0]===(labelMap[task.priority]||'Normal'))[1]++
    overview.append(chart('Pendências por prioridade',priorityEntries))
    const teamCounts=new Map()
    for(const task of filtered)teamCounts.set(task.team||'Sem equipe',(teamCounts.get(task.team||'Sem equipe')||0)+1)
    overview.append(chart('Demandas por equipe',[...teamCounts]))
    const planCounts=new Map()
    for(const task of filtered){
      const p=activePlans.find(p=>p.id===task.planId)?.name||'Sem plano'
      planCounts.set(p,(planCounts.get(p)||0)+1)
    }
    overview.append(chart('Volume por plano',[...planCounts]))
    // Séries baseadas em conclusões efetivamente registradas, nunca em datas presumidas.
    const mondayOf=iso=>{
      const date=new Date(iso+'T12:00:00Z')
      const dow=(date.getUTCDay()+6)%7
      date.setUTCDate(date.getUTCDate()-dow)
      return date.toISOString().slice(0,10)
    }
    const currentMonday=mondayOf(today)
    const weeks=Array.from({length:8},(_,i)=>{
      const key=new Date(Date.parse(currentMonday+'T12:00:00Z')-(7-i)*7*86400000).toISOString().slice(0,10)
      return [key,0]
    })
    const byWeek=new Map(weeks)
    for(const item of (activities||[]))if(item.entityType==='tasks'&&item.action==='completed'){
      const day=isoOf(item.timestamp),week=day&&mondayOf(day)
      if(byWeek.has(week))byWeek.set(week,byWeek.get(week)+1)
    }
    overview.append(chart('Conclusões registradas por semana',weeks.map(([d])=>[fullDate(d).slice(0,5),byWeek.get(d)]),null,true))
    root.append(overview)
    const durations=done.map(t=>{
      const created=isoOf(t.createdAt),completed=isoOf(byTaskCompleted.get(t.id)?.timestamp)
      return created&&completed&&completed>=created?daysBetween(created,completed):null
    }).filter(days=>days!==null)
    const mean=durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length*10)/10:null
    root.append(note((mean===null
      ?'Tempo médio de conclusão: aguardando registros históricos suficientes.'
      :'Tempo médio de conclusão: '+mean.toLocaleString('pt-BR')+' dia(s), calculado em '+durations.length+' demanda(s) com datas verificáveis.')
      +' As conclusões por semana consideram somente eventos registrados no histórico.'))
    root.append(note(provable.length
      ?'Entregas no prazo com data auditável: '+onTime.length+' de '+provable.length+' ('+Math.round(onTime.length/provable.length*100)+'%). Demandas antigas sem registro de conclusão não entram nessa taxa.'
      :'A taxa histórica de entregas no prazo ficará disponível à medida que novas conclusões forem registradas. Não é possível reconstruí-la com segurança só pelo status atual.'))
  }
  if(tab==='bottlenecks'){
    const grid=$el('div','pm-report-panels')
    const critical=panel('Dependências que bloqueiam entregas')
    showTasks(critical,blocked.sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')),openTask,activePlans)
    grid.append(critical)
    const sources=new Map()
    for(const t of blocked)for(const depId of t.dependencyIds||[]){
      const other=byId.get(depId)
      if(other?.status==='done')continue
      const label=other?.title||'Dependência ausente'
      sources.set(label,(sources.get(label)||0)+1)
    }
    grid.append(chart('Demandas que mais bloqueiam outras',[...sources].map(([name,count])=>[name,count])))
    const delayed=panel('Atrasos que precisam de atenção')
    showTasks(delayed,overdue.sort((a,b)=>a.dueDate.localeCompare(b.dueDate)),openTask,activePlans)
    grid.append(delayed)
    const atRisk=panel('Demandas em risco nesta semana')
    showTasks(atRisk,risks.sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')),openTask,activePlans)
    grid.append(atRisk)
    const idle=panel('Demandas sem atualização há mais de 7 dias')
    const stale=pending.filter(t=>{const d=isoOf(t.updatedAt);return d&&daysBetween(d,today)>=7}).sort((a,b)=>isoOf(a.updatedAt).localeCompare(isoOf(b.updatedAt)))
    showTasks(idle,stale,openTask,activePlans)
    grid.append(idle)
    const changed=panel('Prazos alterados no período')
    const changes=recent.filter(item=>item.entityType==='tasks'&&item.changes?.some(c=>c.field==='dueDate'))
    const names=changes.slice(0,15)
    if(!names.length)changed.append(muted('Nenhum reagendamento registrado neste período.'))
    else for(const e of names)changed.append(activityEntry(e))
    grid.append(changed)
    root.append(grid)
    root.append(note('Uma demanda bloqueada depende de outra ainda não concluída. A lista de tarefas paradas usa a última alteração registrada, não uma medição direta do esforço realizado.'))
  }
  if(tab==='teams'){
    const grid=$el('div','pm-report-panels')
    const teamBox=panel('Situação por equipe')
    const teamsSummary=new Map()
    for(const t of filtered){
      const name=t.team||'Sem equipe',rec=teamsSummary.get(name)||{all:0,done:0,overdue:0}
      rec.all++
      if(t.status==='done')rec.done++
      if(t.status!=='done'&&t.dueDate&&t.dueDate<today)rec.overdue++
      teamsSummary.set(name,rec)
    }
    const teamTable=$el('div','pm-report-table-wrap')
    const table=$el('table','pm-report-table')
    const th=$el('tr');['Equipe','Demandas','Concluídas','Atrasadas'].forEach(t=>th.append($el('th','',t)))
    const thead=$el('thead');thead.append(th);table.append(thead)
    const tbody=$el('tbody')
    ;[...teamsSummary].sort((a,b)=>b[1].overdue-a[1].overdue).forEach(([name,row])=>{
      const tr=$el('tr')
      ;[name,row.all,row.done,row.overdue].forEach(value=>tr.append($el('td','',value)))
      tbody.append(tr)
    })
    table.append(tbody);teamTable.append(table);teamBox.append(teamTable)
    grid.append(teamBox)
    const workload=new Map()
    for(const t of pending)for(const person of t.assignees||[]){
      const name=person.name||person.email||'Responsável'
      const r=workload.get(name)||{all:0,late:0}
      r.all++;if(t.dueDate&&t.dueDate<today)r.late++
      workload.set(name,r)
    }
    grid.append(chart('Demandas em aberto por responsável',[...workload].map(([name,r])=>[name,r.all])))
    const responsibility=panel('Distribuição de trabalho')
    responsibility.append(muted('Os volumes indicam carga operacional, não são um ranking de desempenho individual. Uma demanda pode ter mais de um responsável.'))
    showTasks(responsibility,unassigned,openTask,activePlans)
    grid.append(responsibility)
    const bucketCounts=new Map()
    for(const t of pending){
      const b=(buckets||[]).find(b=>b.id===t.bucketId)
      const name=b?.name||'Sem bucket'
      bucketCounts.set(name,(bucketCounts.get(name)||0)+1)
    }
    grid.append(chart('Pendências acumuladas por bucket',[...bucketCounts]))
    root.append(grid)
  }
  if(tab==='history'){
    const heading=panel('Atividades e modificações')
    if(activityState==='error')heading.append(note('Não foi possível ler o histórico do Firestore: '+(activityError||'acesso não autorizado')+'. A coordenação deve liberar a coleção de atividades.'))
    else if(activityState==='loading')heading.append(muted('Consultando atividades registradas…'))
    else {
      const input=$el('input');input.type='search';input.placeholder='Buscar responsável, demanda ou alteração';input.value=historyQuery
      input.setAttribute('aria-label','Buscar atividades no histórico')
      input.style.cssText='width:100%;min-height:38px;border:1px solid #cfdfd1;border-radius:7px;padding:9px 12px;background:transparent;color:inherit'
      input.addEventListener('input',e=>{
        historyQuery=e.target.value
        const q=historyQuery.trim().toLocaleLowerCase('pt-BR')
        const list=heading.querySelector('.pm-report-history');list.replaceChildren()
        const items=recent.filter(item=>[item.actor,item.title,item.action,...(item.changes||[]).map(x=>x.field)].join(' ').toLocaleLowerCase('pt-BR').includes(q))
        if(!items.length)list.append(muted('Nenhum registro encontrado.'))
        else list.append(...items.slice(0,120).map(activityEntry))
      })
      heading.append(input)
      const list=$el('div','pm-report-history')
      const q=historyQuery.trim().toLocaleLowerCase('pt-BR')
      const found=recent.filter(item=>[item.actor,item.title,item.action,...(item.changes||[]).map(x=>x.field)].join(' ').toLocaleLowerCase('pt-BR').includes(q))
      if(found.length)list.append(...found.slice(0,120).map(activityEntry))
      else list.append(muted('Nenhuma atividade registrada para este recorte.'))
      heading.append(list)
    }
    root.append(heading)
    root.append(note('O histórico começa na ativação desta função. Registros anteriores só oferecem autor e data da última alteração. São exibidas até 500 atividades recentes, sujeitas às permissões do Firestore.'))
  }
  content.append(root)
}
