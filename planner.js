import { createPlannerStore } from './planner-store.js'
import { todayISO, addDays, formatDate, calendarCells, computeSummary, validateTask, isOverdue, taskProgress, generateWeeklyTasks, eventPreparationTasks } from './planner-core.js'
import { GoogleCalendarClient } from './planner-google.js'
import { publicCalendar, readPublicCalendar, hasDirectGoogleAccess, parseCalendarSourceUrl, calendarWebUrl, summarizeCalendarEvents, diffCalendarEvents } from './planner-public.js?v=20261110'

const $ = id => document.getElementById(id)
const labels = { todo: 'Não iniciada', doing: 'Em andamento', done: 'Concluída', low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente' }
const teams = ['Louvor', 'Litúrgico', 'Técnica', 'Mídia', 'Comunicação', 'Comissão']
let state = { plans: [], buckets: [], tasks: [], events: [], routines: [] }
let session = { status: 'checking' }
// A agenda oficial é a porta de entrada para a maior parte do trabalho da igreja.
let currentView = 'events'
let eventsYear = Number(todayISO().slice(0, 4))
let calendarDate = todayISO()
let calendarMode = 'month'
let googleClient = null
let googleCalendars = []
const calendarSelection = new Set()
let draggedTask = ''
let importBusy = false
const integrationRange = { from: addDays(todayISO(), -30), to: addDays(todayISO(), 180) }
let authEpoch = 0
let calendarConfig = { calendarId: publicCalendar.id, sourceUrl: publicCalendar.sourceUrl }
let calendarConfigError = ''
let publicSnapshot = null
let publicEvents = []
let calendarLoadError = ''
let calendarFetching = false
let calendarTimer = null
let calendarLastLoad = 0
let calendarUnread = []

function node(tag, attrs = {}, children = []) {
  const element = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue
    if (key === 'class') element.className = value
    else if (key === 'text') element.textContent = value
    else if (key.startsWith('on')) element.addEventListener(key.slice(2).toLowerCase(), value)
    else if (key in element && !key.startsWith('aria-') && !key.startsWith('data-')) element[key] = value
    else element.setAttribute(key, value)
  }
  for (const child of [children].flat(Infinity)) if (child !== null && child !== undefined) element.append(child instanceof Node ? child : document.createTextNode(String(child)))
  return element
}
const button = (text, handler, cls = 'button') => node('button', { type: 'button', class: cls, text, onClick: handler })
const activePlans = () => state.plans.filter(plan => !plan.deleted)
const planName = id => state.plans.find(plan => plan.id === id)?.name || 'Plano'
const bucketName = id => state.buckets.find(bucket => bucket.id === id)?.name || 'Sem bucket'
function liveTasks() {
  const visible = state.tasks.filter(task => !task.deleted && activePlans().some(plan => plan.id === task.planId))
  if (!publicSnapshot) return visible
  const events = new Map(liveEvents().map(event => [event.id, event]))
  return visible.map(task => {
    if (task.dateMode !== 'event' || !/^[0-9a-f]{64}$/.test(task.eventId || '')) return task
    const linked = events.get(task.eventId)
    if (!linked || linked.status === 'cancelled') return { ...task, reviewRequired: true, reviewReason: 'O evento oficial foi removido da agenda. Confira esta demanda.' }
    const expected = addDays(linked.startDate, Number(task.dueOffsetDays || 0))
    return expected !== task.dueDate
      ? { ...task, reviewRequired: true, reviewReason: 'O evento oficial mudou de data. Confira o prazo desta demanda.' }
      : task
  })
}
function liveEvents() {
  const linked = new Set(state.tasks.filter(task => !task.deleted).map(task => task.eventId).filter(Boolean))
  const items = state.events.filter(event => {
    if (event.deleted) return false
    if (!event.sourceKey?.startsWith('public-ical:')) return true
    if (event.sourceCalendarId !== calendarConfig.calendarId) return linked.has(event.id)
    return !publicSnapshot || linked.has(event.id) || publicEvents.some(item => item.id === event.id)
  })
  const mapped = new Map(items.map(event => [event.id, event]))
  if (publicSnapshot?.calendarId === calendarConfig.calendarId) {
    const activeIds = new Set(publicEvents.map(event => event.id))
    for (const event of publicEvents) {
      if (state.events.some(stored => stored.id === event.id && stored.deleted)) continue
      mapped.set(event.id, { ...(mapped.get(event.id) || {}), ...event })
    }
    for (const event of items) {
      if (event.sourceKey?.startsWith('public-ical:') && event.sourceCalendarId === calendarConfig.calendarId
        && !activeIds.has(event.id) && linked.has(event.id)) {
        mapped.set(event.id, { ...event, status: 'cancelled' })
      }
    }
  }
  return [...mapped.values()]
}
const byId = (kind, id) => state[kind].find(item => item.id === id)
const newId = () => crypto.randomUUID()
const value = id => $(id).value.trim()

function notice(message, error = false) {
  $('notice').textContent = message
  $('notice').hidden = !message
  $('notice').classList.toggle('error', error)
}
function reportError(error) {
  notice(error?.code === 'permission-denied'
    ? 'O acesso aos dados foi negado. A coordenação precisa conferir as regras do Planner no Firebase.'
    : error?.message || 'Não foi possível concluir. Tente novamente.', true)
}
async function action(work, success = '') {
  $('save-status').textContent = 'Salvando…'
  try {
    const result = await work()
    $('save-status').textContent = 'Salvo'
    if (success) notice(success)
    return result
  } catch (error) {
    $('save-status').textContent = 'Não foi salvo'
    reportError(error)
    throw error
  }
}
function save(kind, item) {
  return store.save(kind, item, item.version === undefined ? {} : { expectedVersion: item.version })
}
function selectedPlan() { return value('plan-filter') }
function setOptions(select, items, current = select.value, first = null) {
  const options = first ? [node('option', { value: first[0], text: first[1] })] : []
  select.replaceChildren(...options, ...items.map(item => node('option', { value: item[0], text: item[1] })))
  select.value = [...select.options].some(option => option.value === current) ? current : first ? first[0] : items[0]?.[0] || ''
}
function refreshFilters() {
  setOptions($('plan-filter'), activePlans().map(plan => [plan.id, plan.name]), $('plan-filter').value, ['', 'Todos os planos'])
  setOptions($('team-filter'), [...new Set([...teams, ...liveTasks().map(task => task.team).filter(Boolean)])].sort().map(team => [team, team]), $('team-filter').value, ['', 'Todas as equipes'])
  setOptions($('event-filter'), [['__independent__', 'Sem evento vinculado'], ...liveEvents().sort((a, b) => a.startDate.localeCompare(b.startDate)).map(event => [event.id, event.title + ' · ' + formatDate(event.startDate)])], $('event-filter').value, ['', 'Todas as demandas'])
  const people = new Map()
  for (const task of liveTasks()) for (const person of task.assignees || []) people.set(person.email || person.name, person.name || person.email)
  setOptions($('assignee-filter'), [['__mine__', 'Minhas tarefas'], ...[...people].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))], $('assignee-filter').value, ['', 'Todos os responsáveis'])
}
function visibleTasks() {
  const query = value('search-filter').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const person = value('assignee-filter')
  const eventTitles = new Map(liveEvents().map(event => [event.id, event.title]))
  return liveTasks().filter(task =>
    (!selectedPlan() || task.planId === selectedPlan()) &&
    (!value('team-filter') || task.team === value('team-filter')) &&
    (!value('status-filter') || task.status === value('status-filter')) &&
    (!value('event-filter') || (value('event-filter') === '__independent__' ? !task.eventId : task.eventId === value('event-filter'))) &&
    (!person || (task.assignees || []).some(assignee => person === '__mine__' ? assignee.email?.toLowerCase() === session.email : (assignee.email || assignee.name) === person)) &&
    (!query || [task.title, task.description, task.team, planName(task.planId), eventTitles.get(task.eventId) || '', ...(task.assignees || []).map(person => person.name || person.email)].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(query))
  ).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.title.localeCompare(b.title, 'pt-BR'))
}
function visibleEvents() {
  if (value('event-filter') === '__independent__') return []
  const linked = new Set(liveTasks().filter(task => !selectedPlan() || task.planId === selectedPlan()).map(task => task.eventId).filter(Boolean))
  const allLinked = new Set(liveTasks().map(task => task.eventId).filter(Boolean))
  return liveEvents().filter(event => (!value('event-filter') || event.id === value('event-filter')) && (!selectedPlan() || linked.has(event.id) || !allLinked.has(event.id)))
}
function requirePlan() {
  if (activePlans().length) return true
  notice('Crie um plano para organizar suas primeiras demandas.')
  openPlan()
  return false
}

// Os planos operacionais só são criados por uma ação explícita do integrante.
// Não alteramos nem duplicamos os eventos do Google Agenda.
async function ensureWorkPlan(category) {
  const result = await store.ensureStandardPlan(category)
  if (!state.plans.some(plan => plan.id === result.plan.id)) state.plans = [...state.plans, result.plan]
  if (!state.buckets.some(bucket => bucket.id === result.bucket.id)) state.buckets = [...state.buckets, result.bucket]
  return result
}

