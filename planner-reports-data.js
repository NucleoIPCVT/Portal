/* IPCVT Planner | Cálculos puros: carteira atual + fatos auditados. */
export const AGING_BANDS=[
 {key:'0-3',label:'0–3 dias',min:0,max:3},
 {key:'4-7',label:'4–7 dias',min:4,max:7},
 {key:'8-14',label:'8–14 dias',min:8,max:14},
 {key:'15-30',label:'15–30 dias',min:15,max:30},
 {key:'31-60',label:'31–60 dias',min:31,max:60},
 {key:'61+',label:'61+ dias',min:61,max:Infinity}
]
const DAY=86400000
export const dateISO=value=>{
 if(!value)return ''
 if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value))return value
 const time=typeof value?.toDate==='function'?value.toDate():
   typeof value?.seconds==='number'?new Date(value.seconds*1000):
   value instanceof Date?value:new Date(value)
 if(!(time instanceof Date)||!Number.isFinite(time.getTime()))return ''
 return new Intl.DateTimeFormat('sv-SE',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'America/Sao_Paulo'}).format(time)
}
export const days=(start,end)=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(start||'')||!/^\d{4}-\d{2}-\d{2}$/.test(end||''))return null
 const a=Date.parse(start+'T12:00:00Z'),b=Date.parse(end+'T12:00:00Z')
 return Number.isFinite(a)&&Number.isFinite(b)?Math.round((b-a)/DAY):null
}
export const addDay=(date,n)=>{
 const t=Date.parse(date+'T12:00:00Z')
 return Number.isFinite(t)?new Date(t+n*DAY).toISOString().slice(0,10):''
}
export const labelDate=iso=>iso?iso.slice(8,10)+'/'+iso.slice(5,7)+'/'+iso.slice(0,4):'—'
const monday=iso=>{
 const day=(new Date(iso+'T12:00:00Z').getUTCDay()+6)%7
 return addDay(iso,-day)
}
export const pct=(a,b)=>b>0?Math.round(a*100/b):null
const isTask=t=>t&&!t.deleted&&!!t.title&&
 !String(t.id||'').startsWith('rotation_v1_')&&!String(t.id||'').startsWith('plan_cycle_v1_')
