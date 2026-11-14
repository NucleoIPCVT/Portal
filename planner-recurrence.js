// The versioned series identifier contains its calendar rule. It uses the
// existing recurrenceId/sourceTaskId/cycleKey fields, so existing Firestore
// permissions and older weekly routines remain compatible.
const DAY_MS = 86400000
const PREFIX = 'repeat-v1'
const UNITS = ['day', 'week', 'month']

function civilDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null
}
function iso(date) {
  const value = Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : ''
  return civilDate(value) ? value : ''
}

export function taskRecurrence(task) {
  const parts = String(task?.recurrenceId || '').split(':')
  if (parts.length !== 5 || parts[0] !== PREFIX || !UNITS.includes(parts[2])) return null
  const interval = Number(parts[3])
  if (!Number.isInteger(interval) || interval < 1 || interval > 999 || !civilDate(parts[4])) return null
  try {
    const sourceId = decodeURIComponent(parts[1])
    if (!sourceId || sourceId.length > 160 || sourceId.includes('/')) return null
    return { sourceId, unit: parts[2], interval, anchor: parts[4] }
  } catch { return null }
}

export function setTaskRecurrence(task, rule = null) {
  if (!rule) return { ...task, recurrenceId: '', recurrence: null }
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 999 || !UNITS.includes(rule.unit)) {
    throw new Error('Escolha um número inteiro de 1 a 999 e a unidade da repetição.')
  }
  if (!civilDate(task.dueDate)) throw new Error('Informe a data de entrega para repetir esta demanda.')
  if (task.dateMode === 'event') throw new Error('Defina uma data de entrega manual para repetir esta demanda.')
  const previous = taskRecurrence(task)
  const sameRule = previous?.unit === rule.unit && previous.interval === rule.interval
  const sourceId = previous?.sourceId || task.id
  const anchor = sameRule && !rule.resetAnchor ? previous.anchor : task.dueDate
  const recurrenceId = [PREFIX, encodeURIComponent(sourceId), rule.unit, rule.interval, anchor].join(':')
  if (!sourceId || sourceId.length > 160 || sourceId.includes('/') || recurrenceId.length > 200) {
    throw new Error('Não foi possível identificar esta repetição. Crie uma nova demanda.')
  }
  return { ...task, recurrenceId, recurrence: null }
}

export function recurrenceLabel(task) {
  const rule = taskRecurrence(task)
  if (!rule) return ''
  const unit = { day: ['dia', 'dias'], week: ['semana', 'semanas'], month: ['mês', 'meses'] }[rule.unit]
  return 'A cada ' + rule.interval + ' ' + unit[rule.interval === 1 ? 0 : 1]
}