async function openIndependentTask() {
  try {
    const existing = activePlans().find(plan => plan.id === 'ipcvt-demandas-independentes')
    const result = existing
      ? { plan: existing, bucket: state.buckets.find(bucket => bucket.planId === existing.id && !bucket.deleted) }
      : await action(() => ensureWorkPlan('independent'))
    openTask(null, { planId: result.plan.id, bucketId: result.bucket?.id || '', eventId: '', dateMode: 'manual', dueOffsetDays: null })
  } catch (error) { reportError(error) }
}

async function openEventTask(event) {
  if (!event || event.status === 'cancelled' || !event.startDate) return notice('Esse evento não está disponível para novas demandas.', true)
  try {
    const selected = activePlans().find(plan => plan.id === selectedPlan())
    const result = selected
      ? { plan: selected, bucket: state.buckets.find(bucket => bucket.planId === selected.id && !bucket.deleted) }
      : await action(() => ensureWorkPlan('events'))
    const dueDate = addDays(event.startDate, -14)
    openTask(null, { planId: result.plan.id, bucketId: result.bucket?.id || '', eventId: event.id, dateMode: 'event', dueOffsetDays: -14, dueDate, startDate: dueDate })
  } catch (error) { reportError(error) }
}
function parseAssignees(text) {
  const seen = new Set()
  return text.split(/\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const match = line.match(/^(.*?)\s*<([^<>]+)>$/)
    const email = (match ? match[2] : line.includes('@') ? line : '').trim().toLowerCase()
    const name = (match ? match[1] : line.includes('@') ? line.split('@')[0] : line).trim()
    if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new Error('Confira o e-mail de um dos responsáveis.')
    if (name.length > 120 || email.length > 254) throw new Error('O nome ou e-mail do responsável é muito longo.')
    return { name: name || email, email }
  }).filter(person => {
    const key = person.email || person.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
const assigneeText = list => (list || []).map(person => person.email ? (person.name || person.email) + ' <' + person.email + '>' : person.name).join('\n')
function confirmAction(title, message) {
  const dialog = $('confirm-dialog')
  $('confirm-title').textContent = title
  $('confirm-message').textContent = message
  dialog.returnValue = ''
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true })
    dialog.showModal()
  })
}
$('confirm-cancel').addEventListener('click', () => $('confirm-dialog').close('cancel'))
$('confirm-accept').addEventListener('click', () => $('confirm-dialog').close('confirm'))
document.querySelectorAll('[data-close-dialog]').forEach(control => control.addEventListener('click', () => $(control.dataset.closeDialog).close()))
document.querySelectorAll('.editor-dialog').forEach(dialog => dialog.addEventListener('close', () => {
  if (session.status === 'authorized') $('new-task-button').focus({ preventScroll: true })
}))

