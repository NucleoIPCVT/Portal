/* Gantt premium IPCVT: apresentação somente-leitura, sem mutação das tarefas. */
const viewState = {
  mode:'focus', focusId:'', selectedIds:null, zoom:'weeks',
  cursor:'', collapsedPlans:new Set(), collapsedBuckets:new Set(),
  expandedSeries:new Set(), groupRecurrences:true, showAllLinks:false,
  selectedTaskId:'', portfolioInitialized:false, cycleOnly:true, cycleFocusPlan:''
}
let drawCurrent=null
if(typeof window!=='undefined')window.addEventListener('resize',()=>drawCurrent?.())

const dateOk=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)
const parseDate=value=>new Date(value+'T12:00:00Z')
const add=(value,days)=>{
  const date=parseDate(value)
  date.setUTCDate(date.getUTCDate()+days)
  return date.toISOString().slice(0,10)
}
const diff=(a,b)=>Math.round((parseDate(b)-parseDate(a))/86400000)
const monday=date=>add(date,-((parseDate(date).getUTCDay()+6)%7))
const dateLabel=(date,options={day:'2-digit',month:'short'})=>
  new Intl.DateTimeFormat('pt-BR',{timeZone:'UTC',...options}).format(parseDate(date))
const element=(tag,cls='',text='')=>{
  const node=document.createElement(tag)
  if(cls)node.className=cls
  if(text!==null)node.textContent=String(text)
  return node
}
const control=(label,callback,cls='pg-button')=>{
  const button=element('button',cls,label)
  button.type='button'
  button.addEventListener('click',callback)
  return button
}
const fromTask=task=>dateOk(task.startDate)?task.startDate:task.dueDate
const toTask=task=>dateOk(task.dueDate)?task.dueDate:task.startDate
function taskRange(task){
  const a=fromTask(task),b=toTask(task)
  if(!dateOk(a)||!dateOk(b))return null
  return a<=b?{start:a,end:b}:{start:b,end:a}
}
function spanOf(items){
  const spans=items.map(taskRange).filter(Boolean)
  if(!spans.length)return null
  return {
    start:spans.reduce((a,b)=>a<b.start?a:b.start,spans[0].start),
    end:spans.reduce((a,b)=>a>b.end?a:b.end,spans[0].end)
  }
}
const inWindow=(range,start,end)=>range&&range.start<=end&&range.end>=start
function recurrenceKey(task,recurrence){
  const rule=recurrence(task)
  const family=rule?.sourceId||
    (task.recurrenceId?.startsWith('repeat-v1:')?task.sourceTaskId:'')||
    task.routineId||''
  return family?String(task.planId)+'/'+String(task.bucketId||'')+'/'+family:''
}
function statusLabel(task,today){
  if(task.status==='done')return 'Concluída'
  if(dateOk(task.dueDate)&&task.dueDate<today)return 'Atrasada'
  if(task.status==='doing')return 'Em andamento'
  return 'Não iniciada'
}
function taskCss(task,today){
  if(task.status==='done')return 'is-done'
  if(dateOk(task.dueDate)&&task.dueDate<today)return 'is-late'
  return task.status==='doing'?'is-doing':'is-todo'
}
function buildPlanRows(plan,items,buckets,recurrence){
  const rows=[]
  const progress=items.length?Math.round(items.filter(task=>task.status==='done').length/items.length*100):0
  rows.push({kind:'plan',id:plan.id,name:plan.name,items,span:spanOf(items),progress})
  if(viewState.collapsedPlans.has(plan.id))return rows
  const bucketList=buckets.filter(bucket=>bucket.planId===plan.id&&!bucket.deleted).sort((a,b)=>(a.order||0)-(b.order||0))
  const ordered=[...new Set(items.map(task=>task.bucketId||''))].sort((a,b)=>{
    const ai=bucketList.findIndex(item=>item.id===a),bi=bucketList.findIndex(item=>item.id===b)
    return (ai<0?99999:ai)-(bi<0?99999:bi)
  })
  for(const bucketId of ordered){
    const bucket=bucketList.find(entry=>entry.id===bucketId)
    const groupItems=items.filter(task=>(task.bucketId||'')===bucketId)
    const bucketKey=plan.id+'/'+bucketId
    rows.push({kind:'bucket',key:bucketKey,name:bucket?.name||'Outras demandas',items:groupItems,span:spanOf(groupItems)})
    if(viewState.collapsedBuckets.has(bucketKey))continue
    const families=new Map()
    for(const task of groupItems){
      const family=viewState.groupRecurrences?recurrenceKey(task,recurrence):''
      const key=family||'task:'+task.id
      if(!families.has(key))families.set(key,[])
      families.get(key).push(task)
    }
    for(const [key,members] of families){
      if(members.length>1&&viewState.groupRecurrences&&!key.startsWith('task:')){
        members.sort((a,b)=>(fromTask(a)||'').localeCompare(fromTask(b)||'')||a.id.localeCompare(b.id))
        const row={kind:'series',key,name:members[0].title,items:members,span:spanOf(members)}
        rows.push(row)
        if(viewState.expandedSeries.has(key))for(const task of members)rows.push({kind:'task',task,occurrence:true})
      }else for(const task of members)rows.push({kind:'task',task,occurrence:Boolean(recurrenceKey(task,recurrence))})
    }
  }
  return rows
}
export function selectGanttPlanContext(planId){
  if(planId)viewState.focusId=planId
}
export function renderGanttWorkspace(ctx){
  const {content,tasks,allTasks,plans,buckets,recurrence,
    openTask,resolveDependencies,routeDependencies,render,today,progressOf,
    planCycleConfigOf,cycleForTask,cycleDateOf,nextCycleDate,setCycleDate}=ctx
  const orderedPlans=plans.slice().sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'))
  if(!viewState.cursor)viewState.cursor=today
  if(!orderedPlans.some(plan=>plan.id===viewState.focusId))viewState.focusId=ctx.globalPlanId||orderedPlans[0]?.id||''
  if(viewState.selectedIds!==null){
    viewState.selectedIds=viewState.selectedIds.filter(id=>orderedPlans.some(p=>p.id===id))
  }
  const selectedIds=viewState.mode==='focus'?[viewState.focusId]:
    viewState.selectedIds===null?orderedPlans.map(plan=>plan.id):viewState.selectedIds
  const chosen=orderedPlans.filter(plan=>selectedIds.includes(plan.id))
  const recurringFocused=viewState.mode==='focus'&&planCycleConfigOf?.(viewState.focusId)
  if(recurringFocused&&viewState.cycleOnly&&viewState.cycleFocusPlan!==viewState.focusId){
    viewState.cursor=cycleDateOf(viewState.focusId)||today
    viewState.cycleFocusPlan=viewState.focusId
  }
  if(!recurringFocused)viewState.cycleFocusPlan=''
  const totalDays={weeks:35,months:91,quarter:182}[viewState.zoom]||35
  const step={weeks:7,months:7,quarter:14}[viewState.zoom]||7
  const start=monday(viewState.cursor),end=add(start,totalDays-1)
  const relevant=tasks.filter(task=>{
    if(!selectedIds.includes(task.planId))return false
    const rule=planCycleConfigOf?.(task.planId)
    return !viewState.cycleOnly||!rule||
      cycleForTask(rule,task)===cycleDateOf(task.planId)
  })
  const dated=relevant.filter(task=>inWindow(taskRange(task),start,end))
  const resolved=resolveDependencies(allTasks,dated)
  const rows=[]
  for(const plan of chosen){
    const within=dated.filter(task=>task.planId===plan.id)
    rows.push(...buildPlanRows(plan,within,buckets,recurrence))
  }
  const taskCount=dated.length,completed=dated.filter(t=>t.status==='done').length
  const overdue=dated.filter(t=>t.status!=='done'&&dateOk(t.dueDate)&&t.dueDate<today).length
  const shell=element('section','pg-workspace')
  const intro=element('div','pg-intro')
  const introText=element('div','pg-intro-text')
  introText.append(element('span','pg-eyebrow','PLANEJAMENTO E ACOMPANHAMENTO'),
    element('h2','pg-title','Cronograma de projetos'),
    element('p','pg-subtitle','Acompanhe seus planos, prazos, responsáveis e dependências em uma única linha do tempo.'))
  intro.append(introText)
  const switcher=element('div','pg-switcher')
  const modeButton=(id,name)=>{
    const btn=control(name,()=>{
      if(id==='portfolio'&&!viewState.portfolioInitialized){
        viewState.collapsedPlans=new Set(orderedPlans.filter(p=>p.id!==viewState.focusId).map(p=>p.id))
        viewState.portfolioInitialized=true
      }
      if(id==='focus')viewState.collapsedPlans.delete(viewState.focusId)
      viewState.mode=id;render()
    },'pg-switch'+(viewState.mode===id?' is-active':''))
    btn.setAttribute('aria-pressed',String(viewState.mode===id))
    return btn
  }
  switcher.append(modeButton('focus','Plano em foco'),modeButton('portfolio','Portfólio'))
  intro.append(switcher)
  shell.append(intro)

  const filters=element('div','pg-controls')
  const pickerWrap=element('div','pg-picker-wrap')
  pickerWrap.append(element('span','pg-caption','PLANOS / PROJETOS'))
  const picker=element('details','pg-plan-picker')
  const selectedNames=chosen.map(p=>p.name)
  const summary=element('summary','pg-plan-summary')
  summary.append(element('span','pg-picker-icon','▤'),
    element('span','pg-picker-label',viewState.mode==='focus'?(selectedNames[0]||'Selecione um plano'):
      (chosen.length===orderedPlans.length?'Todos os planos':chosen.length+' planos selecionados')),
    element('span','pg-picker-chevron','⌄'))
  const menu=element('div','pg-menu')
  menu.append(element('strong','pg-menu-heading',viewState.mode==='focus'?'Escolha um plano':'Selecione os planos'))
  const search=element('input','pg-menu-search')
  search.type='search';search.placeholder='Pesquisar plano...';search.setAttribute('aria-label','Pesquisar planos')
  menu.append(search)
  const options=element('div','pg-menu-options')
  const draft=new Set(viewState.selectedIds===null?orderedPlans.map(plan=>plan.id):viewState.selectedIds)
  const counter=element('span','pg-menu-counter','')
  const updateCounter=()=>{counter.textContent=draft.size+' selecionado(s)'}
  for(const plan of orderedPlans){
    const option=element(viewState.mode==='focus'?'button':'label','pg-plan-option')
    option.dataset.name=plan.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    if(viewState.mode==='focus'){
      option.type='button'
      option.addEventListener('click',()=>{viewState.focusId=plan.id;picker.open=false;render()})
      if(viewState.focusId===plan.id)option.classList.add('is-selected')
    }else{
      const checkbox=element('input')
      checkbox.type='checkbox';checkbox.checked=draft.has(plan.id)
      checkbox.addEventListener('change',()=>{
        if(checkbox.checked)draft.add(plan.id);else draft.delete(plan.id)
        updateCounter()
      })
      option.append(checkbox)
    }
    const info=element('span','pg-option-info')
    info.append(element('strong','',plan.name))
    const taskTotal=tasks.filter(task=>task.planId===plan.id).length
    info.append(element('small','',taskTotal+' demanda(s)'))
    option.append(info)
    options.append(option)
  }
  updateCounter()
  search.addEventListener('input',()=>{
    const q=search.value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()
    for(const option of options.children)option.hidden=!option.dataset.name.includes(q)
  })
  menu.append(options)
  if(viewState.mode==='portfolio'){
    const foot=element('div','pg-menu-foot')
    const markAll=control('Selecionar todos',()=>{for(const plan of orderedPlans)draft.add(plan.id);for(const input of options.querySelectorAll('input'))input.checked=true;updateCounter()},'pg-plain-button')
    const apply=control('Aplicar',()=>{
      if(!draft.size){counter.textContent='Escolha pelo menos um plano.';return}
      viewState.selectedIds=[...draft];picker.open=false;render()
    },'pg-button pg-apply')
    foot.append(counter,markAll,apply);menu.append(foot)
  }
  picker.append(summary,menu);pickerWrap.append(picker);filters.append(pickerWrap)
  const zoomWrap=element('div','pg-zoom-wrap')
  zoomWrap.append(element('span','pg-caption','ESCALA DA LINHA DO TEMPO'))
  const zoom=element('div','pg-zoom')
  for(const [id,label] of [['weeks','Semanas'],['months','Meses'],['quarter','Trimestre']]){
    const choice=control(label,()=>{viewState.zoom=id;render()},'pg-zoom-choice'+(viewState.zoom===id?' is-active':''))
    choice.setAttribute('aria-pressed',String(viewState.zoom===id));zoom.append(choice)
  }
  zoomWrap.append(zoom);filters.append(zoomWrap)
  shell.append(filters)

  const metrics=element('div','pg-metrics')
  const metricData=[
    [String(chosen.length),'Planos selecionados','▤'],
    [String(taskCount),'Demandas no período','▦'],
    [String(overdue),'Prazos em atraso','◷'],
    [String(dated.length?Math.round(completed/dated.length*100):0)+'%','Demandas concluídas','◉']
  ]
  for(const [value,name,icon] of metricData){
    const item=element('div','pg-metric'+(name==='Prazos em atraso'&&overdue?' has-alert':''))
    const texts=element('div','')
    texts.append(element('span','',name),element('strong','',value))
    item.append(texts,element('span','pg-metric-icon',icon));metrics.append(item)
  }
  shell.append(metrics)

  const card=element('div','pg-card')
  const cardHeader=element('div','pg-card-heading')
  const heading=element('div','pg-card-text')
  heading.append(element('h3','',viewState.mode==='focus'?(chosen[0]?.name||'Nenhum plano selecionado'):'Visão geral dos planos'),
    element('small','',dateLabel(start,{month:'long',year:'numeric'})+' a '+dateLabel(end,{month:'long',year:'numeric'})+
      ' · '+resolved.links.length+' vínculo(s) no período'))
  cardHeader.append(heading)
  const toolbar=element('div','pg-toolbar')
  const toggleLinks=control(viewState.showAllLinks?'Dependências: todas':'Dependências: em foco',
    ()=>{viewState.showAllLinks=!viewState.showAllLinks;render()},'pg-tool-button')
  toggleLinks.setAttribute('aria-pressed',String(viewState.showAllLinks))
  const toggleSeries=control(viewState.groupRecurrences?'Recorrências agrupadas':'Recorrências detalhadas',
    ()=>{viewState.groupRecurrences=!viewState.groupRecurrences;render()},'pg-tool-button')
  toggleSeries.setAttribute('aria-pressed',String(viewState.groupRecurrences))
  toolbar.append(toggleLinks,toggleSeries)
  if(chosen.some(plan=>planCycleConfigOf?.(plan.id))){
    const scope=control(viewState.cycleOnly?'Ciclo selecionado':'Todos os ciclos',()=>{
      viewState.cycleOnly=!viewState.cycleOnly
      if(viewState.cycleOnly&&recurringFocused)viewState.cursor=cycleDateOf(viewState.focusId)||today
      render()
    },'pg-tool-button')
    scope.title='Alternar entre execuções selecionadas e histórico completo dos planos recorrentes'
    scope.setAttribute('aria-pressed',String(viewState.cycleOnly))
    toolbar.append(scope)
    if(recurringFocused&&viewState.cycleOnly){
      const current=cycleDateOf(viewState.focusId)
      const cycleControls=element('div','pg-cycle-controls')
      const prev=control('‹',()=>{
        const previous=add(current,-1)
        const rule=planCycleConfigOf(viewState.focusId)
        const target=ctx.currentCycleDate(rule,previous)
        setCycleDate(viewState.focusId,target);viewState.cursor=target;render()
      },'pg-pager')
      prev.setAttribute('aria-label','Ciclo anterior')
      const cycleDate=element('strong','pg-cycle-date',dateLabel(current))
      const next=control('›',()=>{
        const target=nextCycleDate(planCycleConfigOf(viewState.focusId),current)
        setCycleDate(viewState.focusId,target);viewState.cursor=target;render()
      },'pg-pager')
      next.setAttribute('aria-label','Próximo ciclo')
      cycleControls.append(prev,cycleDate,next)
      toolbar.append(cycleControls)
    }
  }
  if(viewState.mode==='portfolio'){
    const allCollapsed=chosen.every(plan=>viewState.collapsedPlans.has(plan.id))
    toolbar.append(control(allCollapsed?'Expandir planos':'Recolher planos',()=>{
      for(const plan of chosen){
        if(allCollapsed)viewState.collapsedPlans.delete(plan.id)
        else viewState.collapsedPlans.add(plan.id)
      }
      render()
    },'pg-tool-button'))
  }
  const shift=delta=>{viewState.cursor=add(viewState.cursor,delta*({weeks:28,months:84,quarter:182}[viewState.zoom]||28));render()}
  toolbar.append(control('‹',()=>shift(-1),'pg-pager'),control('Hoje',()=>{viewState.cursor=today;render()},'pg-pager pg-today'),
    control('›',()=>shift(1),'pg-pager'))
  cardHeader.append(toolbar);card.append(cardHeader)

  const scroller=element('div','pg-scroller')
  scroller.setAttribute('role','region')
  scroller.setAttribute('aria-label','Linha do tempo do Gantt; role para os lados para ver mais datas')
  scroller.tabIndex=0
  const grid=element('div','pg-grid')
  const outlineKey='ipcv-planner-gantt-outline-width'
  const minimumOutline=210,maximumOutline=600
  const clampOutline=width=>Math.max(minimumOutline,Math.min(maximumOutline,Math.round(width)))
  const savedWidth=(()=>{
    try{
      const value=window.localStorage.getItem(outlineKey)
      if(value===null)return null
      const parsed=Number(value)
      return Number.isFinite(parsed)?clampOutline(parsed):null
    }catch{return null}
  })()
  if(savedWidth!==null)grid.style.setProperty('--pg-outline-width',savedWidth+'px')
  const tree=element('div','pg-tree')
  const treeHeader=element('div','pg-tree-header')
  treeHeader.append(element('span','','PLANO / BUCKET / DEMANDA'),element('span','','RESP.'),element('span','','AVANÇO'))
  tree.append(treeHeader)
  const resize=element('div','pg-outline-resizer')
  resize.tabIndex=0
  resize.setAttribute('role','separator')
  resize.setAttribute('aria-orientation','vertical')
  resize.setAttribute('aria-label','Ajustar largura da coluna de nomes do Gantt')
  resize.setAttribute('aria-valuemin',String(minimumOutline))
  resize.setAttribute('aria-valuemax',String(maximumOutline))
  resize.title='Arraste para ajustar os nomes. Duplo clique para restaurar.'
  const measuredWidth=()=>Math.round(tree.getBoundingClientRect().width)||290
  let latestWidth=savedWidth
  const currentWidth=()=>latestWidth??measuredWidth()
  const setWidth=(width,persist=false)=>{
    const next=clampOutline(width)
    latestWidth=next
    grid.style.setProperty('--pg-outline-width',next+'px')
    resize.setAttribute('aria-valuenow',String(next))
    resize.setAttribute('aria-valuetext',next+' pixels')
    if(persist)try{window.localStorage.setItem(outlineKey,String(next))}catch{}
    // A atualização das ligações é feita após a redistribuição das colunas.
    requestAnimationFrame(()=>drawCurrent?.())
  }
  resize.setAttribute('aria-valuenow',String(currentWidth()))
  let resizing=false,originX=0,originWidth=0
  resize.addEventListener('pointerdown',event=>{
    if(event.pointerType==='mouse'&&event.button!==0)return
    event.preventDefault()
    resizing=true;originX=event.clientX;originWidth=currentWidth()
    resize.setPointerCapture?.(event.pointerId)
    document.body.classList.add('pg-column-resizing')
  })
  resize.addEventListener('pointermove',event=>{
    if(resizing)setWidth(originWidth+event.clientX-originX)
  })
  const finishResize=()=>{
    if(!resizing)return
    resizing=false
    document.body.classList.remove('pg-column-resizing')
    setWidth(currentWidth(),true)
  }
  resize.addEventListener('pointerup',finishResize)
  resize.addEventListener('pointercancel',finishResize)
  resize.addEventListener('lostpointercapture',finishResize)
  resize.addEventListener('dblclick',()=>{
    const defaultWidth=window.innerWidth<=650?215:window.innerWidth<=1040?265:290
    setWidth(defaultWidth,true)
  })
  resize.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return
    event.preventDefault()
    const delta=(event.shiftKey?40:20)*(event.key==='ArrowLeft'?-1:1)
    setWidth(event.key==='Home'?minimumOutline:event.key==='End'?maximumOutline:currentWidth()+delta,true)
  })
  tree.append(resize)
  const timeline=element('div','pg-timeline')
  const dateHead=element('div','pg-date-head')
  const monthHead=element('div','pg-month-head')
  let index=0
  while(index<totalDays){
    const cursor=add(start,index)
    let length=1
    while(index+length<totalDays&&add(start,index+length).slice(0,7)===cursor.slice(0,7))length++
    const month=element('span','pg-month',dateLabel(cursor,{month:'long',year:'numeric'}))
    month.style.width=(length/totalDays*100)+'%'
    monthHead.append(month);index+=length
  }
  const tickHead=element('div','pg-tick-head')
  for(let day=0;day<totalDays;day+=step){
    const length=Math.min(step,totalDays-day)
    const date=add(start,day)
    const tick=element('span','pg-tick',dateLabel(date,{day:'2-digit',month:'short'}))
    tick.style.width=(length/totalDays*100)+'%'
    tickHead.append(tick)
  }
  dateHead.append(monthHead,tickHead);timeline.append(dateHead)
  const bars=new Map()
  const rangeButton=(range,cls,label,callback)=>{
    if(!range)return null
    const first=Math.max(0,diff(start,range.start))
    const last=Math.min(totalDays-1,diff(start,range.end))
    if(first>last)return null
    const item=control(label,callback,'pg-bar '+cls)
    item.style.left=(first/totalDays*100)+'%'
    item.style.width=(Math.max(1,last-first+1)/totalDays*100)+'%'
    return item
  }
  const rerender=()=>render()
  for(const row of rows){
    const label=element('div','pg-left-row pg-'+row.kind)
    const time=element('div','pg-time-row pg-'+row.kind)
    time.style.setProperty('--pg-grid-step',(step/totalDays*100)+'%')
    const name=element('div','pg-row-name')
    if(row.kind==='plan'||row.kind==='bucket'||row.kind==='series'){
      const key=row.kind==='plan'?row.id:row.key
      const collapsed=row.kind==='plan'?viewState.collapsedPlans.has(key):
        row.kind==='bucket'?viewState.collapsedBuckets.has(key):!viewState.expandedSeries.has(key)
      const toggle=control(collapsed?'▸':'▾',()=>{
        if(row.kind==='plan'){
          if(viewState.collapsedPlans.has(key))viewState.collapsedPlans.delete(key)
          else viewState.collapsedPlans.add(key)
        }else if(row.kind==='bucket'){
          if(viewState.collapsedBuckets.has(key))viewState.collapsedBuckets.delete(key)
          else viewState.collapsedBuckets.add(key)
        }else{
          if(viewState.expandedSeries.has(key))viewState.expandedSeries.delete(key)
          else viewState.expandedSeries.add(key)
        }
        rerender()
      },'pg-row-toggle')
      toggle.setAttribute('aria-expanded',String(!collapsed))
      toggle.setAttribute('aria-label',(collapsed?'Expandir ':'Recolher ')+row.name)
      name.append(toggle,element('span','pg-row-icon',row.kind==='plan'?'▤':row.kind==='bucket'?'▧':'↻'))
      const text=element('span','pg-row-title',row.name)
      text.title=row.name;name.append(text)
      if(row.kind==='series')name.append(element('span','pg-series-count',row.items.length+'×'))
      const record=rangeButton(row.span,row.kind==='plan'?'is-plan':row.kind==='bucket'?'is-bucket':'is-series',
        row.kind==='plan'?row.progress+'%':'',()=>{})
      if(record){
        record.disabled=true;record.setAttribute('aria-label',row.name+' · '+dateLabel(row.span.start)+' a '+dateLabel(row.span.end))
        time.append(record)
        if(row.kind==='plan'){
          const fill=element('span','pg-plan-fill')
          fill.style.width=row.progress+'%';record.prepend(fill)
        }
      }
      if(row.kind==='series'){
        for(const task of row.items){
          const span=taskRange(task)
          const occ=rangeButton(span,'is-occurrence '+taskCss(task,today),'',()=>openTask(task))
          if(occ){
            occ.title=task.title+' · '+dateLabel(span.start)+' · '+statusLabel(task,today)
            occ.setAttribute('aria-label',occ.title)
            time.append(occ)
          }
        }
      }
    }else{
      const task=row.task
      name.append(element('span','pg-task-marker '+taskCss(task,today),'●'))
      const taskButton=control(task.title+(row.occurrence?' · '+dateLabel(toTask(task)):''),
        ()=>openTask(task),'pg-task-title')
      taskButton.title=task.title;name.append(taskButton)
      if(resolved.links.some(link=>link.from===task.id||link.to===task.id)){
        const pin=control('↗',()=>{
          viewState.selectedTaskId=viewState.selectedTaskId===task.id?'':task.id
          drawCurrent?.()
        },'pg-task-focus')
        pin.title='Destacar conexões de '+task.title
        pin.setAttribute('aria-label',pin.title)
        pin.dataset.id=task.id;name.append(pin)
      }
      const span=taskRange(task)
      const percent=typeof progressOf==='function'?progressOf(task):(task.status==='done'?100:0)
      const bar=rangeButton(span,taskCss(task,today),'',()=>openTask(task))
      if(bar){
        bar.title=task.title+' · '+dateLabel(span.start)+' a '+dateLabel(span.end)+' · '+statusLabel(task,today)
        bar.setAttribute('aria-label',bar.title+' · '+percent+'% concluído')
        if(percent>0){
          const completed=element('span','pg-task-fill')
          completed.style.width=percent+'%';bar.append(completed)
        }
        if(percent>0&&percent<100&&diff(span.start,span.end)>=2){
          bar.append(element('span','pg-task-percent',percent+'%'))
        }
        bar.addEventListener('mouseenter',()=>{viewState.hovered=task.id;drawCurrent?.()})
        bar.addEventListener('mouseleave',()=>{viewState.hovered='';drawCurrent?.()})
        bar.addEventListener('focus',()=>{viewState.hovered=task.id;drawCurrent?.()})
        bar.addEventListener('blur',()=>{viewState.hovered='';drawCurrent?.()})
        time.append(bar);bars.set(task.id,{bar,task})
      }
    }
    label.append(name)
    label.append(element('span','pg-owner',row.kind==='task'
      ?(row.task.assignees||[]).map(p=>p.name||p.email).filter(Boolean).slice(0,1).join('')||'—'
      :row.kind==='series'?'Série':''))
    label.append(element('span','pg-progress',row.kind==='plan'?row.progress+'%':
      row.kind==='task'?((typeof progressOf==='function'?progressOf(row.task):(row.task.status==='done'?100:0))+'%'):
      row.kind==='bucket'?row.items.filter(t=>t.status==='done').length+'/'+row.items.length:
      row.kind==='series'?row.items.filter(t=>t.status==='done').length+'/'+row.items.length:''))
    tree.append(label);timeline.append(time)
  }
  if(!rows.length){
    const empty=element('div','pg-empty','Nenhum plano disponível. Crie um plano para começar.')
    tree.append(empty);timeline.append(element('div','pg-empty',''))
  }
  const todayPosition=diff(start,today)
  if(todayPosition>=0&&todayPosition<totalDays){
    const marker=element('div','pg-today-line')
    marker.style.left=((todayPosition+.5)/totalDays*100)+'%'
    timeline.append(marker)
  }
  grid.append(tree,timeline);scroller.append(grid);card.append(scroller)
  const footer=element('div','pg-legend')
  for(const [cls,title] of [['is-plan','Plano'],['is-done','Concluída'],['is-doing','Em andamento'],
    ['is-todo','Não iniciada'],['is-late','Em atraso'],['is-occurrence','Ocorrência']]){
    const item=element('span','pg-legend-item')
    item.append(element('i','pg-key '+cls,''),element('span','',title))
    footer.append(item)
  }
  card.append(footer);shell.append(card)
  const hiddenCount=resolved.links.filter(link=>!bars.has(link.from)||!bars.has(link.to)).length
  if(hiddenCount){
    const note=element('div','pg-note',hiddenCount+
      ' ligação(ões) não aparecem porque uma demanda está recolhida ou filtrada. Expanda as séries e os buckets para ver as setas.')
    shell.append(note)
  }
  if(resolved.missing.length){
    shell.append(element('div','pg-note is-warning',resolved.missing.length+
      ' dependência(s) sem ocorrência correspondente. Nenhuma ligação foi criada com uma tarefa de outro ciclo.'))
  }
  content.append(shell)

  function draw(){
    if(!timeline.isConnected)return
    timeline.querySelector('svg.pg-links')?.remove()
    const bounds=timeline.getBoundingClientRect()
    const width=timeline.clientWidth,height=timeline.scrollHeight
    if(!width||!height)return
    const nodes=[...bars.values()].map(({task,bar})=>{
      const b=bar.getBoundingClientRect()
      return {id:task.id,title:task.title,
        left:b.left-bounds.left,right:b.right-bounds.left,
        y:(b.top+b.bottom)/2-bounds.top}
    })
    const canDraw=resolved.links.filter(link=>bars.has(link.from)&&bars.has(link.to))
    const focusId=(viewState.hovered&&bars.has(viewState.hovered)?viewState.hovered:'')||
      (bars.has(viewState.selectedTaskId)?viewState.selectedTaskId:'')||
      (canDraw.length>6?canDraw[0]?.to:'')
    const routes=routeDependencies(nodes,canDraw,{
      width,focusedId:focusId,showAll:viewState.showAllLinks
    })
    for(const [id,{bar}] of bars)bar.classList.toggle('is-focused',id===focusId)
    for(const btn of tree.querySelectorAll('.pg-task-focus')){
      btn.setAttribute('aria-pressed',String(btn.dataset.id===viewState.selectedTaskId))
    }
    if(!routes.routes.length)return
    const ns='http://www.w3.org/2000/svg'
    const svg=document.createElementNS(ns,'svg')
    svg.setAttribute('class','pg-links')
    svg.setAttribute('viewBox','0 0 '+width+' '+height)
    svg.setAttribute('width',String(width));svg.setAttribute('height',String(height))
    svg.setAttribute('aria-hidden','true')
    svg.innerHTML='<defs><marker id="pg-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z"/></marker></defs>'
    const put=(link,segment='')=>{
      const path=document.createElementNS(ns,'path')
      path.setAttribute('d',link.d)
      path.setAttribute('class','pg-link'+(link.active?' is-active':'')+
        (focusId&&!link.active?' is-muted':'')+(link.backward?' is-backward':'')+
        (segment?' is-'+segment:''))
      if(link.markerEnd!==false)path.setAttribute('marker-end','url(#pg-arrow)')
      const title=document.createElementNS(ns,'title')
      title.textContent=link.title||'Dependência'
      path.append(title);svg.append(path)
    }
    for(const route of routes.routes)put(route,'branch')
    for(const bundle of routes.bundles||[]){
      put({...bundle,d:bundle.trunk,markerEnd:false},'trunk')
      put({...bundle,d:bundle.exit,markerEnd:true},'trunk')
    }
    timeline.append(svg)
  }
  drawCurrent=draw
  requestAnimationFrame(draw)
}