export function nextRecurrenceDate(task) {
  const rule = taskRecurrence(task)
  const current = civilDate(task?.dueDate)
  if (!rule || !current) return ''
  const anchor = civilDate(rule.anchor)
  if (rule.unit !== 'month') {
    const step = rule.interval * (rule.unit === 'week' ? 7 : 1)
    const index = Math.max(1, Math.floor((current - anchor) / DAY_MS / step) + 1)
    const next = new Date(anchor.getTime() + index * step * DAY_MS)
    return iso(next)
  }
  const elapsed = (current.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + current.getUTCMonth() - anchor.getUTCMonth()
  let index = Math.max(1, Math.floor(elapsed / rule.interval))
  for (let attempt = 0; attempt < 2; attempt++, index++) {
    const next = new Date(anchor)
    next.setUTCDate(1)
    next.setUTCMonth(anchor.getUTCMonth() + index * rule.interval)
    const end = new Date(next)
    end.setUTCMonth(end.getUTCMonth() + 1)
    end.setUTCDate(0)
    next.setUTCDate(Math.min(anchor.getUTCDate(), end.getUTCDate()))
    if (next > current) return iso(next)
  }
  return ''
}


/* Rotação v1: configurações armazenadas em uma demanda técnica, marcada como
 * excluída. Somente campos já admitidos pelo Firestore da Comissão são usados.
 * Cada ocorrência visível recebe exclusivamente os seus responsáveis. */
export const ROTATION_PREFIX = 'rotation_v1_'
const ROTATION_KEY = 'rotation-v1'
const ROTATION_MODES = ['fixed', 'individual', 'groups']
const ROTATION_ADVANCE = ['completion', 'scheduled']

export function rotationConfigId(sourceId) {
  const id = ROTATION_PREFIX + encodeURIComponent(String(sourceId || ''))
  if (!sourceId || id.length > 200 || id.includes('/')) throw new Error('Identificador de rodízio inválido.')
  return id
}

export function parseRotationConfig(record) {
  if (!record?.deleted || !String(record.id || '').startsWith(ROTATION_PREFIX)) return null
  const parts = String(record.templateKey || '').split(':')
  if (parts.length !== 4 || parts[0] !== ROTATION_KEY
    || !ROTATION_MODES.includes(parts[1]) || !ROTATION_ADVANCE.includes(parts[2])) return null
  const people = Array.isArray(record.assignees) ? record.assignees : []
  const groups = parts[3] ? parts[3].split(',').map(Number) : []
  if (people.length > 10 || groups.length !== people.length ||
    groups.some(n => !Number.isInteger(n) || n < -1 || n > 9)) return null
  return {
    id: record.id, sourceId: record.sourceTaskId || '',
    templateId: record.routineId || record.sourceTaskId || '',
    mode: parts[1], advance: parts[2],
    people: people.map(person => ({name:person.name || '',email:person.email || ''})),
    groups
  }
}

export function rotationConfigRecord(task, settings) {
  const rule = taskRecurrence(task)
  // Em um plano recorrente, a configuração do rodízio pertence à família
  // da demanda, mesmo quando a demanda não possui repetição própria.
  const sourceId=rule?.sourceId||settings?.sourceId
  if (!sourceId) throw new Error('Ative a repetição ou vincule a um plano recorrente antes de configurar o rodízio.')
  const { mode, advance } = settings || {}
  const people = settings?.people || []
  if (!ROTATION_MODES.includes(mode) || !ROTATION_ADVANCE.includes(advance)) throw new Error('Tipo de rodízio inválido.')
  if (!Array.isArray(people) || people.length > 10 || people.some(person => !person
      || typeof person.name !== 'string' || typeof person.email !== 'string'
      || person.name.length > 120 || person.email.length > 254
      || !String(person.name || person.email).trim())) {
    throw new Error('Selecione até 10 pessoas válidas para o rodízio.')
  }
  if (mode !== 'fixed' && people.length < 2) throw new Error('Adicione pelo menos duas pessoas para alternar os responsáveis.')
  const groups = mode === 'groups' ? settings.groups : people.map((_,i) => i)
  if (!Array.isArray(groups) || groups.length !== people.length ||
    groups.some(n => !Number.isInteger(n) || n < -1 || n > 9)) {
    throw new Error('Defina um grupo para cada participante.')
  }
  if (mode === 'groups' && new Set(groups.filter(n => n >= 0)).size < 2) throw new Error('Configure ao menos dois grupos para o rodízio.')
  if (mode === 'individual' && groups.filter(n => n >= 0).length < 2) throw new Error('Escolha pelo menos duas pessoas que se alternam.')
  const templateKey = [ROTATION_KEY,mode,advance,groups.join(',')].join(':')
  return {
    id: rotationConfigId(sourceId),
    planId: task.planId, bucketId: task.bucketId || '',
    title: 'Configuração interna de rodízio', description: '', team: task.team || '',
    assignees: people.map(person => ({ name: person.name, email: person.email })),
    startDate:'',dueDate:'',status:'todo',priority:'normal',checklist:[],
    dependencyIds:[],eventId:'',dateMode:'manual',dueOffsetDays:null,
    sourceTaskId:sourceId,routineId:task.id,templateKey,
    recurrenceId:'',cycleKey:'',deleted:true
  }
}

export function recurrenceDateAt(rule,index) {
  if (!rule || !Number.isInteger(index) || index < 0 || !civilDate(rule.anchor)) return ''
  const anchor = civilDate(rule.anchor)
  if (rule.unit === 'day' || rule.unit === 'week') {
    return iso(new Date(anchor.getTime() + index * rule.interval * (rule.unit === 'week' ? 7 : 1) * DAY_MS))
  }
  const date = new Date(anchor)
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + index * rule.interval)
  const end = new Date(date)
  end.setUTCMonth(end.getUTCMonth() + 1)
  end.setUTCDate(0)
  date.setUTCDate(Math.min(anchor.getUTCDate(),end.getUTCDate()))
  return iso(date)
}