function taskCard(task) {
  const card = node('article', { class: 'task-card' + (task.status === 'done' ? ' done' : '') + (isOverdue(task, todayISO()) ? ' overdue' : ''), draggable: true, 'data-task-id': task.id })
  const title = button(task.title, () => openTask(task), 'task-title')
  const toggle = node('input', { type: 'checkbox', checked: task.status === 'done', 'aria-label': 'Concluir ' + task.title,
    onChange: async event => {
      try { await action(() => save('tasks', { ...task, status: event.target.checked ? 'done' : 'todo' })) }
      catch { event.target.checked = task.status === 'done' }
    } })
  card.append(node('div', { class: 'task-heading' }, [toggle, title]))
  if (!selectedPlan()) card.append(node('span', { class: 'task-label', text: planName(task.planId) }))
  card.append(node('div', { class: 'task-meta' }, [
    node('span', { class: 'badge', text: task.team || 'Sem equipe' }),
    node('span', { class: 'priority priority-' + task.priority, text: labels[task.priority] || 'Normal' }),
    node('span', { text: task.dueDate ? formatDate(task.dueDate) : 'Sem prazo' })
  ]))
  if (task.assignees?.length) card.append(node('p', { class: 'muted', text: task.assignees.map(person => person.name || person.email).join(', ') }))
  else card.append(button('Adicionar responsável', () => openTask(task), 'button button-small'))
  if (task.reviewRequired) card.append(node('span', { class: 'badge review-badge', title: task.reviewReason || '', text: 'Revisar prazo' }))
  if (task.checklist?.length) card.append(node('span', { class: 'muted', text: task.checklist.filter(item => item.done).length + '/' + task.checklist.length + ' itens · ' + taskProgress(task) + '%' }))
  if (task.eventId) card.append(node('span', { class: 'task-label', text: liveEvents().find(item => item.id === task.eventId)?.title || 'Evento vinculado' }))
  const unmet = (task.dependencyIds || []).filter(id => byId('tasks', id)?.status !== 'done')
  if (unmet.length) card.append(node('span', { class: 'badge', text: unmet.length + ' dependência(s) pendente(s)' }))
  card.addEventListener('dragstart', event => { draggedTask = task.id; event.dataTransfer.setData('text/plain', task.id); event.dataTransfer.effectAllowed = 'move' })
  card.addEventListener('dragend', () => { draggedTask = '' })
  return card
}
function viewActions() {
  const toolbar = node('div', { class: 'view-actions' })
  if (selectedPlan()) toolbar.append(button('Editar plano e buckets', () => openPlan(byId('plans', selectedPlan()))))
  return toolbar
}
function renderBoard(content, tasks) {
  const grid = node('div', { class: 'board-grid' })
  const plans = activePlans().filter(plan => (!selectedPlan() || plan.id === selectedPlan())
    && (!value('event-filter') || tasks.some(task => task.planId === plan.id)))
  for (const plan of plans) {
    const buckets = state.buckets.filter(bucket => bucket.planId === plan.id && !bucket.deleted).sort((a, b) => a.order - b.order)
    const groups = [...buckets]
    if (tasks.some(task => task.planId === plan.id && !buckets.some(bucket => bucket.id === task.bucketId)) || !groups.length) groups.push({ id: '', name: 'Sem bucket', planId: plan.id })
    for (const bucket of groups) {
      const entries = tasks.filter(task => task.planId === plan.id && (bucket.id ? task.bucketId === bucket.id : !buckets.some(item => item.id === task.bucketId)))
      const column = node('section', { class: 'bucket-column', 'data-bucket-id': bucket.id, 'aria-label': bucket.name })
      column.append(node('div', { class: 'bucket-heading' }, [node('h3', { text: bucket.name }), node('span', { class: 'badge', text: entries.length })]))
      if (!selectedPlan()) column.append(node('p', { class: 'muted', text: plan.name }))
      column.append(...entries.map(taskCard), button('+ Adicionar demanda', () => openTask(null, { planId: plan.id, bucketId: bucket.id }), 'button button-small'))
      column.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' })
      column.addEventListener('drop', async event => {
        event.preventDefault()
        const task = byId('tasks', event.dataTransfer.getData('text/plain') || draggedTask)
        if (!task) return
        if (task.planId !== plan.id) return notice('Para mover entre planos, abra a demanda e altere o plano.')
        try { await action(() => save('tasks', { ...task, bucketId: bucket.id })) } catch {}
      })
      grid.append(column)
    }
  }
  content.append(viewActions(), grid)
  if (!tasks.length) content.append(node('p', { class: 'muted', text: 'Nenhuma demanda com estes filtros. Você pode criar uma demanda em qualquer bucket.' }))
}
function renderList(content, tasks) {
  const table = node('table', { class: 'data-table' })
  table.append(node('thead', {}, node('tr', {}, ['Demanda', 'Plano / Bucket', 'Responsáveis', 'Equipe', 'Prazo', 'Andamento', 'Ações'].map(text => node('th', { scope: 'col', text })))))
  table.append(node('tbody', {}, tasks.map(task => node('tr', {}, [
    node('td', {}, button(task.title, () => openTask(task), 'task-title')),
    node('td', { text: planName(task.planId) + ' / ' + bucketName(task.bucketId) }),
    node('td', { text: task.assignees?.map(person => person.name || person.email).join(', ') || 'Sem responsável' }),
    node('td', { text: task.team || '—' }),
    node('td', { class: isOverdue(task, todayISO()) ? 'overdue' : '', text: formatDate(task.dueDate) }),
    node('td', { text: labels[task.status] }),
    node('td', {}, [button('Editar', () => openTask(task), 'button button-small'), button('Excluir', () => deleteTask(task), 'button button-small button-danger')])
  ]))))
  content.append(viewActions(), node('div', { class: 'table-wrap' }, table))
  if (!tasks.length) content.append(empty('Nenhuma demanda encontrada.'))
}
function empty(text) { return node('div', { class: 'empty-state', text }) }
function dayDiff(a, b) { return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000) }
function calendarDates() {
  if (calendarMode === 'month') return calendarCells(calendarDate.slice(0, 7))
  const day = new Date(calendarDate + 'T12:00:00Z').getUTCDay()
  const monday = addDays(calendarDate, -((day + 6) % 7))
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index))
}
function renderCalendar(content, tasks) {
  const header = node('div', { class: 'view-actions' })
  const navigate = direction => {
    if (calendarMode === 'week') calendarDate = addDays(calendarDate, direction * 7)
    else {
      const date = new Date(calendarDate.slice(0, 7) + '-01T12:00:00Z')
      date.setUTCMonth(date.getUTCMonth() + direction)
      calendarDate = date.toISOString().slice(0, 10)
    }
    render()
  }
  const title = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(calendarDate + 'T12:00:00Z'))
  const mode = node('select', { 'aria-label': 'Período do calendário', onChange: event => { calendarMode = event.target.value; render() } }, [
    node('option', { value: 'month', text: 'Mês', selected: calendarMode === 'month' }),
    node('option', { value: 'week', text: 'Semana', selected: calendarMode === 'week' })
  ])
  header.append(button('← Anterior', () => navigate(-1)), node('strong', { text: title }), button('Próximo →', () => navigate(1)), button('Hoje', () => { calendarDate = todayISO(); render() }), mode, button('+ Evento', () => openEvent()))
  const grid = node('div', { class: 'calendar-grid' })
  grid.append(...['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(text => node('div', { class: 'calendar-weekday', text })))
  const events = visibleEvents()
  for (const date of calendarDates()) {
    const day = node('section', { class: 'calendar-day' + (date.slice(0, 7) !== calendarDate.slice(0, 7) ? ' other-month' : '') + (date === todayISO() ? ' today' : ''), 'aria-label': formatDate(date), 'data-calendar-date': date })
    day.append(button(String(Number(date.slice(-2))), () => { if (requirePlan()) openTask(null, { dueDate: date, startDate: date }) }, 'calendar-date'))
    for (const event of events.filter(item => item.startDate <= date && (item.endDate || item.startDate) >= date)) {
      day.append(button((event.status === 'cancelled' ? 'Cancelado · ' : '') + event.title, () => openEvent(event), 'calendar-event' + (event.status === 'cancelled' ? ' cancelled' : '')))
    }
    for (const task of tasks.filter(item => (item.dueDate || item.startDate) === date)) {
      const entry = button(task.title, () => openTask(task), 'calendar-task' + (task.status === 'done' ? ' completed' : ''))
      entry.draggable = true
      entry.addEventListener('dragstart', event => { draggedTask = task.id; event.dataTransfer.setData('text/plain', task.id) })
      day.append(entry)
    }
    day.addEventListener('dragover', event => event.preventDefault())
    day.addEventListener('drop', async event => {
      event.preventDefault()
      const task = byId('tasks', event.dataTransfer.getData('text/plain') || draggedTask)
      if (!task) return
      const anchor = task.dueDate || task.startDate
      const delta = anchor ? dayDiff(anchor, date) : 0
      const candidate = { ...task, dueDate: date, startDate: task.startDate ? addDays(task.startDate, delta) : date, dateMode: 'manual' }
      const errors = validateTask(candidate, state.tasks)
      if (errors.length) return notice(errors.join(' '), true)
      try { await action(() => save('tasks', candidate), 'Prazo atualizado.') } catch {}
    })
    grid.append(day)
  }
  content.append(header, node('div', { class: 'calendar-wrap' }, grid))
  const undated = tasks.filter(task => !task.dueDate && !task.startDate)
  if (undated.length) content.append(node('h3', { text: 'Demandas sem data' }), node('div', { class: 'undated-tasks' }, undated.map(taskCard)))
}
function renderGantt(content, tasks) {
  const dated = tasks.filter(task => task.startDate || task.dueDate)
  content.append(viewActions(), node('p', { class: 'muted', text: 'Cronograma por início e término. Abra uma demanda para ajustar datas ou dependências. Tarefas bloqueadas mantêm seu prazo até revisão.' }))
  if (!dated.length) return content.append(empty('Defina início ou prazo nas demandas para montar o cronograma.'))
  const dates = dated.flatMap(task => [task.startDate, task.dueDate]).filter(Boolean).sort()
  const start = dates[0]
  const end = dates[dates.length - 1]
  const days = Math.min(730, dayDiff(start, end) + 1)
  const wrap = node('div', { class: 'gantt-wrap', style: '--days:' + days })
  const ticks = node('div', { class: 'gantt-timeline gantt-header', style: '--days:' + days })
  for (let index = 0; index < days; index += days > 90 ? 14 : 7) ticks.append(node('span', { class: 'gantt-tick', style: 'grid-column:' + (index + 1), text: formatDate(addDays(start, index)).slice(0, 5) }))
  wrap.append(node('div', { class: 'gantt-row' }, [node('strong', { class: 'gantt-label', text: 'Demanda' }), ticks]))
  for (const task of dated) {
    const first = dayDiff(start, task.startDate || task.dueDate)
    const last = Math.min(days, dayDiff(start, task.dueDate || task.startDate) + 1)
    const dependencies = (task.dependencyIds || []).map(id => byId('tasks', id)).filter(Boolean)
    const label = node('div', { class: 'gantt-label' }, [button(task.title, () => openTask(task), 'task-title'), node('small', { class: 'muted', text: dependencies.length ? 'Após: ' + dependencies.map(item => item.title).join(', ') : task.team || '' })])
    const line = node('div', { class: 'gantt-timeline', style: '--days:' + days })
    if (first < days) line.append(button(formatDate(task.startDate || task.dueDate) + ' – ' + formatDate(task.dueDate || task.startDate), () => openTask(task), 'gantt-bar status-' + task.status))
    if (line.firstChild) { line.firstChild.style.gridColumn = (first + 1) + ' / ' + Math.max(first + 2, last + 1); line.firstChild.title = task.title }
    wrap.append(node('div', { class: 'gantt-row' }, [label, line]))
  }
  content.append(wrap)
  if (dayDiff(start, end) >= 730) content.append(node('p', { class: 'muted', text: 'Exibindo os primeiros dois anos. Use o filtro de plano para detalhar períodos menores.' }))
  const undated = tasks.filter(task => !task.startDate && !task.dueDate)
  if (undated.length) content.append(node('p', { class: 'muted', text: undated.length + ' demanda(s) sem datas ainda não aparecem no cronograma.' }))
}
function renderSummary(content, tasks) {
  const summary = computeSummary(tasks, todayISO())
  const stats = [['Demandas', summary.total], ['Em andamento', summary.doing], ['Concluídas', summary.done], ['Atrasadas', summary.overdue], ['Próximos 7 dias', summary.dueSoon], ['Sem responsável', summary.unassigned]]
  content.append(node('div', { class: 'summary-grid' }, stats.map(([title, count]) => node('article', { class: 'stat-card' }, [node('span', { text: title }), node('strong', { text: count })]))))
  const groups = [['Andamento', [['Não iniciadas', summary.todo], ['Em andamento', summary.doing], ['Concluídas', summary.done]]], ['Equipes', Object.entries(summary.byTeam || {}).map(([name, data]) => [name, data.total])], ['Prioridades', Object.entries(summary.byPriority || {}).map(([name, count]) => [labels[name], count])]]
  const workload = new Map()
  for (const task of tasks.filter(task => task.status !== 'done')) for (const person of task.assignees || []) {
    const key = person.email || person.name.toLowerCase()
    const entry = workload.get(key) || { label: person.email ? person.name + ' (' + person.email + ')' : person.name, count: 0 }
    entry.count++
    workload.set(key, entry)
  }
  groups.push(['Demandas pendentes por responsável', [...workload.values()].map(entry => [entry.label, entry.count])])
  for (const [title, rows] of groups) {
    const section = node('section', { class: 'integration-card' }, node('h3', { text: title }))
    const maximum = Math.max(1, ...rows.map(row => row[1]))
    for (const [name, count] of rows) section.append(node('div', { class: 'chart-row' }, [node('span', { text: name }), node('div', { class: 'chart-track' }, node('div', { class: 'chart-fill', style: 'width:' + (count / maximum * 100) + '%' })), node('strong', { text: count })]))
    if (!rows.length) section.append(node('p', { class: 'muted', text: 'Nenhuma demanda para este grupo.' }))
    content.append(section)
  }
}

function eventDateLabel(event) {
  if (event.allDay || !event.startAt) return 'Dia inteiro'
  const date = new Date(event.startAt)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(date)
    : 'Horário na agenda oficial'
}

function eventCard(event, tasks) {
  const related = tasks.filter(task => task.eventId === event.id)
  const finished = related.filter(task => task.status === 'done').length
  const percentage = related.length ? Math.round(finished / related.length * 100) : 0
  const month = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' }).format(new Date(event.startDate + 'T12:00:00Z')).replace('.', '')
  const card = node('article', { class: 'planner-event-card' + (event.status === 'cancelled' ? ' is-cancelled' : '') })
  const top = node('div', { class: 'planner-event-top' })
  top.append(node('div', { class: 'event-day-badge' }, [
    node('strong', { text: String(Number(event.startDate.slice(-2))) }),
    node('small', { text: month })
  ]))
  const detail = node('div', { class: 'planner-event-detail' })
  detail.append(button(event.title, () => openEvent(event), 'event-card-title'))
  detail.append(node('p', { class: 'muted', text: formatDate(event.startDate) + ' · ' + eventDateLabel(event) }))
  detail.append(node('div', { class: 'event-card-tags' }, [
    node('span', { class: 'event-source-tag', text: event.source === 'google' ? 'Google Agenda' : 'Evento interno' }),
    ...(event.status === 'cancelled' ? [node('span', { class: 'event-cancelled-tag', text: 'Cancelado' })] : [])
  ]))
  top.append(detail)
  card.append(top)
  card.append(node('div', { class: 'event-progress-label' }, [
    node('span', { text: related.length ? finished + ' de ' + related.length + ' demandas concluídas' : 'Nenhuma demanda cadastrada' }),
    node('strong', { text: percentage + '%' })
  ]))
  card.append(node('div', { class: 'event-progress-track' }, node('span', { style: 'width:' + percentage + '%' })))
  const pending = related.filter(task => task.status !== 'done').sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')).slice(0, 2)
  if (pending.length) {
    card.append(node('div', { class: 'event-related-tasks' }, pending.map(task => button(
      (isOverdue(task) ? '● ' : '○ ') + task.title,
      () => openTask(task), 'event-related-task'
    ))))
  }
  const actions = node('div', { class: 'event-card-actions' })
  if (event.status !== 'cancelled') actions.append(button('+ Demanda', () => openEventTask(event), 'button button-small button-primary'))
  actions.append(button(related.length ? 'Ver demandas' : 'Preparar evento', () => {
    if (!related.length) return openEvent(event)
    $('event-filter').value = event.id
    currentView = 'board'
    render()
  }, 'button button-small'))
  card.append(actions)
  return card
}

function renderEvents(content) {
  const allTasks = liveTasks()
  const linkedEventIds = new Set(allTasks.map(task => task.eventId).filter(Boolean))
  const events = liveEvents().filter(event => event.startDate && (event.status !== 'cancelled' || linkedEventIds.has(event.id)))
  const counts = { active: allTasks.filter(task => task.eventId && task.status !== 'done').length,
    independent: allTasks.filter(task => !task.eventId && task.status !== 'done').length }
  const intro = node('section', { class: 'event-hub-heading' })
  intro.append(node('div', {}, [node('p', { class: 'event-hub-overline', text: 'Agenda oficial · Planejamento da Comissão' }), node('h3', { text: 'Eventos e preparativos' }), node('p', { class: 'muted', text: 'Planeje cada evento da igreja com antecedência. Eventos do Google são somente leitura; as demandas são administradas aqui.' })]))
  const controls = node('div', { class: 'event-hub-controls' })
  const years = [...new Set([eventsYear - 1, eventsYear, eventsYear + 1, ...events.map(event => Number(event.startDate.slice(0, 4)))] )].filter(year => Number.isInteger(year) && year > 2000 && year < 2200).sort((a, b) => a - b)
  const picker = node('select', { 'aria-label': 'Ano dos eventos', onChange: e => { eventsYear = Number(e.target.value); render() } }, years.map(year => node('option', { value: year, text: String(year), selected: year === eventsYear })))
  controls.append(node('label', { class: 'event-year-label' }, ['Ano ', picker]), button('+ Demanda independente', openIndependentTask, 'button button-small'), button('+ Evento interno', () => openEvent(), 'button button-small'))
  intro.append(controls)
  content.append(intro)
  const yearEvents = events.filter(event => event.startDate.startsWith(String(eventsYear)))
  content.append(node('div', { class: 'event-hub-stats' }, [
    ['Eventos no ano', yearEvents.length], ['Demandas ligadas', counts.active], ['Demandas independentes', counts.independent]
  ].map(([name, count]) => node('div', { class: 'event-hub-stat' }, [node('strong', { text: count }), node('span', { text: name })]))))
  const query = value('search-filter').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const selected = value('event-filter')
  const relevant = yearEvents.filter(event =>
    (!selected || selected === event.id) &&
    (!query || [event.title, event.description || '', ...allTasks.filter(task => task.eventId === event.id).map(task => task.title)].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(query))
  ).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title, 'pt-BR'))
  if (!relevant.length) {
    content.append(empty(selected === '__independent__' ? 'Altere o filtro de vínculo para consultar a agenda oficial.' : 'Nenhum evento encontrado neste ano. Confira o filtro ou o link da Agenda IPCVT.'))
  } else {
    const byMonth = new Map()
    for (const event of relevant) {
      const key = event.startDate.slice(0, 7)
      if (!byMonth.has(key)) byMonth.set(key, [])
      byMonth.get(key).push(event)
    }
    for (const [month, items] of byMonth) {
      const group = node('section', { class: 'planner-event-month' })
      const label = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(month + '-01T12:00:00Z'))
      group.append(node('div', { class: 'event-month-heading' }, [node('h3', { text: label }), node('span', { class: 'badge', text: items.length })]))
      group.append(node('div', { class: 'planner-event-grid' }, items.map(event => eventCard(event, allTasks))))
      content.append(group)
    }
  }
  const independents = allTasks.filter(task => !task.eventId && task.status !== 'done')
  if (independents.length) {
    const aside = node('section', { class: 'independent-tasks' })
    aside.append(node('div', { class: 'independent-tasks-heading' }, [node('div', {}, [node('h3', { text: 'Demandas independentes' }), node('p', { class: 'muted', text: 'Trabalho que não depende de um evento específico.' })]), button('Ver na lista', () => { $('event-filter').value = '__independent__'; currentView = 'list'; render() }, 'button button-small')]))
    aside.append(node('div', { class: 'independent-task-list' }, independents.slice(0, 4).map(task => button(task.title + ' · ' + (task.dueDate ? formatDate(task.dueDate) : 'Sem prazo'), () => openTask(task), 'independent-task-link'))))
    content.append(aside)
  }
}

