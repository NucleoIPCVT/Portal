export const BOARD_GROUPINGS = [
  ['status', 'Situação'], ['plan', 'Plano'], ['event', 'Evento-alvo'],
  ['team', 'Equipe'], ['priority', 'Prioridade'], ['assignee', 'Responsável'], ['bucket', 'Etapa (bucket)']
]

const compare = (a, b) => a.label.localeCompare(b.label, 'pt-BR')
const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
export const personKey = person => person.email?.trim().toLowerCase() || normalized(person.name)
export function boardTaskStatus(task, buckets = []) {
  const bucket = buckets.find(item => item.id === task.bucketId && !item.deleted && item.planId === task.planId)
  return task.status !== 'done' && normalized(bucket?.name) === 'em revisao' ? 'review' : task.status
}

export function groupBoardTasks({ grouping = 'status', tasks = [], plans = [], buckets = [], events = [], teams = [], planId = '', eventId = '' } = {}) {
  const activePlans = plans.filter(plan => !plan.deleted && (!planId || plan.id === planId))
  const group = (id, label, entries, defaults = {}, tone = '') => ({ id, label, tasks: entries, defaults, tone })
  if (grouping === 'plan') return activePlans.map(plan => group(plan.id, plan.name, tasks.filter(task => task.planId === plan.id), { planId: plan.id })).sort(compare)
  if (grouping === 'priority') return [['urgent', 'Urgente'], ['high', 'Alta'], ['normal', 'Normal'], ['low', 'Baixa']]
    .map(([id, label]) => group(id, label, tasks.filter(task => (task.priority || 'normal') === id), { priority: id }, id))
  if (grouping === 'team') return [...new Set([...teams, ...tasks.map(task => task.team)].filter(Boolean))]
    .map(team => group(team, team, tasks.filter(task => task.team === team), { team })).sort(compare)
    .concat(group('', 'Sem equipe', tasks.filter(task => !task.team), { team: '' }))
  if (grouping === 'event') {
    const ids = new Set(tasks.map(task => task.eventId).filter(Boolean))
    if (eventId && eventId !== '__independent__') ids.add(eventId)
    return [...ids].map(id => group(id, events.find(event => event.id === id)?.title || 'Evento indisponível', tasks.filter(task => task.eventId === id), { eventId: id })).sort(compare)
      .concat(group('', 'Sem evento-alvo', tasks.filter(task => !task.eventId), { eventId: '' }))
  }
  if (grouping === 'assignee') {
    const people = new Map()
    for (const task of tasks) for (const person of task.assignees || []) if (personKey(person)) people.set(personKey(person), person)
    return [...people].map(([id, person]) => group(id, person.name || person.email, tasks.filter(task => task.assignees?.some(item => personKey(item) === id)), { assignees: [{ ...person }] })).sort(compare)
      .concat(group('', 'Sem responsável', tasks.filter(task => !task.assignees?.some(personKey)), { assignees: [] }))
  }
  if (grouping === 'bucket') {
    const visible = buckets.filter(bucket => !bucket.deleted && activePlans.some(plan => plan.id === bucket.planId)).sort((a, b) => a.order - b.order)
    return visible.map(bucket => group(bucket.id, (activePlans.length > 1 ? activePlans.find(plan => plan.id === bucket.planId).name + ' · ' : '') + bucket.name,
      tasks.filter(task => task.bucketId === bucket.id), { planId: bucket.planId, bucketId: bucket.id }))
      .concat(group('', 'Sem etapa', tasks.filter(task => !visible.some(bucket => bucket.id === task.bucketId)), { bucketId: '' }))
  }
  return [['todo', 'A Fazer'], ['doing', 'Em Andamento'], ['review', 'Em Revisão'], ['done', 'Concluído']]
    .map(([id, label]) => group(id, label, tasks.filter(task => boardTaskStatus(task, buckets) === id), { status: id === 'review' ? 'doing' : id }, id))
}

export function moveBoardTask(task, grouping, target, { plans = [], buckets = [], tasks = [], fromGroup = '' } = {}) {
  let next = { ...task }
  const movePlan = planId => {
    if (!plans.some(plan => plan.id === planId && !plan.deleted)) throw new Error('Este plano não está mais disponível.')
    if (planId === task.planId) return
    if (task.dependencyIds?.length || tasks.some(item => !item.deleted && item.dependencyIds?.includes(task.id))) {
      throw new Error('Esta demanda tem dependências. Ajuste os vínculos antes de movê-la para outro plano.')
    }
    const oldBucket = buckets.find(bucket => bucket.id === task.bucketId)
    const available = buckets.filter(bucket => !bucket.deleted && bucket.planId === planId)
    const standard = { todo: 'a fazer', doing: 'em andamento', done: 'concluido' }[task.status]
    const bucket = available.find(item => normalized(item.name) === normalized(oldBucket?.name))
      || available.find(item => normalized(item.name) === standard)
    next = { ...next, planId, bucketId: bucket?.id || '' }
  }
  if (grouping === 'plan') movePlan(target.id)
  else if (grouping === 'team') next.team = target.id
  else if (grouping === 'priority') next.priority = target.id
  else if (grouping === 'event') {
    if (task.dateMode === 'event' && task.eventId !== target.id) throw new Error('Esta demanda usa prazo relativo ao evento. Abra seus detalhes para alterar o evento-alvo.')
    next.eventId = target.id
  } else if (grouping === 'assignee') {
    const remaining = (task.assignees || []).filter(person => personKey(person) !== fromGroup)
    next.assignees = !target.id ? [] : remaining.some(person => personKey(person) === target.id) ? remaining : [...remaining, ...target.defaults.assignees]
  } else if (grouping === 'bucket') {
    if (target.id) movePlan(target.defaults.planId)
    next.bucketId = target.id
    const bucket = buckets.find(item => item.id === target.id)
    const status = { 'a fazer': 'todo', 'em andamento': 'doing', 'concluido': 'done', 'em revisao': 'doing' }[normalized(bucket?.name)]
    if (status) next.status = status
  }
  return next
}