const name=p=>typeof p==='string'?p:(p?.name||p?.email||'Responsável')
const key=p=>String(p?.email||p?.name||p||'').trim().toLocaleLowerCase('pt-BR')
function weeklyItems(today,period){
 const n=period==='7'?2:period==='90'?13:period==='all'?12:5
 const mondayToday=monday(today)
 return Array.from({length:n},(_,i)=>{
  const start=addDay(mondayToday,-7*(n-1-i))
  return {key:start,label:start.slice(8,10)+'/'+start.slice(5,7),planned:0,delivered:0}
 })
}
export function buildReportModel({tasks=[],plans=[],buckets=[],activities=[],today,planId='',team='',period='30'}){
 const source=(tasks||[]).filter(isTask)
 const chosen=source.filter(t=>(!planId||t.planId===planId)&&(!team||(t.team||'Sem equipe')===team))
 const pending=chosen.filter(t=>t.status!=='done'),done=chosen.filter(t=>t.status==='done')
 const taskById=new Map(source.map(t=>[t.id,t]))
 const planById=new Map(plans.map(p=>[p.id,p.name]))
 const bucketById=new Map(buckets.filter(b=>!b.deleted).map(b=>[b.id,b.name]))
 const isLate=t=>!!t.dueDate&&t.dueDate<today
 const late=pending.filter(isLate)
 const dueSoon=pending.filter(t=>t.dueDate&&t.dueDate>=today&&days(today,t.dueDate)<=7)
 const blocked=pending.filter(t=>(t.dependencyIds||[]).some(id=>!taskById.get(id)||taskById.get(id).status!=='done'))
 const blockedIds=new Set(blocked.map(t=>t.id))
 const stale=pending.filter(t=>{const d=days(dateISO(t.updatedAt),today);return d!==null&&d>=7})
 const staleIds=new Set(stale.map(t=>t.id))
 const unassigned=pending.filter(t=>!(Array.isArray(t.assignees)&&t.assignees.length))
 const risk=dueSoon.filter(t=>!isLate(t)&&!blockedIds.has(t.id)&&
   (t.status==='todo'||t.priority==='high'||t.priority==='urgent'||
    staleIds.has(t.id)||!(t.assignees||[]).length))
 const riskIds=new Set(risk.map(t=>t.id))
 const healthy=pending.filter(t=>!isLate(t)&&!blockedIds.has(t.id)&&!riskIds.has(t.id))
 const health=[
  {key:'done',label:'Concluídas',color:'done',tasks:done},
  {key:'late',label:'Atrasadas',color:'danger',tasks:late},
  {key:'blocked',label:'Bloqueadas',color:'violet',tasks:blocked.filter(t=>!isLate(t))},
  {key:'risk',label:'Atenção (7 dias)',color:'warning',tasks:risk},
  {key:'healthy',label:'Em dia / sem prazo',color:'sage',tasks:healthy}
 ].map(g=>({...g,count:g.tasks.length}))
 const aging=AGING_BANDS.map(b=>({...b,count:0,tasks:[]}))
 const unknownAging=[],ages=[],enriched=new Map()
 for(const t of pending){
  const age=days(dateISO(t.createdAt),today),idle=days(dateISO(t.updatedAt),today)
  const overdue=isLate(t)?Math.max(0,days(t.dueDate,today)||0):0
  const record={task:t,age:age!==null&&age>=0?age:null,
    idle:idle!==null&&idle>=0?idle:null,overdue}
  enriched.set(t.id,record)
  if(record.age===null)unknownAging.push(t)
  else{
   ages.push(record.age)
   const band=aging.find(b=>record.age>=b.min&&record.age<=b.max)
   if(band){band.count++;band.tasks.push(t)}
  }
 }
 const over14=pending.filter(t=>enriched.get(t.id)?.age>=15)
 const avgAging=ages.length?+(ages.reduce((a,b)=>a+b,0)/ages.length).toFixed(1):null
 const avgDelay=late.length?+(late.reduce((a,t)=>a+(days(t.dueDate,today)||0),0)/late.length).toFixed(1):null
 const first=period==='all'?'':addDay(today,-(Number(period)-1))
 const scopedActivities=(activities||[]).filter(a=>
   (!planId||a.planId===planId||(a.entityType==='plans'&&a.entityId===planId))&&
   (!team||a.team===team||(a.entityType==='tasks'&&taskById.get(a.entityId)?.team===team))&&
   (!first||(dateISO(a.timestamp)&&dateISO(a.timestamp)>=first))
 )
 const recentCompletions=scopedActivities.filter(a=>a.entityType==='tasks'&&a.action==='completed')
 const dueChanges=scopedActivities.filter(a=>a.entityType==='tasks'&&
   Array.isArray(a.changes)&&a.changes.some(c=>c.field==='dueDate'))
 const lastCompletions=new Map()
 for(const a of (activities||[]))if(a.entityType==='tasks'&&a.action==='completed'&&!lastCompletions.has(a.entityId)){
  lastCompletions.set(a.entityId,a)
 }
 const proven=done.filter(t=>lastCompletions.has(t.id)&&lastCompletions.get(t.id).dueDate&&dateISO(lastCompletions.get(t.id).timestamp))
 const onTime=proven.filter(t=>dateISO(lastCompletions.get(t.id).timestamp)<=lastCompletions.get(t.id).dueDate)
 const cycleSamples=done.map(t=>days(dateISO(t.createdAt),dateISO(lastCompletions.get(t.id)?.timestamp))).filter(d=>d!==null&&d>=0)
 const avgCycle=cycleSamples.length?+(cycleSamples.reduce((a,b)=>a+b,0)/cycleSamples.length).toFixed(1):null
 const trends=weeklyItems(today,period)
 const trendByKey=new Map(trends.map(t=>[t.key,t]))
 for(const task of chosen)if(task.dueDate){
  const week=trendByKey.get(monday(task.dueDate));if(week)week.planned++
 }
 for(const item of scopedActivities)if(item.entityType==='tasks'&&item.action==='completed'){
  const dt=dateISO(item.timestamp);if(!dt)continue
  const week=trendByKey.get(monday(dt));if(week)week.delivered++
 }
 const ownerMap=new Map(),teamMap=new Map(),bucketMap=new Map()
 for(const t of chosen){
  const teamName=t.team||'Sem equipe'
  const row=teamMap.get(teamName)||{name:teamName,total:0,open:0,done:0,late:0,blocked:0,unassigned:0,ages:[],tasks:[]}
  row.total++;row.tasks.push(t)
  if(t.status==='done')row.done++
  else{
   row.open++
   if(isLate(t))row.late++
   if(blockedIds.has(t.id))row.blocked++
   if(!(t.assignees||[]).length)row.unassigned++
   const age=enriched.get(t.id)?.age;if(age!==null&&age!==undefined)row.ages.push(age)
   for(const p of t.assignees||[]){
    const id=key(p);if(!id)continue
    const v=ownerMap.get(id)||{name:name(p),count:0,late:0,blocked:0,tasks:[]}
    v.count++;if(isLate(t))v.late++;if(blockedIds.has(t.id))v.blocked++
    v.tasks.push(t);ownerMap.set(id,v)
   }
   const bkey=t.planId+':'+(t.bucketId||'none')
   const bname=(planById.get(t.planId)||'Plano')+' · '+(bucketById.get(t.bucketId)||'Sem bucket')
   const b=bucketMap.get(bkey)||{key:bkey,name:bname,count:0,late:0,blocked:0,ages:[],tasks:[]}
   b.count++;b.tasks.push(t)
   if(isLate(t))b.late++
   if(blockedIds.has(t.id))b.blocked++
   if(age!==null&&age!==undefined)b.ages.push(age)
   bucketMap.set(bkey,b)
  }
  teamMap.set(teamName,row)
 }
 const mean=xs=>xs.length?+(xs.reduce((a,b)=>a+b,0)/xs.length).toFixed(1):null
 const teams=[...teamMap.values()].map(x=>({...x,aging:mean(x.ages),lateRate:pct(x.late,x.open)}))
   .sort((a,b)=>b.late-a.late||b.open-a.open)
 const owners=[...ownerMap.values()].sort((a,b)=>b.count-a.count)
 const bucketStats=[...bucketMap.values()].map(x=>({...x,aging:mean(x.ages)}))
   .sort((a,b)=>b.late-a.late||b.count-a.count)
 const blockerMap=new Map()
 for(const t of blocked)for(const ref of t.dependencyIds||[]){
  const other=taskById.get(ref);if(other?.status==='done')continue
  const b=blockerMap.get(ref)||{id:ref,label:other?.title||'Dependência não encontrada',task:other||null,blocked:[]}
  b.blocked.push(t);blockerMap.set(ref,b)
 }
 const topBlockers=[...blockerMap.values()].sort((a,b)=>b.blocked.length-a.blocked.length)
 const actionRows=pending.map(t=>{
  const issue=enriched.get(t.id)||{},ownerless=!(t.assignees||[]).length
  let severity=10,why='Em acompanhamento'
  if(isLate(t)){severity=100+Math.min(100,issue.overdue||0);why=String(issue.overdue||0)+' dia(s) de atraso'}
  else if(blockedIds.has(t.id)){severity=90;why='Dependência pendente'}
  else if(riskIds.has(t.id)){severity=80;why='Prazo próximo com sinal de atenção'}
  else if(ownerless){severity=70;why='Sem responsável'}
  else if(issue.idle>=14){severity=60;why=issue.idle+' dias sem atualização'}
  else if(issue.age>=31){severity=55;why=issue.age+' dias em aberto'}
  return {task:t,...issue,why,severity}
 }).sort((a,b)=>b.severity-a.severity||(a.task.dueDate||'9999').localeCompare(b.task.dueDate||'9999'))
 const insight=[]
 if(late.length)insight.push({kind:'danger',title:late.length+' demanda(s) fora do prazo',
   description:'Atraso médio de '+String(avgDelay).replace('.',',')+' dia(s). Comece pelas entregas mais antigas.',focus:'late'})
 if(topBlockers.length)insight.push({kind:'violet',
   title:topBlockers[0].blocked.length+' demanda(s) ligadas ao mesmo bloqueio',
   description:'“'+topBlockers[0].label+'” impede o avanço de outras demandas. Revise essa dependência.',focus:'blocked'})
 if(unassigned.length)insight.push({kind:'warning',title:unassigned.length+' demanda(s) sem responsável',
   description:'Atribua um responsável para manter o acompanhamento e reduzir riscos.',focus:'unassigned'})
 if(over14.length)insight.push({kind:'sage',title:over14.length+' demanda(s) com aging acima de 14 dias',
   description:'Revise pendências antigas para evitar acúmulos prolongados.',focus:'aging14'})
 if(!insight.length)insight.push({kind:'sage',title:'Carteira sem alertas críticos pelo critério atual',
   description:'Revise periodicamente as próximas entregas e o aging.',focus:'all'})
 return {today,first,period,source,chosen,pending,done,late,dueSoon,blocked,stale,unassigned,risk,health,
  aging,unknownAging,over14,avgAging,avgDelay,activity:scopedActivities,recentCompletions,
  dueChanges,rescheduled:new Set(dueChanges.map(x=>x.entityId)),proven,onTime,avgCycle,trends,
  owners,teams,bucketStats,topBlockers,actionRows,insight,planById,bucketById,
  openTotal:pending.length,onTimePercent:pct(onTime.length,proven.length),
  onTrackPercent:pct(pending.length-late.length,pending.length),knownAgingCount:ages.length}
}
export function focusTasks(model,focus){
 const sets={
  all:model.pending,late:model.late,blocked:model.blocked,risk:model.risk,stale:model.stale,
  unassigned:model.unassigned,aging14:model.over14,due:model.dueSoon,
  healthy:model.health.find(e=>e.key==='healthy')?.tasks||[],done:model.done
 }
 return sets[focus]||model.pending
}