function renderMyDay(content, tasks) {
  const mine = tasks.filter(task => (task.assignees || []).some(person => person.email?.toLowerCase() === session.email))
  const today = todayISO()
  const upcoming = addDays(today, 7)
  const groups = [
    ['Atrasadas', mine.filter(task => isOverdue(task, today))],
    ['Para hoje', mine.filter(task => task.status !== 'done' && task.dueDate === today)],
    ['Próximos 7 dias', mine.filter(task => task.status !== 'done' && task.dueDate > today && task.dueDate <= upcoming)],
    ['Outras demandas', mine.filter(task => task.status !== 'done' && (!task.dueDate || task.dueDate > upcoming))]
  ]
  content.append(node('div', { class: 'my-day-heading' }, [node('div', {}, [node('h3', { text: 'Minhas demandas' }), node('p', { class: 'muted', text: 'Todas as entregas atribuídas ao seu e-mail, com prioridade para os prazos mais próximos.' })]), node('span', { class: 'badge', text: mine.filter(task => task.status !== 'done').length + ' pendente(s)' })]))
  if (!mine.length) content.append(empty('Nenhuma demanda atribuída ao seu e-mail com os filtros atuais.'))
  for (const [title, entries] of groups) if (entries.length) {
    const section = node('section', { class: 'my-day-group' })
    section.append(node('h3', { text: title + ' · ' + entries.length }))
    section.append(node('div', { class: 'my-day-list' }, entries.map(task => node('div', { class: 'my-day-item' }, [
      node('span', { class: 'my-day-indicator' + (isOverdue(task, today) ? ' late' : '') }),
      node('div', { class: 'my-day-item-detail' }, [button(task.title, () => openTask(task), 'task-title'), node('small', { text: [task.eventId ? liveEvents().find(event => event.id === task.eventId)?.title || 'Evento vinculado' : 'Demanda independente', task.dueDate ? formatDate(task.dueDate) : 'Sem prazo'].join(' · ') })]),
      node('span', { class: 'priority priority-' + task.priority, text: labels[task.priority] || 'Normal' }),
      button('Abrir', () => openTask(task), 'button button-small')
    ]))))
    content.append(section)
  }
}
function renderRoutines(content) {
  content.append(node('p', { class: 'muted', text: 'Rotinas independentes geram uma demanda por semana. Para preparar cultos recorrentes, aplique o modelo no evento e acompanhe as mesmas tarefas na semana.' }), button('+ Nova rotina semanal', () => { if (requirePlan()) openRoutine() }, 'button button-primary'))
  const routines = state.routines.filter(routine => !routine.deleted && activePlans().some(plan => plan.id === routine.planId) && (!selectedPlan() || routine.planId === selectedPlan()))
  for (const routine of routines) {
    content.append(node('article', { class: 'routine-card' }, [
      node('h3', { text: routine.title }), node('p', { text: planName(routine.planId) + ' · ' + ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'][routine.weekday] }),
      node('p', { class: 'muted', text: assigneeText(routine.assignees) || 'Sem responsável' }),
      button('Editar', () => openRoutine(routine)),
      button('Gerar próximas 4 semanas', async () => { try { await action(() => generateRoutine(routine), 'Demandas da rotina atualizadas, sem duplicar as existentes.') } catch {} })
    ]))
  }
  if (!routines.length) content.append(empty('Nenhuma rotina cadastrada.'))
}
function calendarTrackingKey() {
  return 'ipcvt:public-calendar:' + (session.user?.uid || 'visitor') + ':' + calendarConfig.calendarId
}

function readCalendarTracking() {
  try {
    const entry = JSON.parse(localStorage.getItem(calendarTrackingKey()) || 'null')
    return entry && Array.isArray(entry.events) && Array.isArray(entry.unread) ? entry : null
  } catch { return null }
}

function writeCalendarTracking(events, unread) {
  try { localStorage.setItem(calendarTrackingKey(), JSON.stringify({ events, unread })) } catch { /* Armazenamento indisponível. */ }
}

function updateCalendarBadge() {
  const count = calendarUnread.length
  $('planner-notifications-button').hidden = session.status !== 'authorized'
  $('planner-notifications-count').hidden = !count
  $('planner-notifications-count').textContent = count > 99 ? '99+' : String(count)
  $('planner-notifications-button').title = count ? count + ' novidade(s) na agenda' : 'Nenhuma novidade na agenda'
}

async function refreshPublicCalendar() {
  if (session.status !== 'authorized' || calendarFetching) return
  calendarFetching = true
  const epoch = authEpoch
  const calendarId = calendarConfig.calendarId
  try {
    const snapshot = await readPublicCalendar({ calendarId })
    if (epoch !== authEpoch || calendarConfig.calendarId !== calendarId || session.status !== 'authorized') return
    const summary = summarizeCalendarEvents(snapshot.events)
    const previous = readCalendarTracking()
    const changes = previous ? diffCalendarEvents(previous.events, summary) : []
    calendarUnread = [...(previous?.unread || []), ...changes.map(change => ({
      ...change, detectedAt: new Date().toISOString()
    }))].slice(-50)
    writeCalendarTracking(summary, calendarUnread)
    publicSnapshot = snapshot
    publicEvents = snapshot.events
    calendarLastLoad = Date.now()
    calendarLoadError = ''
    updateCalendarBadge()
    render()
  } catch (error) {
    if (epoch !== authEpoch || calendarConfig.calendarId !== calendarId) return
    calendarLoadError = error?.message || 'Não foi possível atualizar os eventos.'
    render()
  } finally {
    calendarFetching = false
    if (session.status === 'authorized' && calendarConfig.calendarId !== calendarId) setTimeout(refreshPublicCalendar, 0)
  }
}

function startCalendarPolling() {
  if (calendarTimer) return
  refreshPublicCalendar()
  calendarTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refreshPublicCalendar()
  }, hasDirectGoogleAccess() ? 2 * 60 * 1000 : 5 * 60 * 1000)
}