export function recurrenceCycleIndex(rule,date) {
  const anchor = civilDate(rule?.anchor)
  const current = civilDate(date)
  if (!anchor || !current || !rule.interval) return 0
  if (rule.unit !== 'month') {
    const days=(current-anchor)/DAY_MS
    return Math.max(0,Math.round(days/(rule.interval*(rule.unit === 'week'?7:1))))
  }
  const months=(current.getUTCFullYear()-anchor.getUTCFullYear())*12
    +current.getUTCMonth()-anchor.getUTCMonth()
  return Math.max(0,Math.round(months/rule.interval))
}

export function rotationAssigneesForDate(task,config,dueDate) {
  const rule=taskRecurrence(task)
  return rotationAssigneesAtIndex(task,config,recurrenceCycleIndex(rule,dueDate))
}

export function rotationAssigneesAtIndex(task,config,cycle=0) {
  const people=config?.people || task.assignees || []
  if (!config || config.mode === 'fixed')return people.map(person=>({...person}))
  const fixed=people.filter((_,index)=>config.groups[index]===-1)
  if (config.mode === 'individual'){
    const rotating=people.filter((_,index)=>config.groups[index]!==-1)
    return [...fixed,...(rotating.length?[rotating[cycle%rotating.length]]:[])].map(person=>({...person}))
  }
  const groups=[...new Set((config.groups || []).filter(value=>value>=0))]
  const selected=groups.length?groups[cycle%groups.length]:-2
  return people.filter((_,index)=>config.groups[index]===-1||config.groups[index]===selected).map(person=>({...person}))
}

export function recurrenceOccurrenceAt(task,dueDate,config=null,buckets=[]) {
  const rule=taskRecurrence(task)
  const target=civilDate(dueDate)
  const previous=civilDate(task?.dueDate)
  if (!rule || !target || !previous) return null
  const from=civilDate(task.startDate)
  const duration=from?Math.max(0,Math.round((previous-from)/DAY_MS)):null
  const startDate=duration===null?'':iso(new Date(target.getTime()-duration*DAY_MS))
  const normalized=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()
  const currentBucket=buckets.find(bucket=>bucket.id===task.bucketId)
  const todoBucket=buckets.find(bucket=>!bucket.deleted&&bucket.planId===task.planId&&normalized(bucket.name)==='a fazer')
  const resetBucket=['em andamento','concluido'].includes(normalized(currentBucket?.name))
  return {
    id:'repeat_'+encodeURIComponent(rule.sourceId)+'_'+dueDate,
    planId:task.planId,bucketId:resetBucket?(todoBucket?.id||''):(task.bucketId||''),
    title:task.title,description:task.description||'',team:task.team||'',
    assignees:rotationAssigneesForDate(task,config,dueDate),
    startDate,dueDate,status:'todo',priority:task.priority||'normal',
    checklist:(task.checklist||[]).map(item=>({...item,done:false})),
    dependencyIds:[...(task.dependencyIds||[])],eventId:task.eventId||'',
    dateMode:'manual',dueOffsetDays:null,deleted:false,
    recurrenceId:task.recurrenceId,sourceTaskId:rule.sourceId,cycleKey:dueDate
  }
}

export function scheduledUpcomingDates(task,today,count=4) {
  const rule=taskRecurrence(task)
  const start=civilDate(today)
  if (!rule || !start || count < 1) return []
  const approx=recurrenceCycleIndex(rule,today)
  const results=[]
  // Three corrections around a monthly boundary are sufficient even for the 31st.
  let index=Math.max(0,approx-2)
  for(let attempts=0;attempts<Math.min(count+16,36)&&results.length<count;attempts++,index++){
    const dueDate=recurrenceDateAt(rule,index)
    if(dueDate>=today && dueDate!==task.dueDate && (civilDate(dueDate)-start)<=366*DAY_MS)results.push(dueDate)
    if(dueDate && (civilDate(dueDate)-start)>366*DAY_MS)break
  }
  return results
}

export function nextRecurringTask(task,buckets=[],config=null) {
  const rule=taskRecurrence(task)
  if (!rule || task.deleted || task.status!=='done' || config?.advance==='scheduled')return null
  const next=nextRecurrenceDate(task)
  if (!next)throw new Error('Não foi possível calcular a próxima data da repetição.')
  return recurrenceOccurrenceAt(task,next,config,buckets)
}
