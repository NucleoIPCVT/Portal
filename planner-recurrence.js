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
  const anchor = sameRule ? previous.anchor : task.dueDate
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

export function nextRecurringTask(task, buckets = []) {
  const rule = taskRecurrence(task)
  if (!rule || task.deleted || task.status !== 'done') return null
  const dueDate = nextRecurrenceDate(task)
  if (!dueDate) throw new Error('Não foi possível calcular a próxima data da repetição.')
  const from = civilDate(task.startDate)
  const previousDue = civilDate(task.dueDate)
  const duration = from ? Math.max(0, Math.round((previousDue - from) / DAY_MS)) : null
  const startDate = duration === null ? '' : iso(new Date(civilDate(dueDate).getTime() - duration * DAY_MS))
  const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  const currentBucket = buckets.find(bucket => bucket.id === task.bucketId)
  const todoBucket = buckets.find(bucket => !bucket.deleted && bucket.planId === task.planId && normalized(bucket.name) === 'a fazer')
  const resetBucket = ['em andamento', 'concluido'].includes(normalized(currentBucket?.name))
  return {
    id: 'repeat_' + encodeURIComponent(rule.sourceId) + '_' + dueDate,
    planId: task.planId, bucketId: resetBucket ? (todoBucket?.id || '') : (task.bucketId || ''),
    title: task.title, description: task.description || '', team: task.team || '',
    assignees: (task.assignees || []).map(person => ({ ...person })),
    startDate, dueDate, status: 'todo', priority: task.priority || 'normal',
    checklist: (task.checklist || []).map(item => ({ ...item, done: false })),
    dependencyIds: [...(task.dependencyIds || [])], eventId: task.eventId || '',
    dateMode: 'manual', dueOffsetDays: null, deleted: false,
    recurrenceId: task.recurrenceId, sourceTaskId: rule.sourceId, cycleKey: dueDate,
  }
}