function stopCalendarPolling() {
  if (calendarTimer) clearInterval(calendarTimer)
  calendarTimer = null
  calendarFetching = false
}

// Assim como a agenda anual, busca as novidades ao retornar para a aba.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && session.status === 'authorized'
    && Date.now() - calendarLastLoad > 60 * 1000) void refreshPublicCalendar()
})

function renderPublicIntegration(content) {
  const section = node('section', { class: 'integration-card' }, [
    node('h3', { text: 'Agenda IPCVT · calendário oficial' }),
    node('p', { text: 'Os eventos públicos aparecem automaticamente no calendário do Planner. Nenhum integrante precisa conectar a própria conta Google. O Planner não escreve na agenda da igreja.' }),
    node('p', { class: 'calendar-sync-status', text: calendarLoadError
      ? calendarLoadError
      : publicSnapshot
        ? publicEvents.length + ' evento(s) carregado(s). '
          + (publicSnapshot.sourceKind === 'google-api' ? 'Google consultado em ' : 'Cópia importada em ')
          + new Date(publicSnapshot.generatedAt).toLocaleString('pt-BR') + '. '
          + (publicSnapshot.warning || '')
        : 'Buscando os eventos da agenda pública…' }),
    node('a', { class: 'button button-small', href: calendarWebUrl(calendarConfig.calendarId), target: '_blank', rel: 'noopener noreferrer', text: 'Abrir agenda oficial ↗' }),
    button(calendarFetching ? 'Verificando…' : 'Verificar novidades agora', () => refreshPublicCalendar(), 'button button-small')
  ])
  content.append(section)
  if (session.isAdmin) section.append(node('p', { class: 'muted', text: 'Para trocar o link da agenda oficial, use a engrenagem de Configurações ao lado do seu nome.' }))
}

function renderIntegrations(content) {
  renderPublicIntegration(content)
  if (!session.isAdmin) return
  const optional = node('details', { class: 'integration-card' })
  optional.append(node('summary', { text: 'Outras agendas Google (opcional)' }))
  content.append(optional)
  renderPrivateIntegrations(optional)
}

