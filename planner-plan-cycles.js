import {parseRotationConfig,rotationConfigId,taskRecurrence,recurrenceCycleIndex,rotationAssigneesAtIndex}
  from './planner-recurrence.js?v=20261113-plan-rotation-v1'

/* Ciclos de planos do IPCVT.
   Configuração interna usa um registro técnico excluído, tal como o rodízio,
   para ser compatível com as regras Firestore existentes.
   Não edita nem apaga as ocorrências históricas ao converter um plano. */
const DAY=86400000
const PREFIX='plan_cycle_v1_'
const KEY='plan-cycle-v1'
const INSTANCE='plan-instance-v1'
const UNITS=['day','week','month']
const dateOK=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)
  &&Number.isFinite(Date.parse(value+'T00:00:00Z'))
  &&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value
const d=value=>new Date(value+'T12:00:00Z')
const iso=value=>value.toISOString().slice(0,10)
const shift=(value,days)=>{
  const t=d(value);t.setUTCDate(t.getUTCDate()+days);return iso(t)
}
const distance=(a,b)=>Math.round((d(b)-d(a))/DAY)
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()
function monthAt(anchor,months){
  const date=d(anchor),day=date.getUTCDate()
  date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+months)
  const end=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0,12))
  date.setUTCDate(Math.min(day,end.getUTCDate()))
  return iso(date)
}
export function planCycleConfigId(planId){
  const value=PREFIX+encodeURIComponent(String(planId||''))
  if(!planId||value.length>200||value.includes('/'))throw new Error('Plano inválido para repetição.')
  return value
}
export function parsePlanCycleConfig(record){
  if(!record?.deleted||!String(record.id||'').startsWith(PREFIX))return null
  const parts=String(record.templateKey||'').split(':')
  if(parts.length!==4||parts[0]!==KEY||!UNITS.includes(parts[1]))return null
  const interval=Number(parts[2]),anchor=parts[3]
  if(!Number.isInteger(interval)||interval<1||interval>999||!dateOK(anchor)||!record.planId)return null
  if(record.id!==planCycleConfigId(record.planId))return null
  return {id:record.id,planId:record.planId,unit:parts[1],interval,anchor,templateKey:record.templateKey}
}
export function planCycleConfigRecord(plan,options,previous=null){
  if(!plan?.id)throw new Error('Salve o plano antes de ativar a repetição.')
  const {unit='week',interval=1,anchor}=options||{}
  if(!UNITS.includes(unit)||!Number.isInteger(interval)||interval<1||interval>999||!dateOK(anchor)){
    throw new Error('Informe frequência e data de referência válidas.')
  }
  const id=planCycleConfigId(plan.id)
  return {...(previous||{}),id,planId:plan.id,bucketId:'',
    title:'Configuração interna: plano recorrente',
    description:'',team:'',assignees:[],startDate:'',dueDate:'',
    status:'todo',priority:'normal',checklist:[],dependencyIds:[],
    eventId:'',dateMode:'manual',dueOffsetDays:null,
    routineId:'',cycleKey:'',sourceTaskId:'',recurrenceId:'',deleted:true,
    templateKey:[KEY,unit,interval,anchor].join(':')}
}
export function currentPlanCycle(config,date){
  if(!config||!dateOK(date))return ''
  const {anchor,interval,unit}=config
  if(unit==='day'||unit==='week'){
    const step=interval*(unit==='week'?7:1)
    return shift(anchor,Math.ceil(distance(anchor,date)/step)*step)
  }
  const a=d(anchor),current=d(date)
  const monthDiff=(current.getUTCFullYear()-a.getUTCFullYear())*12+current.getUTCMonth()-a.getUTCMonth()
  let index=Math.floor(monthDiff/interval)
  let result=monthAt(anchor,index*interval)
  for(let i=0;i<4&&result<date;i++)result=monthAt(anchor,(++index)*interval)
  for(let i=0;i<4&&monthAt(anchor,(index-1)*interval)>=date;i++)result=monthAt(anchor,(--index)*interval)
  return result
}
export function nextPlanCycle(config,current){
  if(!config||!dateOK(current))return ''
  return config.unit==='month'?monthAt(config.anchor,
    (Math.round(((d(current).getUTCFullYear()-d(config.anchor).getUTCFullYear())*12+
    d(current).getUTCMonth()-d(config.anchor).getUTCMonth())/config.interval)+1)*config.interval)
    :shift(current,config.interval*(config.unit==='week'?7:1))
}
export function previousPlanCycle(config,current){
  if(!config||!dateOK(current))return ''
  if(config.unit!=='month')return shift(current,-config.interval*(config.unit==='week'?7:1))
  const a=d(config.anchor),c=d(current)
  const elapsed=(c.getUTCFullYear()-a.getUTCFullYear())*12+c.getUTCMonth()-a.getUTCMonth()
  const index=Math.round(elapsed/config.interval)-1
  return monthAt(config.anchor,index*config.interval)
}
export function cycleForPlanTask(config,task){
  if(!config||!task)return ''
  if(task.templateKey===INSTANCE&&dateOK(task.cycleKey))return task.cycleKey
  return currentPlanCycle(config,task.dueDate)
}
export function taskPlanFamily(task){
  if(!task)return ''
  if(task.sourceTaskId)return task.sourceTaskId
  const parts=String(task.recurrenceId||'').split(':')
  if(parts[0]==='repeat-v1'&&parts.length===5){
    try {return decodeURIComponent(parts[1])}catch{}
  }
  return task.id||''
}
export function planCycleLabel(config,date){
  const value=currentPlanCycle(config,date)
  return value?new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(d(value)):''
}
// A rotação usa o índice do ciclo e não o número de tarefas concluídas.
export function planCycleIndex(config,cycle){
  if(!config||!dateOK(cycle))return 0
  if(config.unit!=='month'){
    const step=config.interval*(config.unit==='week'?7:1)
    return Math.max(0,Math.round(distance(config.anchor,cycle)/step))
  }
  const from=d(config.anchor),to=d(cycle)
  const months=(to.getUTCFullYear()-from.getUTCFullYear())*12+
    to.getUTCMonth()-from.getUTCMonth()
  return Math.max(0,Math.round(months/config.interval))
}
export function assigneesForPlanCycle(config,template,rotation,cycle,dueDate){
  if(!rotation)return (template.assignees||[]).map(person=>({...person}))
  const originalRule=taskRecurrence(template)
  const index=originalRule?recurrenceCycleIndex(originalRule,dueDate):
    planCycleIndex(config,cycle)
  return rotationAssigneesAtIndex(template,rotation,index)
}
export function planCycleDates(config,today,count=2){
  if(!config||!dateOK(today))return []
  const first=currentPlanCycle(config,today)
  const dates=[first]
  for(let i=1;i<count;i++)dates.push(nextPlanCycle(config,dates[i-1]))
  return dates.filter(dateOK)
}
export function planOccurrenceId(sourceId,cycle){
  const key=String(sourceId||''),enc=encodeURIComponent(key)
  let hash=2166136261
  for(let i=0;i<key.length;i++)hash=Math.imul(hash^key.charCodeAt(i),16777619)
  return 'plan_occ_'+enc.slice(0,120)+'_'+(hash>>>0).toString(16).padStart(8,'0')+'_'+cycle
}
function planFamilies(allTasks,config){
  const tasks=allTasks.filter(task=>task.planId===config.planId&&!task.deleted
    &&dateOK(task.dueDate)&&!String(task.id||'').startsWith(PREFIX))
  const families=new Map()
  for(const task of tasks){
    const root=taskPlanFamily(task)
    if(!root)continue
    if(!families.has(root))families.set(root,[])
    families.get(root).push(task)
  }
  const rows=[]
  for(const [root,items] of families){
    if(allTasks.some(task=>task.id===root&&task.deleted))continue
    const source=items.find(t=>t.id===root)||
      items.slice().sort((a,b)=>a.dueDate.localeCompare(b.dueDate))[0]
    rows.push({root,source,items})
  }
  return rows
}
export function missingPlanCycleTasks(config,allTasks,buckets,today,count=2){
  const families=planFamilies(allTasks,config)
  if(!families.length)return []
  const dates=planCycleDates(config,today,count)
  const output=[]
  const rotations=new Map(allTasks.map(parseRotationConfig).filter(Boolean)
    .map(record=>[record.sourceId,record]))
  const sourceFamily=new Map()
  for(const group of families)for(const task of group.items)sourceFamily.set(task.id,group.root)
  for(const target of dates){
    const targetIds=new Map()
    const existingByRoot=new Map()
    for(const group of families){
      const existing=group.items.find(task=>cycleForPlanTask(config,task)===target)
      if(existing)existingByRoot.set(group.root,existing)
      targetIds.set(group.root,existing?.id||planOccurrenceId(group.root,target))
    }
    for(const group of families){
      if(existingByRoot.has(group.root))continue
      // Uma ocorrência excluída é intencional: não recrie o mesmo ciclo.
      if(allTasks.some(task=>task.planId===config.planId&&task.deleted
        &&task.id!==config.id&&taskPlanFamily(task)===group.root
        &&cycleForPlanTask(config,task)===target))continue
      const template=group.source
      const originalCycle=cycleForPlanTask(config,template)
      if(!originalCycle||originalCycle>target)continue
      const offset=distance(originalCycle,template.dueDate)
      const dueDate=shift(target,offset)
      const duration=dateOK(template.startDate)?Math.max(0,distance(template.startDate,template.dueDate)):0
      const bucket=buckets.find(b=>b.id===template.bucketId)
      const todo=buckets.find(b=>!b.deleted&&b.planId===config.planId&&normalize(b.name)==='a fazer')
      const bucketId=['concluido','em andamento'].includes(normalize(bucket?.name))?(todo?.id||''):template.bucketId||''
      const deps=(template.dependencyIds||[]).map(id=>{
        const depRoot=sourceFamily.get(id)||id
        return targetIds.get(depRoot)||id
      }).filter(id=>id&&id!==targetIds.get(group.root)).slice(0,20)
      output.push({
        id:targetIds.get(group.root),planId:config.planId,bucketId,
        title:template.title,description:template.description||'',team:template.team||'',
        assignees:assigneesForPlanCycle(config,template,rotations.get(group.root),target,dueDate),
        startDate:shift(dueDate,-duration),dueDate,
        status:'todo',priority:template.priority||'normal',
        checklist:(template.checklist||[]).map(x=>({...x,done:false})),
        dependencyIds:deps,eventId:'',dateMode:'manual',dueOffsetDays:null,
        sourceTaskId:group.root,cycleKey:target,templateKey:INSTANCE,
        recurrenceId:'',deleted:false
      })
    }
  }
  return output
}
