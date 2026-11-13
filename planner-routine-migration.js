import { addDays } from './planner-core.js'
import { setTaskRecurrence, taskRecurrence } from './planner-recurrence.js'

const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
  !Number.isNaN(new Date(value+'T12:00:00Z').getTime())&&
  new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value
const weekday=date=>new Date(date+'T12:00:00Z').getUTCDay()
const nextWeekday=(date,day)=>addDays(date,(day-weekday(date)+7)%7)
const compareDates=(a,b)=>a.dueDate.localeCompare(b.dueDate)||a.id.localeCompare(b.id)

export function routineMigrationPlan(routine,tasks=[],today){
  if(!routine?.id||routine.active===false||!validDate(today))return null
  if(!Number.isInteger(routine.weekday)||routine.weekday<0||routine.weekday>6){
    throw new Error('A rotina "'+(routine.title||routine.id)+'" tem dia da semana inválido.')
  }
  const all=(tasks||[]).filter(task=>task.routineId===routine.id&&!task.deleted)
  const adopted=all.find(task=>taskRecurrence(task)?.sourceId===task.id)
  if(adopted)return {mode:'already',routine,template:adopted,legacyCount:all.length}
  const dated=all.filter(task=>validDate(task.dueDate)&&weekday(task.dueDate)===routine.weekday)
  const upcoming=dated.filter(task=>task.dueDate>=today).sort(compareDates)
  const past=dated.filter(task=>task.dueDate<today).sort(compareDates)
  const chosen=upcoming[0]||past.at(-1)||null
  const template=chosen?{...chosen}:{
    id:'legacy_repeat_'+encodeURIComponent(routine.id),
    planId:routine.planId,bucketId:routine.bucketId||'',
    title:routine.title,description:routine.description||'',team:routine.team||'',
    assignees:(routine.assignees||[]).map(p=>({...p})),
    startDate:nextWeekday(validDate(routine.startDate)&&routine.startDate>today
      ?routine.startDate:today,routine.weekday),
    dueDate:nextWeekday(validDate(routine.startDate)&&routine.startDate>today
      ?routine.startDate:today,routine.weekday),
    status:'todo',priority:routine.priority||'normal',
    checklist:(routine.checklist||[]).map(item=>({...item})),
    dependencyIds:[],eventId:'',dateMode:'manual',dueOffsetDays:null,
    routineId:routine.id,deleted:false
  }
  if(template.id.length>200||template.id.includes('/')){
    throw new Error('O identificador desta rotina é longo demais para conversão.')
  }
  // Preserva ID, checklist, situação e responsável da ocorrência escolhida.
  // O modelo da série passa a usar o mesmo dia semanal da rotina original.
  return {
    mode:chosen?'reuse':'create',routine,
    template:setTaskRecurrence(template,{unit:'week',interval:1}),
    legacyCount:all.length
  }
}