function renderPrivateIntegrations(content) {
  content.append(node('section', { class: 'integration-card' }, [
    node('h3', { text: 'Google Agenda' }),
    node('p', { text: 'Importe eventos das agendas selecionadas e compartilhe-os com os membros autorizados da Comissão. As agendas do Google permanecem intactas.' }),
    node('p', { class: 'muted', text: 'A conexão vale enquanto esta página estiver aberta. Use Atualizar eventos para buscar alterações; ao expirar, conecte novamente.' })
  ]))
  if (!session.isAdmin) { content.append(empty('A coordenação administra as agendas compartilhadas. Os eventos importados ficam disponíveis no calendário do Planner.')); return }
  const connect = button(googleClient ? 'Reconectar Google Agenda' : 'Conectar Google Agenda', async () => {
    connect.disabled = true
    try {
      const epoch = authEpoch
      const token = await store.connectGoogleCalendars()
      const client = new GoogleCalendarClient(token)
      const calendars = await client.listCalendars()
      if (epoch !== authEpoch || session.status !== 'authorized') return
      googleClient = client
      googleCalendars = calendars
      notice('Selecione apenas as agendas que deseja disponibilizar à Comissão.')
      render()
    } catch (error) { reportError(error) }
    finally { connect.disabled = false }
  }, 'button button-primary')
  content.append(connect)
  if (!googleClient) return
  const choices = node('div', { class: 'integration-card' })
  for (const calendar of googleCalendars) {
    const readable = ['reader', 'writer', 'owner'].includes(calendar.accessRole)
    choices.append(node('label', { class: 'calendar-choice' }, [
      node('input', { type: 'checkbox', checked: calendarSelection.has(calendar.id), disabled: !readable, value: calendar.id, onChange: event => { if (event.target.checked) calendarSelection.add(calendar.id); else calendarSelection.delete(calendar.id) } }),
      node('span', { text: calendar.summary || calendar.id }), node('small', { class: 'muted', text: readable ? 'Disponibilizar à Comissão' : 'Sem permissão para detalhes' })
    ]))
  }
  if (!googleCalendars.length) choices.append(node('p', { text: 'Nenhuma agenda disponível. Adicione a agenda compartilhada à sua conta no Google Agenda e reconecte.' }))
  content.append(choices)
  const from = node('input', { type: 'date', value: integrationRange.from, 'aria-label': 'Importar eventos a partir de', onChange: event => { integrationRange.from = event.target.value } })
  const to = node('input', { type: 'date', value: integrationRange.to, 'aria-label': 'Importar eventos até', onChange: event => { integrationRange.to = event.target.value } })
  const update = button(importBusy ? 'Atualizando…' : 'Atualizar eventos', async () => {
    if (!calendarSelection.size) return notice('Selecione ao menos uma agenda.')
    if (!from.value || !to.value || from.value > to.value || dayDiff(from.value, to.value) > 366) return notice('Escolha um intervalo válido de até um ano.', true)
    const selected = googleCalendars.filter(calendar => calendarSelection.has(calendar.id))
    if (!await confirmAction('Disponibilizar eventos à Comissão?', 'Os eventos de ' + selected.map(calendar => calendar.summary).join(', ') + ' serão visíveis para os membros autorizados da Comissão.')) return
    update.disabled = true
    importBusy = true
    const epoch = authEpoch
    let count = 0
    let reviewed = 0
    try {
      await action(async () => {
        for (const calendar of selected) {
          const events = await googleClient.readEvents(calendar, { from: from.value, to: to.value })
          for (const imported of events) {
            if (epoch !== authEpoch || !session.isAdmin) throw new Error('A sessão mudou. Conecte a agenda novamente.')
            const previous = byId('events', imported.id)
            if (!previous && !imported.startDate) continue
            const next = { ...(previous || {}), ...imported }
            if (!next.title && next.startDate) next.title = 'Evento sem título'
            await save('events', next)
            count++
            if (previous && (previous.startDate !== next.startDate || (previous.status !== next.status && next.status === 'cancelled'))) reviewed += await updateRelativeDates(previous, next)
          }
        }
      })
      notice(count + ' evento(s) atualizado(s).' + (reviewed ? ' ' + reviewed + ' demanda(s) precisam de revisão de prazos.' : ''))
      render()
    } catch (error) {
      if (error.code === 'GOOGLE_AUTH_EXPIRED') { googleClient = null; googleCalendars = []; render() }
      notice(count + ' evento(s) salvo(s) antes da interrupção. ' + error.message, true)
    } finally { importBusy = false; if (session.status === 'authorized' && currentView === 'integrations') render() }
  }, 'button button-primary')
  update.disabled = importBusy
  content.append(node('div', { class: 'toolbar' }, [node('label', {}, ['De ', from]), node('label', {}, ['Até ', to]), update]))
  content.append(node('p', { class: 'muted', text: 'Eventos recorrentes são importados por ocorrência. Reimportar atualiza o mesmo evento. Eventos cancelados preservam as demandas e aparecem com a indicação de cancelamento.' }))
}
async function updateRelativeDates(previous, next) {
  let review = 0
  for (const task of liveTasks().filter(item => item.eventId === next.id && item.dateMode === 'event')) {
    const proposed = addDays(next.startDate, Number(task.dueOffsetDays || 0))
    const wasRelative = task.dueDate === addDays(previous.startDate, Number(task.dueOffsetDays || 0))
    const candidate = { ...task, dueDate: proposed, startDate: task.startDate === task.dueDate ? proposed : task.startDate }
    if (next.status === 'cancelled' || task.status !== 'todo' || task.checklist?.some(item => item.done) || !wasRelative || proposed < todayISO() || validateTask(candidate, state.tasks).length) {
      review++
      await save('tasks', { ...task, reviewRequired: true, reviewReason: next.status === 'cancelled' ? 'O evento foi cancelado. Confira esta demanda.' : 'O evento mudou de data. Confira o prazo desta demanda.' })
      continue
    }
    await save('tasks', { ...candidate, reviewRequired: false, reviewReason: '' })
  }
  return review
}
function render() {
  if (session.status !== 'authorized') return
  refreshFilters()
  $('search-filter').parentElement.querySelector('span').textContent = currentView === 'events' ? 'Buscar evento ou demanda' : 'Buscar demanda'
  $('search-filter').placeholder = currentView === 'events' ? 'Nome do evento ou preparativo' : 'O que você procura?'
  const title = { events: 'Eventos da igreja', mine: 'Meu dia', board: 'Quadro de demandas', list: 'Lista de demandas', calendar: 'Calendário', gantt: 'Cronograma · Gantt', summary: 'Resumo da Comissão', integrations: 'Integrações', routines: 'Rotinas semanais' }[currentView]
  $('view-title').textContent = title
  $('view-title').parentElement.querySelector('.view-heading-note').textContent = currentView === 'events'
    ? 'Google Agenda e preparação de eventos'
    : currentView === 'mine' ? 'O que depende de você' : 'Cada entrega, um próximo passo.'
  document.querySelectorAll('[data-view]').forEach(control => control.setAttribute('aria-pressed', String(control.dataset.view === currentView)))
  const content = $('view-content')
  content.replaceChildren()
  if (!activePlans().length && !['events', 'mine', 'calendar', 'integrations'].includes(currentView)) {
    content.append(empty('Comece pelas demandas de um evento da agenda ou crie um plano para seu projeto.'), button('Ver eventos da igreja', () => { currentView = 'events'; render() }, 'button button-primary'), button('Criar plano', () => openPlan()))
    return
  }
  const tasks = visibleTasks()
  ;({ events: renderEvents, mine: renderMyDay, board: renderBoard, list: renderList, calendar: renderCalendar, gantt: renderGantt, summary: renderSummary, integrations: renderIntegrations, routines: renderRoutines }[currentView])(content, tasks)
}
function fillBucketSelect(select, planId, current = '') {
  setOptions(select, state.buckets.filter(bucket => bucket.planId === planId && !bucket.deleted).sort((a, b) => a.order - b.order).map(bucket => [bucket.id, bucket.name]), current, ['', 'Sem bucket'])
}
function openTask(task = null, defaults = {}) {
  if (!task && !requirePlan()) return
  $('task-form').reset()
  $('task-feedback').textContent = ''
  if (task?.reviewRequired) $('task-feedback').textContent = task.reviewReason
  const current = task || { title: '', planId: defaults.planId || selectedPlan() || activePlans()[0]?.id, bucketId: defaults.bucketId || '', startDate: defaults.startDate || '', dueDate: defaults.dueDate || '', status: 'todo', priority: 'normal', dateMode: 'manual', ...defaults }
  $('task-id').value = current.id || ''
  $('task-dialog').dataset.version = current.version ?? ''
  $('task-title').value = current.title || ''
  setOptions($('task-plan'), activePlans().map(plan => [plan.id, plan.name]), current.planId)
  fillBucketSelect($('task-bucket'), current.planId, current.bucketId)
  for (const [field, key] of [['task-team', 'team'], ['task-start', 'startDate'], ['task-due', 'dueDate'], ['task-description', 'description']]) $(field).value = current[key] || ''
  $('task-status').value = current.status
  $('task-priority').value = current.priority
  $('task-assignees').value = assigneeText(current.assignees)
  $('task-checklist').value = (current.checklist || []).map(item => (item.done ? '[x] ' : '') + item.text).join('\n')
  const dependencies = state.tasks.filter(item => item.planId === current.planId && item.id !== current.id && (!item.deleted || current.dependencyIds?.includes(item.id)))
  setOptions($('task-dependencies'), dependencies.map(item => [item.id, (item.deleted ? '[Excluída] ' : '') + item.title]))
  for (const option of $('task-dependencies').options) option.selected = current.dependencyIds?.includes(option.value) || false
  setOptions($('task-event'), liveEvents().sort((a, b) => a.startDate.localeCompare(b.startDate)).map(event => [event.id, event.title + ' · ' + formatDate(event.startDate)]), current.eventId || '', ['', 'Demanda independente (sem evento)'])
  $('task-date-mode').value = current.dateMode || 'manual'
  $('task-offset').value = current.dueOffsetDays ?? 0
  updateTaskEventFields()
  $('delete-task-button').hidden = !task
  $('task-dialog').showModal()
  $('task-title').focus()
}
function updateTaskEventFields(recalculate = false) {
  const event = liveEvents().find(item => item.id === value('task-event'))
  if (!event && value('task-date-mode') === 'event') $('task-date-mode').value = 'manual'
  const relative = value('task-date-mode') === 'event' && !!event
  $('task-offset').disabled = !relative
  $('task-offset').closest('.field')?.classList.toggle('is-disabled', !relative)
  $('task-event-hint').textContent = event
    ? 'Vinculada a “' + event.title + '”. Você pode usar um prazo manual ou, para preparação antecipada, calcular a data em relação ao evento.'
    : 'Sem evento vinculado: esta demanda pode ser criada para qualquer trabalho ou projeto independente.'
  if (recalculate && relative) {
    const oldDue = value('task-due')
    const proposed = addDays(event.startDate, Number(value('task-offset')))
    if (proposed) {
      if (!value('task-start') || value('task-start') === oldDue) $('task-start').value = proposed
      $('task-due').value = proposed
    }
  }
}
$('task-event').addEventListener('change', () => updateTaskEventFields(true))
$('task-date-mode').addEventListener('change', () => updateTaskEventFields(true))
$('task-offset').addEventListener('input', () => updateTaskEventFields(true))
$('task-plan').addEventListener('change', () => {
  fillBucketSelect($('task-bucket'), value('task-plan'))
  setOptions($('task-dependencies'), liveTasks().filter(task => task.planId === value('task-plan') && task.id !== value('task-id')).map(task => [task.id, task.title]))
  for (const option of $('task-dependencies').options) option.selected = false
})
$('task-form').addEventListener('submit', async event => {
  event.preventDefault()
  const submit = event.submitter || $('task-form').querySelector('[type=submit]')
  submit.disabled = true
  try {
    const previous = byId('tasks', value('task-id'))
    if (value('task-id') && !previous) throw new Error('Esta demanda não está mais disponível. Feche a janela e atualize a tela.')
    if (previous && String(previous.version) !== $('task-dialog').dataset.version) throw new Error('Esta demanda foi atualizada por outra pessoa. Feche e abra novamente antes de salvar.')
    const oldChecks = previous?.checklist || []
    const checklist = value('task-checklist').split('\n').map(line => line.trim()).filter(Boolean).map((line, index) => {
      const done = /^\[x\]\s*/i.test(line)
      const text = line.replace(/^\[(?:x| )\]\s*/i, '')
      return { id: oldChecks[index]?.text === text ? oldChecks[index].id : newId(), text, done }
    })
    const task = { ...(previous || {}), id: previous?.id || newId(), title: value('task-title'), planId: value('task-plan'), bucketId: value('task-bucket'), team: value('task-team'), description: value('task-description'), assignees: parseAssignees(value('task-assignees')), startDate: value('task-start'), dueDate: value('task-due'), status: value('task-status'), priority: value('task-priority'), checklist, dependencyIds: [...$('task-dependencies').selectedOptions].map(option => option.value), eventId: value('task-event'), dateMode: value('task-date-mode'), dueOffsetDays: Number(value('task-offset')) }
    if (task.dateMode === 'event') {
      const linked = liveEvents().find(event => event.id === task.eventId)
      if (!linked?.startDate || !Number.isInteger(task.dueOffsetDays) || Math.abs(task.dueOffsetDays) > 365) throw new Error('Selecione um evento e um intervalo de até 365 dias para o prazo relativo.')
      task.dueDate = addDays(linked.startDate, task.dueOffsetDays)
    }
    const errors = validateTask(task, state.tasks)
    if (errors.length) throw new Error(errors.join(' '))
    if (task.assignees.length > 10 || task.checklist.length > 20 || task.dependencyIds.length > 20) throw new Error('Use até 10 responsáveis, 20 itens de checklist e 20 dependências.')
    if (task.description.length > 10000 || task.checklist.some(item => item.text.length > 300)) throw new Error('Use até 10.000 caracteres na descrição e 300 em cada item do checklist.')
    task.reviewRequired = false
    task.reviewReason = ''
    await action(() => save('tasks', task), previous ? 'Demanda atualizada.' : 'Demanda criada.')
    $('task-dialog').close()
  } catch (error) { $('task-feedback').textContent = error.message }
  finally { submit.disabled = false }
})
async function deleteTask(task) {
  if (!task || !await confirmAction('Excluir demanda?', 'A demanda “' + task.title + '” deixará de aparecer nas visões. As tarefas que dependem dela precisarão de revisão.')) return
  try { await action(() => save('tasks', { ...task, deleted: true }), 'Demanda excluída.'); if ($('task-dialog').open) $('task-dialog').close() } catch {}
}
$('delete-task-button').addEventListener('click', () => deleteTask(byId('tasks', value('task-id'))))

