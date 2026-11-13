import { taskRecurrence, recurrenceCycleIndex } from './planner-recurrence.js'

const DAY=86400000
const validDate=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(new Date(value+'T00:00:00Z').getTime()) &&
  new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value
const dayDiff=(a,b)=>Math.round((new Date(b+'T00:00:00Z')-new Date(a+'T00:00:00Z'))/DAY)
const shiftDays=(date,days)=>{
  if(!validDate(date))return ''
  return new Date(new Date(date+'T00:00:00Z').getTime()+days*DAY).toISOString().slice(0,10)
}
const shiftMonths=(date,months)=>{
  if(!validDate(date))return ''
  const original=new Date(date+'T00:00:00Z')
  const next=new Date(Date.UTC(original.getUTCFullYear(),original.getUTCMonth()+months,1))
  const last=new Date(Date.UTC(next.getUTCFullYear(),next.getUTCMonth()+1,0)).getUTCDate()
  next.setUTCDate(Math.min(original.getUTCDate(),last))
  return next.toISOString().slice(0,10)
}
const familyKey=task=>taskRecurrence(task)?.sourceId || (
  typeof task.sourceTaskId==='string' && task.recurrenceId?.startsWith('repeat-v1:')
    ? task.sourceTaskId : ''
)
const occurrenceDate=task=>task.cycleKey || (
  familyKey(task)===task.id ? (taskRecurrence(task)?.anchor||task.dueDate) : task.dueDate
)
function expectedPredecessorDate(reference,dependent){
  const rule=taskRecurrence(dependent)
  if(!rule || !validDate(dependent.cycleKey)||!validDate(occurrenceDate(reference)))return ''
  const n=recurrenceCycleIndex(rule,dependent.cycleKey)
  if(!n)return occurrenceDate(reference)
  if(rule.unit==='month')return shiftMonths(occurrenceDate(reference),n*rule.interval)
  return shiftDays(occurrenceDate(reference),n*rule.interval*(rule.unit==='week'?7:1))
}
function nearestPredecessor(candidates,targetDate,dependentId,maxDays){
  if(!validDate(targetDate))return null
  const feasible=candidates.filter(task=>task.id!==dependentId&&validDate(occurrenceDate(task))
    &&occurrenceDate(task)<=targetDate
    &&dayDiff(occurrenceDate(task),targetDate)<=maxDays)
  feasible.sort((a,b)=>occurrenceDate(b).localeCompare(occurrenceDate(a))||
    a.id.localeCompare(b.id))
  return feasible[0]||null
}

/**
 * Resolve setas pelo ID concreto da ocorrência, nunca somente pelo título.
 *
 * - Demandas antigas e reabertas usam sempre o ID explícito já salvo.
 * - Em ocorrências geradas, dependências herdadas de outra série são
 *   alinhadas pelo ciclo de datas da demanda, não pelo último status.
 * - Não inventa ligação se a ocorrência correspondente não existir.
 * - Não altera os registros no Firestore.
 */
export function resolveGanttDependencies(allTasks,visibleTasks){
  const active=(allTasks||[]).filter(task=>task?.id && !task.deleted)
  const tasks=new Map(active.map(task=>[task.id,task]))
  const shown=new Set((visibleTasks||[]).map(task=>task.id))
  const families=new Map()
  for(const task of active){
    const key=familyKey(task)
    if(!key)continue
    if(!families.has(key))families.set(key,[])
    families.get(key).push(task)
  }
  const links=[],missing=[],outOfView=[]
  const known=new Set()
  for(const dependent of visibleTasks||[]){
    if(!dependent || dependent.deleted)continue
    for(const dependencyId of new Set(dependent.dependencyIds||[])){
      const reference=tasks.get(dependencyId)
      if(!reference){
        missing.push({from:dependencyId,to:dependent.id,reason:'referência indisponível'})
        continue
      }
      let predecessor=reference
      const dependentRule=taskRecurrence(dependent)
      const generated=Boolean(dependentRule&&dependent.sourceTaskId&&
        dependent.sourceTaskId!==dependent.id&&validDate(dependent.cycleKey))
      const predecessorFamily=familyKey(reference)||
        (families.has(reference.id)?reference.id:'')
      if(generated&&predecessorFamily&&reference.id!==dependent.id){
        const candidates=(families.get(predecessorFamily)||[]).filter(task=>
          task.planId===reference.planId&&task.id!==dependent.id)
        if(!candidates.some(task=>task.id===reference.id))candidates.push(reference)
        const origin=tasks.get(dependentRule.sourceId)
        const inherited=origin?.dependencyIds?.includes(dependencyId)
        const expected=inherited?expectedPredecessorDate(reference,dependent):''
        let found=expected
          ? candidates.find(task=>occurrenceDate(task)===expected)
          : null
        const predecessorRule=taskRecurrence(reference)||
          candidates.map(taskRecurrence).find(Boolean)
        const sameCadence=predecessorRule?.unit===dependentRule.unit&&
          predecessorRule?.interval===dependentRule.interval
        if(!found&&(!expected||!sameCadence)){
          // Calendários diferentes permitem aproximação temporal curta.
          // Séries com a MESMA cadência exigem correspondência exata,
          // evitando conectar um ciclo novo à ocorrência antiga.
          const horizon=dependentRule.unit==='month'
            ? 35 : dependentRule.interval*(dependentRule.unit==='week'?7:1)+3
          found=nearestPredecessor(candidates,dependent.cycleKey,dependent.id,horizon)
        }
        if(!found){
          missing.push({from:dependencyId,to:dependent.id,
            reason:'ocorrência correspondente ainda não gerada'})
          continue
        }
        predecessor=found
      }
      if(predecessor.id===dependent.id)continue
      const key=predecessor.id+'→'+dependent.id
      if(known.has(key))continue
      known.add(key)
      const link={from:predecessor.id,to:dependent.id,
        dateAligned:predecessor.id!==dependencyId,
        predecessorDate:occurrenceDate(predecessor)||predecessor.dueDate||'',
        dependentDate:occurrenceDate(dependent)||dependent.dueDate||''}
      if(shown.has(predecessor.id))links.push(link)
      else outOfView.push(link)
    }
  }
  return {links,missing,outOfView}
}