function openPlan(plan = null) {
  $('plan-form').reset()
  $('plan-feedback').textContent = ''
  $('plan-id').value = plan?.id || ''
  $('plan-dialog').dataset.version = plan?.version ?? ''
  $('plan-name').value = plan?.name || ''
  $('plan-kind').value = plan?.kind || 'continuous'
  $('plan-description').value = plan?.description || ''
  $('plan-start').value = plan?.startDate || ''
  $('plan-due').value = plan?.dueDate || ''
  $('plan-buckets').value = plan ? state.buckets.filter(bucket => bucket.planId === plan.id && !bucket.deleted).sort((a, b) => a.order - b.order).map(bucket => bucket.name).join('\n') : 'Preparação musical\nLiturgia\nTécnica\nComunicação'
  $('delete-plan-button').hidden = !plan
  $('delete-plan-button').textContent = 'Arquivar plano'
  $('plan-dialog').showModal()
  $('plan-name').focus()
}
$('plan-kind').addEventListener('change', () => { if (!value('plan-id')) $('plan-buckets').value = value('plan-kind') === 'project' ? 'Planejamento\nExecução\nRevisão\nEntrega' : 'Preparação musical\nLiturgia\nTécnica\nComunicação' })
$('plan-form').addEventListener('submit', async event => {
  event.preventDefault()
  const submit = event.submitter
  submit.disabled = true
  try {
    const old = byId('plans', value('plan-id'))
    if (value('plan-id') && !old) throw new Error('Este plano não está mais disponível. Feche a janela e atualize a tela.')
    if (old && String(old.version) !== $('plan-dialog').dataset.version) throw new Error('Este plano foi atualizado. Feche e abra novamente.')
    const plan = { ...(old || {}), id: old?.id || newId(), name: value('plan-name'), kind: value('plan-kind'), description: value('plan-description'), startDate: value('plan-start'), dueDate: value('plan-due') }
    if (!plan.name || plan.name.length > 120 || (plan.startDate && plan.dueDate && plan.startDate > plan.dueDate)) throw new Error('Confira o nome e as datas do plano.')
    const names = [...new Set(value('plan-buckets').split('\n').map(name => name.trim()).filter(Boolean))]
    if (names.length > 30 || names.some(name => name.length > 80)) throw new Error('Use até 30 buckets, cada um com até 80 caracteres.')
    const existing = state.buckets.filter(bucket => bucket.planId === plan.id && !bucket.deleted)
    const removed = existing.filter(bucket => !names.includes(bucket.name))
    if (removed.some(bucket => state.tasks.some(task => !task.deleted && task.bucketId === bucket.id) || state.routines.some(routine => routine.bucketId === bucket.id))) throw new Error('Mova as demandas e rotinas de um bucket antes de removê-lo ou alterar seu nome.')
    await action(async () => {
      const savedPlan = await save('plans', plan)
      $('plan-id').value = savedPlan.id
      $('plan-dialog').dataset.version = String(savedPlan.version)
      for (let index = 0; index < names.length; index++) {
        const found = existing.find(bucket => bucket.name === names[index])
        await save('buckets', { ...(found || {}), id: found?.id || newId(), planId: plan.id, name: names[index], order: index })
      }
      for (const bucket of removed) await save('buckets', { ...bucket, deleted: true })
    }, 'Plano salvo.')
    $('plan-filter').value = plan.id
    $('plan-dialog').close()
    render()
  } catch (error) { $('plan-feedback').textContent = error.message }
  finally { submit.disabled = false }
})
$('delete-plan-button').addEventListener('click', async () => {
  const plan = byId('plans', value('plan-id'))
  if (!plan || !await confirmAction('Arquivar plano?', 'O plano e suas demandas sairão das visões ativas. O histórico será preservado.')) return
  try { await action(() => store.remove('plans', plan.id, { expectedVersion: plan.version }), 'Plano arquivado.'); $('plan-dialog').close() } catch {}
})
function openRoutine(routine = null) {
  $('routine-form').reset()
  $('routine-feedback').textContent = ''
  $('routine-id').value = routine?.id || ''
  $('routine-dialog').dataset.version = routine?.version ?? ''
  $('routine-title').value = routine?.title || ''
  setOptions($('routine-plan'), activePlans().map(plan => [plan.id, plan.name]), routine?.planId || selectedPlan())
  fillBucketSelect($('routine-bucket'), value('routine-plan'), routine?.bucketId)
  $('routine-team').value = routine?.team || ''
  $('routine-assignees').value = assigneeText(routine?.assignees)
  $('routine-weekday').value = routine?.weekday ?? 1
  $('routine-priority').value = routine?.priority || 'normal'
  $('delete-routine-button').hidden = !routine
  $('routine-dialog').showModal()
}
$('routine-plan').addEventListener('change', () => fillBucketSelect($('routine-bucket'), value('routine-plan')))
async function generateRoutine(routine) {
  const additions = generateWeeklyTasks(routine, todayISO(), addDays(todayISO(), 27), state.tasks)
  for (const task of additions) await save('tasks', task)
  return additions.length
}
$('routine-form').addEventListener('submit', async event => {
  event.preventDefault()
  const submit = event.submitter
  submit.disabled = true
  try {
    const old = byId('routines', value('routine-id'))
    if (value('routine-id') && !old) throw new Error('Esta rotina foi excluída. Feche a janela e atualize a tela.')
    if (old && String(old.version) !== $('routine-dialog').dataset.version) throw new Error('Esta rotina mudou. Feche e abra novamente.')
    const routine = { ...(old || {}), id: old?.id || newId(), title: value('routine-title'), planId: value('routine-plan'), bucketId: value('routine-bucket'), team: value('routine-team'), description: '', assignees: parseAssignees(value('routine-assignees')), weekday: Number(value('routine-weekday')), priority: value('routine-priority'), active: true }
    if (!routine.title || routine.title.length > 160 || !routine.planId) throw new Error('Informe o nome da rotina e o plano.')
    await action(async () => { await save('routines', routine); await generateRoutine(routine) }, 'Rotina salva e próximas quatro semanas geradas.')
    $('routine-dialog').close()
  } catch (error) { $('routine-feedback').textContent = error.message }
  finally { submit.disabled = false }
})
$('delete-routine-button').addEventListener('click', async () => {
  const routine = byId('routines', value('routine-id'))
  if (!routine || !await confirmAction('Excluir rotina?', 'A geração de novas ocorrências será encerrada. As demandas já criadas serão mantidas.')) return
  try { await action(() => store.remove('routines', routine.id, { expectedVersion: routine.version }), 'Rotina excluída.'); $('routine-dialog').close() } catch {}
})
function eventControls() {
  const form = $('event-form')
  const section = node('div', { class: 'integration-card', id: 'event-preparation' }, [
    node('h3', { text: 'Preparação deste evento' }),
    node('p', { class: 'muted', text: 'Crie uma demanda avulsa para este evento ou escolha um modelo completo. Projetos especiais podem começar quatro meses antes da data oficial.' }),
    button('+ Nova demanda para este evento', () => {
      const event = liveEvents().find(item => item.id === value('event-id'))
      if (!event) return
      $('event-dialog').close()
      openEventTask(event)
    }, 'button button-primary'),
    node('label', { class: 'field' }, ['Modelo de preparação', node('select', { id: 'event-template' }, [
      node('option', { value: 'standard', text: 'Preparação essencial · até 7 dias antes' }),
      node('option', { value: 'special', text: 'Projeto especial · até 120 dias antes' })
    ])]),
    node('label', { class: 'field' }, ['Plano de preparação', node('select', { id: 'event-plan' })]),
    button('Gerar demandas do modelo', async () => {
      const event = liveEvents().find(item => item.id === value('event-id'))
      if (!event) return
      try {
        let planId = value('event-plan')
        let fallbackBucket = ''
        if (!planId) {
          const result = await ensureWorkPlan('events')
          planId = result.plan.id
          fallbackBucket = result.bucket.id
        }
        const lookup = { default: fallbackBucket }
        for (const bucket of state.buckets.filter(bucket => bucket.planId === planId && !bucket.deleted)) lookup[bucket.name] = bucket.id
        if (!lookup.default) lookup.default = state.buckets.find(bucket => bucket.planId === planId && !bucket.deleted)?.id || ''
        const tasks = eventPreparationTasks(event, planId, lookup, state.tasks, value('event-template'))
        await action(async () => { for (const task of tasks) await save('tasks', task) }, tasks.length ? tasks.length + ' demandas geradas. Abra cada uma para atribuir responsáveis.' : 'As demandas deste modelo já existem.')
        $('event-feedback').textContent = tasks.length ? 'Modelo aplicado. ' + tasks.length + ' demandas aparecerão nas visões e poderão ser editadas.' : 'Esse modelo já foi aplicado; nenhuma demanda foi duplicada.'
      } catch (error) { $('event-feedback').textContent = error.message }
    })
  ])
  form.querySelector('.dialog-body').append(section)
}
eventControls()
function openEvent(event = null) {
  $('event-form').reset()
  $('event-feedback').textContent = ''
  $('event-id').value = event?.id || ''
  $('event-dialog').dataset.version = event?.version ?? ''
  $('event-title').value = event?.title || ''
  $('event-start').value = event?.startDate || todayISO()
  $('event-end').value = event?.endDate || event?.startDate || todayISO()
  const external = event?.source === 'google'
  for (const id of ['event-title', 'event-start', 'event-end']) $(id).disabled = external
  $('event-form').querySelector('[type=submit]').hidden = external
  $('delete-event-button').hidden = !event || (external && (event.sourceKey?.startsWith('public-ical:') || !session.isAdmin || !byId('events', event.id)))
  $('delete-event-button').textContent = external ? 'Ocultar no Planner' : 'Excluir evento'
  $('event-preparation').hidden = !event || event.status === 'cancelled'
  setOptions($('event-plan'), activePlans().map(plan => [plan.id, plan.name]), selectedPlan(), ['', 'Preparação de eventos (criar automaticamente)'])
  if (external) $('event-feedback').textContent = (event.status === 'cancelled' ? 'Evento cancelado no Google. Revise as demandas vinculadas. ' : '') + 'Origem: ' + event.calendarName + '. Os dados são atualizados pelo Google Agenda.'
  $('event-dialog').showModal()
}
$('event-form').addEventListener('submit', async event => {
  event.preventDefault()
  const submit = event.submitter
  submit.disabled = true
  try {
    const old = byId('events', value('event-id'))
    if (value('event-id') && !old) throw new Error('Este evento não está mais disponível. Feche a janela e atualize a tela.')
    if (old?.source === 'google') return
    if (old && String(old.version) !== $('event-dialog').dataset.version) throw new Error('Este evento mudou. Feche e abra novamente.')
    const entry = { ...(old || {}), id: old?.id || newId(), source: 'manual', title: value('event-title'), startDate: value('event-start'), endDate: value('event-end'), allDay: true, status: 'confirmed' }
    if (!entry.title || !entry.startDate || entry.endDate < entry.startDate) throw new Error('Confira o título e as datas do evento.')
    let review = 0
    await action(async () => { await save('events', entry); if (old && old.startDate !== entry.startDate) review = await updateRelativeDates(old, entry) })
    notice('Evento salvo.' + (review ? ' ' + review + ' demanda(s) precisam de revisão de prazos.' : ''))
    $('event-dialog').close()
  } catch (error) { $('event-feedback').textContent = error.message }
  finally { submit.disabled = false }
})
$('delete-event-button').addEventListener('click', async () => {
  const event = byId('events', value('event-id'))
  if (!event || !await confirmAction('Remover evento do Planner?', 'As demandas vinculadas serão preservadas. A agenda original do Google permanece intacta.')) return
  try { await action(() => save('events', { ...event, deleted: true }), 'Evento removido das visões.'); $('event-dialog').close() } catch {}
})

document.querySelectorAll('[data-view]').forEach(control => control.addEventListener('click', () => {
  currentView = control.dataset.view
  if (currentView === 'mine') $('assignee-filter').value = '__mine__'
  else if (value('assignee-filter') === '__mine__') $('assignee-filter').value = ''
  if (currentView === 'events') $('event-filter').value = ''
  render()
}))
for (const id of ['plan-filter', 'team-filter', 'assignee-filter', 'status-filter', 'event-filter']) $(id).addEventListener('change', render)
$('search-filter').addEventListener('input', render)
$('new-task-button').addEventListener('click', () => { if (activePlans().length) openTask(); else openIndependentTask() })
$('new-plan-button').addEventListener('click', () => openPlan())
$('google-login').addEventListener('click', async () => {
  $('google-login').disabled = true
  try { await store.login() } catch (error) { $('auth-feedback').textContent = error.message } finally { $('google-login').disabled = false }
})
for (const id of ['logout-button', 'switch-account']) $(id).addEventListener('click', async () => { try { await store.logout() } catch (error) { reportError(error) } })

function openCalendarSettings() {
  if (session.status !== 'authorized' || !session.isAdmin) return
  $('calendar-settings-feedback').textContent = ''
  $('calendar-source-url').value = calendarConfig.sourceUrl
  $('open-calendar-url').href = calendarWebUrl(calendarConfig.calendarId)
  $('calendar-config-status').textContent = calendarConfigError
    ? 'A configuração remota não pôde ser lida: ' + calendarConfigError
    : 'Origem oficial: ' + calendarConfig.calendarId + '. '
      + (hasDirectGoogleAccess() ? 'A atualização consulta diretamente o Google Agenda.' : 'A leitura depende da sincronização da cópia no GitHub até a ativação da API.')
  $('calendar-settings-dialog').showModal()
}

$('planner-settings-button').addEventListener('click', openCalendarSettings)
$('copy-calendar-url').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(value('calendar-source-url'))
    $('calendar-settings-feedback').textContent = 'Link copiado.'
  } catch { $('calendar-settings-feedback').textContent = 'Não foi possível copiar automaticamente. Selecione o endereço no campo.' }
})
$('calendar-source-url').addEventListener('input', () => {
  try { $('open-calendar-url').href = calendarWebUrl(parseCalendarSourceUrl(value('calendar-source-url')).calendarId) }
  catch { $('open-calendar-url').removeAttribute('href') }
})
$('calendar-settings-form').addEventListener('submit', async event => {
  event.preventDefault()
  if (session.status !== 'authorized' || !session.isAdmin) return
  const submit = event.submitter
  try {
    const parsed = parseCalendarSourceUrl(value('calendar-source-url'))
    submit.disabled = true
    $('calendar-settings-feedback').textContent = 'Salvando a fonte oficial…'
    await store.saveCalendarConfig(parsed)
    $('calendar-settings-feedback').textContent = hasDirectGoogleAccess()
      ? 'Link salvo. O Planner consultará essa agenda diretamente no Google.'
      : 'Link salvo. O Planner consultará a nova agenda após a sincronização no GitHub.'
  } catch (error) {
    $('calendar-settings-feedback').textContent = error.code === 'permission-denied'
      ? 'O Firebase ainda precisa publicar as regras de acesso às configurações do Planner. O link não foi alterado.'
      : error?.message || 'Não foi possível salvar a agenda.'
  } finally { if (submit) submit.disabled = false }
})

function openCalendarNotifications() {
  if (session.status !== 'authorized') return
  const list = $('calendar-notifications-list')
  list.replaceChildren()
  if (!calendarUnread.length) list.append(node('p', { class: 'muted', text: 'Nenhuma novidade desde sua última consulta. O Planner verifica a agenda automaticamente.' }))
  for (const item of [...calendarUnread].reverse()) {
    const label = { added: 'Evento adicionado', changed: 'Evento alterado', removed: 'Evento removido' }[item.type] || 'Mudança na agenda'
    list.append(node('article', { class: 'calendar-alert-item' }, [
      node('div', { class: 'calendar-alert-icon', text: item.type === 'added' ? '+' : item.type === 'removed' ? '−' : '↻' }),
      node('div', {}, [
        node('strong', { text: label + ': ' + item.title }),
        node('p', { class: 'muted', text: [item.date ? formatDate(item.date) : '', item.detectedAt ? new Date(item.detectedAt).toLocaleString('pt-BR') : ''].filter(Boolean).join(' · ') })
      ])
    ]))
  }
  calendarUnread = []
  writeCalendarTracking(readCalendarTracking()?.events || summarizeCalendarEvents(publicEvents), [])
  updateCalendarBadge()
  $('calendar-notifications-dialog').showModal()
}
$('planner-notifications-button').addEventListener('click', openCalendarNotifications)
$('calendar-notifications-refresh').addEventListener('click', async () => {
  await refreshPublicCalendar()
  $('calendar-notifications-dialog').close()
  openCalendarNotifications()
})

const store = createPlannerStore({
  onSession(next) {
    const previousEmail = session.email
    const wasAdmin = session.isAdmin
    session = next
    const allowed = next.status === 'authorized'
    if (!allowed || previousEmail !== next.email || (wasAdmin && !next.isAdmin)) {
      authEpoch++
      googleClient = null
      googleCalendars = []
      calendarSelection.clear()
      document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close())
      if (!allowed) {
        state = { plans: [], buckets: [], tasks: [], events: [], routines: [] }
        $('view-content').replaceChildren()
        $('notice').textContent = ''
        $('notice').hidden = true
      }
    }
    $('access-gate').hidden = allowed
    $('planner-app').hidden = !allowed
    $('auth-feedback').textContent = next.message || (next.status === 'checking' ? 'Verificando sua sessão…' : '')
    $('access-pending').hidden = next.status !== 'pending'
    $('pending-email').textContent = next.email || ''
    $('google-login').hidden = next.status === 'pending'
    $('member-email').textContent = next.name || next.email || ''
    $('planner-settings-button').hidden = !allowed || !next.isAdmin
    if (allowed) {
      if (!calendarTimer) startCalendarPolling()
      calendarUnread = readCalendarTracking()?.unread || []
      updateCalendarBadge()
      render()
    } else {
      stopCalendarPolling()
      publicSnapshot = null
      publicEvents = []
      calendarUnread = []
      calendarLoadError = ''
      updateCalendarBadge()
    }
  },
  onConfig(next) {
    calendarConfigError = ''
    const newConfig = next && typeof next.calendarId === 'string' && typeof next.sourceUrl === 'string'
      ? { calendarId: next.calendarId, sourceUrl: next.sourceUrl }
      : { calendarId: publicCalendar.id, sourceUrl: publicCalendar.sourceUrl }
    if (newConfig.calendarId !== calendarConfig.calendarId) {
      calendarConfig = newConfig
      publicSnapshot = null
      publicEvents = []
      calendarLoadError = ''
      calendarUnread = readCalendarTracking()?.unread || []
      updateCalendarBadge()
      if (session.status === 'authorized') setTimeout(refreshPublicCalendar, 100)
    } else calendarConfig = newConfig
    if (session.status === 'authorized') render()
  },
  onConfigError(error) {
    calendarConfigError = error?.message || 'Não foi possível consultar as configurações.'
    if (session.status === 'authorized' && currentView === 'integrations') render()
  },
  onData(next) { state = next; if (session.status === 'authorized') { $('save-status').textContent = 'Sincronizado'; render() } },
  onError(error) {
    reportError(error)
    if (error.code === 'permission-denied') $('save-status').textContent = 'Configuração do acesso pendente'
  }
})


