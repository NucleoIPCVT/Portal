import { createPlannerStore } from './planner-store.js'
import { todayISO, addDays, formatDate, calendarCells, computeSummary, validateTask, isOverdue, taskProgress, generateWeeklyTasks } from './planner-core.js'
import { createTaskEditor } from './planner-task-editor.js'
import { GoogleCalendarClient } from './planner-google.js'
import { publicCalendar, readPublicCalendar, hasDirectGoogleAccess, parseCalendarSourceUrl, calendarWebUrl, summarizeCalendarEvents, diffCalendarEvents } from './planner-public.js?v=20261110'

const $ = id => document.getElementById(id)
const labels = { todo: 'Não iniciada', doing: 'Em andamento', done: 'Concluída', low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente' }
const teams = ['Louvor', 'Litúrgico', 'Técnica', 'Mídia', 'Comunicação', 'Comissão']
let state = { plans: [], buckets: [], tasks: [], events: [], routines: [] }
let session = { status: 'checking' }
// Os planos organizam o trabalho; o calendário é uma referência opcional.
let currentView = 'plans'
let eventsYear = Number(todayISO().slice(0, 4))
let calendarDate = todayISO()
let calendarMode = 'month'
let selectedCalendarDay = todayISO()
let calendarShowEvents = true
let calendarShowTasks = true
let boardGrouping = 'status'
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
const taskEditor = createTaskEditor({
  assigneesRoot: $('task-assignees-editor'),
  checklistRoot: $('task-checklist-editor'),
  dependencyRoot: $('task-dependencies-editor')
})

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
function bucketStatus(name = '') {
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  return { 'a fazer': 'todo', 'em andamento': 'doing', 'concluido': 'done' }[normalized] || null
}
function standardBucket(planId, status) {
  return state.buckets.find(bucket => !bucket.deleted && bucket.planId === planId && bucketStatus(bucket.name) === status)
}
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
function requirePlan() {
  if (activePlans().length) return true
  notice('Crie um plano para organizar suas primeiras demandas.')
  openPlan()
  return false
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
      try {
        const status = event.target.checked ? 'done' : 'todo'
        const bucket = standardBucket(task.planId, status)
        await action(() => save('tasks', { ...task, status, bucketId: bucket?.id || task.bucketId }))
      }
      catch { event.target.checked = task.status === 'done' }
    } })
  if (task.eventId) {
    const linkedTitle = liveEvents().find(item => item.id === task.eventId)?.title || 'Evento vinculado'
    card.append(node('span', { class: 'task-event-tag', title: linkedTitle, text: '▧ ' + linkedTitle }))
  }
  card.append(node('div', { class: 'task-heading' }, [toggle, title]))
  if (!selectedPlan() && currentView !== 'board') card.append(node('span', { class: 'task-label', text: planName(task.planId) }))
  const meta = node('div', { class: 'task-meta' })
  if (task.dueDate) meta.append(node('span', { class: 'task-due' + (isOverdue(task, todayISO()) ? ' is-late' : ''), text: '◷ ' + formatDate(task.dueDate) }))
  if (['high', 'urgent'].includes(task.priority)) meta.append(node('span', { class: 'priority priority-' + task.priority, text: labels[task.priority] }))
  if (task.team) meta.append(node('span', { class: 'task-team-chip', text: task.team }))
  if (task.checklist?.length) meta.append(node('span', { class: 'task-checklist-count', text: '☑ ' + task.checklist.filter(item => item.done).length + '/' + task.checklist.length, title: 'Etapas concluídas' }))
  if (task.assignees?.length) {
    const assignees = node('span', { class: 'task-assignee-avatars', 'aria-label': 'Responsáveis: ' + task.assignees.map(person => person.name || person.email).join(', ') })
    for (const person of task.assignees.slice(0, 3)) assignees.append(node('span', { class: 'task-avatar', title: person.name || person.email || 'Responsável', text: (person.name || person.email || '?').trim().slice(0, 1).toUpperCase() }))
    if (task.assignees.length > 3) assignees.append(node('span', { class: 'task-avatar task-avatar-more', text: '+' + (task.assignees.length - 3) }))
    meta.append(assignees)
  }
  if (meta.childNodes.length) card.append(meta)
  if (task.reviewRequired) card.append(node('span', { class: 'badge review-badge', title: task.reviewReason || '', text: 'Revisar prazo' }))
  const unmet = (task.dependencyIds || []).filter(id => byId('tasks', id)?.status !== 'done')
  if (unmet.length) card.append(node('span', { class: 'badge', text: unmet.length + ' dependência(s) pendente(s)' }))
  card.addEventListener('dragstart', event => { draggedTask = task.id; event.dataTransfer.setData('text/plain', task.id); event.dataTransfer.effectAllowed = 'move' })
  card.addEventListener('dragend', () => { draggedTask = '' })
  return card
}
function viewActions() {
  const toolbar = node('div', { class: 'view-actions' })
  if (currentView === 'board' && activePlans().length > 1 && !selectedPlan()) {
    const select = node('select', { 'aria-label': 'Plano exibido no quadro', onChange: event => { $('plan-filter').value = event.target.value; render() } },
      activePlans().map((plan, i) => node('option', { value: plan.id, text: plan.name, selected: i === 0 })))
    toolbar.append(node('label', { class: 'board-plan-choice' }, ['Plano ', select]))
  }
  if (selectedPlan()) toolbar.append(button('Editar plano e colunas', () => openPlan(byId('plans', selectedPlan())), 'button button-small'))
  return toolbar
}
function quickAddTask(column, planId, bucketId, status) {
  const form = node('form', { class: 'quick-task-form', onSubmit: async event => {
    event.preventDefault()
    const title = input.value.trim()
    if (!title) return input.focus()
    const candidate = { id: newId(), title, planId, bucketId, status, priority: 'normal', team: '', description: '', assignees: [], startDate: '', dueDate: '', checklist: [], dependencyIds: [], eventId: '', dateMode: 'manual', dueOffsetDays: null }
    const errors = validateTask(candidate, state.tasks)
    if (errors.length) return notice(errors.join(' '), true)
    submit.disabled = true
    try { await action(() => save('tasks', candidate), 'Demanda criada. Abra o cartão para completar os detalhes.'); render() }
    catch { submit.disabled = false }
  } })
  const input = node('input', { type: 'text', required: true, maxLength: 160, placeholder: 'Nome da demanda', 'aria-label': 'Nome da nova demanda' })
  const submit = node('button', { type: 'submit', class: 'button button-primary button-small', text: 'Adicionar' })
  form.append(input, node('div', { class: 'quick-task-actions' }, [submit, button('Cancelar', () => form.replaceWith(addButton), 'button button-small button-quiet')]))
  const addButton = button('+ Adicionar demanda', () => { addButton.replaceWith(form); input.focus() }, 'button button-small quick-add-button')
  column.append(addButton)
}
function renderBoard(content, tasks) {
  const plan = activePlans().find(item => item.id === selectedPlan()) || activePlans()[0]
  if (!plan) return content.append(empty('Crie um plano para organizar demandas no quadro.'))
  const buckets = state.buckets.filter(bucket => bucket.planId === plan.id && !bucket.deleted).sort((a, b) => a.order - b.order)
  const groupChoices = [['status', 'Andamento'], ['bucket', 'Etapas do plano']]
  const groupSelect = node('select', { 'aria-label': 'Agrupar quadro por', onChange: event => { boardGrouping = event.target.value; render() } }, groupChoices.map(([key, title]) => node('option', { value: key, text: title, selected: boardGrouping === key })))
  const actions = viewActions()
  actions.append(node('label', { class: 'board-group-choice' }, ['Agrupar por ', groupSelect]))
  const planTasks = tasks.filter(task => task.planId === plan.id)
  const statusGroups = [{ id: 'todo', name: 'A fazer' }, { id: 'doing', name: 'Em andamento' }, { id: 'done', name: 'Concluído' }]
  const groups = boardGrouping === 'status' ? statusGroups : [...buckets]
  if (boardGrouping === 'bucket' && (planTasks.some(task => !buckets.some(bucket => bucket.id === task.bucketId)) || !groups.length)) groups.push({ id: '', name: 'Outras demandas' })
  const grid = node('div', { class: 'board-grid' + (boardGrouping === 'status' ? ' board-by-status' : '') })
  for (const group of groups) {
    const entries = planTasks.filter(task => boardGrouping === 'status' ? task.status === group.id : (group.id ? task.bucketId === group.id : !buckets.some(item => item.id === task.bucketId)))
    const status = boardGrouping === 'status' ? group.id : (bucketStatus(group.name) || 'todo')
    const bucketId = boardGrouping === 'status' ? (standardBucket(plan.id, group.id)?.id || '') : group.id
    const column = node('section', { class: 'bucket-column bucket-' + status, 'data-bucket-id': bucketId, 'aria-label': group.name })
    column.append(node('div', { class: 'bucket-heading' }, [node('h3', { text: group.name }), node('span', { class: 'badge', text: entries.length })]))
    column.append(...entries.map(taskCard))
    quickAddTask(column, plan.id, bucketId, status)
    column.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; column.classList.add('drag-over') })
    column.addEventListener('dragleave', event => { if (!column.contains(event.relatedTarget)) column.classList.remove('drag-over') })
    column.addEventListener('drop', async event => {
      event.preventDefault()
      column.classList.remove('drag-over')
      const task = byId('tasks', event.dataTransfer.getData('text/plain') || draggedTask)
      if (!task) return
      if (task.planId !== plan.id) return notice('Para mover entre planos, abra a demanda e altere o plano.')
      const targetBucket = boardGrouping === 'status' && !bucketId ? task.bucketId : bucketId
      try { await action(() => save('tasks', { ...task, bucketId: targetBucket, status: boardGrouping === 'status' ? status : bucketStatus(group.name) || task.status })) } catch {}
    })
    grid.append(column)
  }
  content.append(actions, grid)
  if (!planTasks.length) content.append(node('p', { class: 'board-empty-hint', text: 'Você ainda não tem demandas neste plano. Adicione a primeira diretamente no quadro.' }))
}
function renderList(content, tasks) {
  const table = node('table', { class: 'data-table' })
  table.append(node('thead', {}, node('tr', {}, ['Demanda', selectedPlan() ? 'Coluna' : 'Plano / Coluna', 'Responsáveis', 'Equipe', 'Prazo', 'Andamento'].map(text => node('th', { scope: 'col', text })))))
  table.append(node('tbody', {}, tasks.map(task => node('tr', {}, [
    node('td', {}, button(task.title, () => openTask(task), 'task-title')),
    node('td', { text: selectedPlan() ? bucketName(task.bucketId) : planName(task.planId) + ' / ' + bucketName(task.bucketId) }),
    node('td', { text: task.assignees?.map(person => person.name || person.email).join(', ') || 'Sem responsável' }),
    node('td', { text: task.team || '—' }),
    node('td', { class: isOverdue(task, todayISO()) ? 'overdue' : '', text: formatDate(task.dueDate) }),
    node('td', {}, node('span', { class: 'status-pill status-' + task.status, text: labels[task.status] }))
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
  const globalCalendar = currentView === 'calendar-all'
  const header = node('div', { class: 'calendar-toolbar' })
  const heading = node('div', { class: 'calendar-toolbar-title' })
  const navigate = direction => {
    if (calendarMode === 'week') calendarDate = addDays(calendarDate, direction * 7)
    else {
      const date = new Date(calendarDate.slice(0, 7) + '-01T12:00:00Z')
      date.setUTCMonth(date.getUTCMonth() + direction)
      calendarDate = date.toISOString().slice(0, 10)
    }
    selectedCalendarDay = calendarDate
    render()
  }
  const title = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(calendarDate + 'T12:00:00Z'))
  heading.append(node('strong', { text: title }), node('span', { text: globalCalendar ? 'Demandas e referências da Agenda IPCVT' : 'Prazos das demandas deste plano' }))
  const mode = node('select', { 'aria-label': 'Período do calendário', onChange: event => { calendarMode = event.target.value; selectedCalendarDay = calendarDate; render() } }, [
    node('option', { value: 'month', text: 'Mês', selected: calendarMode === 'month' }),
    node('option', { value: 'week', text: 'Semana', selected: calendarMode === 'week' })
  ])
  const controls = node('div', { class: 'calendar-controls' })
  controls.append(button('‹', () => navigate(-1), 'calendar-arrow'), button('›', () => navigate(1), 'calendar-arrow'), button('Hoje', () => { calendarDate = todayISO(); selectedCalendarDay = calendarDate; render() }, 'button button-small'), mode)
  if (globalCalendar) {
    const taskToggle = button(calendarShowTasks ? '✓ Demandas' : 'Demandas', () => { calendarShowTasks = !calendarShowTasks; render() }, 'button button-small calendar-task-toggle')
    taskToggle.setAttribute('aria-pressed', String(calendarShowTasks))
    const eventToggle = button(calendarShowEvents ? '✓ Eventos da igreja' : 'Eventos da igreja', () => { calendarShowEvents = !calendarShowEvents; render() }, 'button button-small calendar-event-toggle')
    eventToggle.setAttribute('aria-pressed', String(calendarShowEvents))
    controls.append(taskToggle, eventToggle)
  }
  header.append(heading, controls)
  const grid = node('div', { class: 'calendar-grid' })
  grid.append(...['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(text => node('div', { class: 'calendar-weekday', text })))
  const datedTasks = new Map()
  for (const task of globalCalendar && !calendarShowTasks ? [] : tasks) {
    const date = task.dueDate || task.startDate
    if (!date) continue
    if (!datedTasks.has(date)) datedTasks.set(date, [])
    datedTasks.get(date).push(task)
  }
  const datedEvents = new Map()
  if (globalCalendar && calendarShowEvents) for (const event of liveEvents().filter(item => item.startDate && item.status !== 'cancelled')) {
    if (!datedEvents.has(event.startDate)) datedEvents.set(event.startDate, [])
    datedEvents.get(event.startDate).push(event)
  }
  for (const date of calendarDates()) {
    const dayTasks = datedTasks.get(date) || []
    const dayEvents = datedEvents.get(date) || []
    const day = node('section', { class: 'calendar-day' + (date.slice(0, 7) !== calendarDate.slice(0, 7) ? ' other-month' : '') + (date === todayISO() ? ' today' : '') + (date === selectedCalendarDay ? ' selected' : ''), 'aria-label': formatDate(date), 'data-calendar-date': date })
    const dayButton = button(String(Number(date.slice(-2))), () => { selectedCalendarDay = date; render() }, 'calendar-date')
    dayButton.setAttribute('aria-label', 'Ver compromissos de ' + formatDate(date))
    dayButton.setAttribute('aria-pressed', String(date === selectedCalendarDay))
    day.append(dayButton)
    const counts = node('span', { class: 'calendar-day-count', 'aria-hidden': 'true' })
    if (dayTasks.length) counts.append(node('span', { class: 'calendar-count-tasks', title: dayTasks.length + ' demandas' }))
    if (dayEvents.length) counts.append(node('span', { class: 'calendar-count-events', title: dayEvents.length + ' eventos' }))
    day.append(counts)
    for (const task of dayTasks.slice(0, 3)) {
      const entry = button(task.title, () => openTask(task), 'calendar-task' + (task.status === 'done' ? ' completed' : ''))
      entry.draggable = true
      entry.addEventListener('dragstart', event => { draggedTask = task.id; event.dataTransfer.setData('text/plain', task.id) })
      day.append(entry)
    }
    for (const event of dayEvents.slice(0, Math.max(0, 4 - Math.min(3, dayTasks.length)))) day.append(button(event.title, () => openEvent(event), 'calendar-source-event'))
    const rest = dayTasks.length + dayEvents.length - Math.min(3, dayTasks.length) - Math.min(dayEvents.length, Math.max(0, 4 - Math.min(3, dayTasks.length)))
    if (rest > 0) day.append(button('+' + rest + ' outros', () => { selectedCalendarDay = date; render() }, 'calendar-more'))
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
  const dayTasks = datedTasks.get(selectedCalendarDay) || []
  const dayEvents = datedEvents.get(selectedCalendarDay) || []
  const dayDetails = node('section', { class: 'calendar-day-details', 'aria-label': 'Compromissos do dia selecionado' })
  const detailsHeader = node('div', { class: 'calendar-day-details-head' }, [
    node('div', {}, [node('h3', { text: new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(selectedCalendarDay + 'T12:00:00Z')) }), node('p', { class: 'muted', text: dayTasks.length + ' demanda(s)' + (globalCalendar ? ' · ' + dayEvents.length + ' evento(s)' : '') })]),
    button('+ Demanda neste dia', () => { if (requirePlan()) openTask(null, { dueDate: selectedCalendarDay }) }, 'button button-small button-primary')
  ])
  dayDetails.append(detailsHeader)
  if (!dayTasks.length && !dayEvents.length) dayDetails.append(node('p', { class: 'calendar-day-details-empty', text: 'Nenhuma demanda ou evento para este dia.' }))
  else {
    for (const task of dayTasks) dayDetails.append(node('div', { class: 'calendar-detail-row' }, [node('span', { class: 'calendar-detail-dot task-dot' }), button(task.title, () => openTask(task), 'task-title'), node('small', { text: planName(task.planId) })]))
    for (const event of dayEvents) dayDetails.append(node('div', { class: 'calendar-detail-row' }, [node('span', { class: 'calendar-detail-dot event-dot' }), button(event.title, () => openEvent(event), 'task-title'), node('small', { text: 'Agenda IPCVT' })]))
  }
  content.append(header, node('div', { class: 'calendar-wrap' }, grid), dayDetails)
  const undated = (globalCalendar && !calendarShowTasks ? [] : tasks).filter(task => !task.dueDate && !task.startDate)
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

function openPlanBoard(planId) {
  clearTaskFilters()
  $('plan-filter').value = planId
  changeView('board', { preserveFilters: true })
}

function renderPlans(content) {
  const plans = activePlans().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  content.append(node('div', { class: 'plans-intro' }, [
    node('div', {}, [node('h3', { text: 'Espaços de trabalho da Comissão' }), node('p', { text: 'Organize demandas por equipe ou projeto. Um evento simples não precisa de um plano exclusivo.' })]),
    button('+ Novo plano', () => openPlan(), 'button button-primary')
  ]))
  if (!plans.length) {
    content.append(empty('Você ainda não tem planos. Crie um plano, adicione colunas e distribua as tarefas da Comissão.'))
    return
  }
  const cards = node('div', { class: 'plans-grid' })
  for (const plan of plans) {
    const tasks = liveTasks().filter(task => task.planId === plan.id)
    const finished = tasks.filter(task => task.status === 'done').length
    const percentage = tasks.length ? Math.round(finished * 100 / tasks.length) : 0
    const card = node('article', { class: 'plan-card' })
    card.append(node('span', { class: 'plan-card-icon', 'aria-hidden': 'true', text: plan.name.slice(0, 1).toLocaleUpperCase('pt-BR') }))
    card.append(button(plan.name, () => openPlanBoard(plan.id), 'plan-card-title'))
    card.append(node('p', { class: 'plan-card-description', text: plan.description || (plan.kind === 'project' ? 'Projeto da Comissão' : 'Trabalho contínuo da Comissão') }))
    card.append(node('div', { class: 'plan-card-progress-label' }, [node('span', { text: finished + ' de ' + tasks.length + ' concluídas' }), node('strong', { text: percentage + '%' })]))
    card.append(node('div', { class: 'plan-card-progress' }, node('span', { style: 'width:' + percentage + '%' })))
    card.append(node('div', { class: 'plan-card-footer' }, [
      button('Abrir plano', () => openPlanBoard(plan.id), 'button button-small button-primary'),
      button('+ Demanda', () => { openPlanBoard(plan.id); openTask(null, { planId: plan.id }) }, 'button button-small')
    ]))
    cards.append(card)
  }
  content.append(cards)
}

function renderEvents(content) {
  const events = liveEvents().filter(event => event.startDate)
  content.append(node('div', { class: 'event-reference-heading' }, [
    node('p', { text: 'Esta agenda serve de referência. As demandas são criadas dentro dos planos; ao editar uma tarefa, você pode selecionar o evento-alvo.' }),
    button('Meus planos', () => changeView('plans'), 'button button-small')
  ]))
  const years = [...new Set([eventsYear - 1, eventsYear, eventsYear + 1, ...events.map(event => Number(event.startDate.slice(0, 4)))])]
    .filter(year => Number.isInteger(year) && year > 2000 && year < 2200).sort((a, b) => a - b)
  const picker = node('select', { 'aria-label': 'Ano dos eventos', onChange: event => { eventsYear = Number(event.target.value); render() } },
    years.map(year => node('option', { value: year, text: String(year), selected: year === eventsYear })))
  content.append(node('div', { class: 'event-hub-controls' }, node('label', { class: 'event-year-label' }, ['Ano ', picker])))
  const query = value('search-filter').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const relevant = events.filter(event => event.startDate.startsWith(String(eventsYear)) && (!query ||
    [event.title, event.description || ''].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(query)))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title, 'pt-BR'))
  if (!relevant.length) return content.append(empty('Nenhum evento encontrado neste ano na Agenda IPCVT.'))
  const months = new Map()
  for (const event of relevant) {
    const key = event.startDate.slice(0, 7)
    if (!months.has(key)) months.set(key, [])
    months.get(key).push(event)
  }
  for (const [month, items] of months) {
    const group = node('section', { class: 'planner-event-month' })
    const label = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(month + '-01T12:00:00Z'))
    group.append(node('div', { class: 'event-month-heading' }, [node('h3', { text: label }), node('span', { class: 'badge', text: String(items.length) })]))
    group.append(node('div', { class: 'event-reference-list' }, items.map(event => node('div', { class: 'event-reference-row' }, [
      node('div', { class: 'event-day-badge' }, [node('strong', { text: String(Number(event.startDate.slice(-2))) }), node('small', { text: new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' }).format(new Date(event.startDate + 'T12:00:00Z')) })]),
      node('div', {}, [button(event.title, () => openEvent(event), 'task-title'), node('small', { class: 'muted', text: eventDateLabel(event) + (event.status === 'cancelled' ? ' · Cancelado' : '') })]),
      button('Detalhes', () => openEvent(event), 'button button-small')
    ]))))
    content.append(group)
  }
}

function renderMyDay(content, tasks) {
  const mine = liveTasks().filter(task => (task.assignees || []).some(person => person.email?.toLowerCase() === session.email))
  const today = todayISO()
  const upcoming = addDays(today, 7)
  const groups = [
    ['Atrasadas', mine.filter(task => isOverdue(task, today))],
    ['Para hoje', mine.filter(task => task.status !== 'done' && task.dueDate === today)],
    ['Próximos 7 dias', mine.filter(task => task.status !== 'done' && task.dueDate > today && task.dueDate <= upcoming)],
    ['Outras demandas', mine.filter(task => task.status !== 'done' && (!task.dueDate || task.dueDate > upcoming))]
  ]
  if (currentView === 'home') groups.splice(2)
  content.append(node('div', { class: 'my-day-heading' }, [node('div', {}, [node('h3', { text: currentView === 'home' ? 'Prioridades do dia' : 'Minhas tarefas' }), node('p', { class: 'muted', text: 'Entregas atribuídas ao seu e-mail, organizadas por prazo.' })]), node('span', { class: 'badge', text: mine.filter(task => task.status !== 'done').length + ' pendente(s)' })]))
  if (currentView === 'home' && !groups.some(([, entries]) => entries.length)) content.append(empty('Nenhuma tarefa sua vence hoje e não há pendências atrasadas.'))
  else if (!mine.length) content.append(empty('Nenhuma tarefa atribuída ao seu e-mail.'))
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
  if (currentView === 'home') content.append(button('Ver todas as minhas tarefas', () => changeView('mine'), 'button button-small'))
}
function renderRoutines(content) {
  content.append(node('p', { class: 'muted', text: 'Rotinas semanais criam demandas recorrentes. Para um evento específico, crie demandas vinculadas à data oficial.' }), button('+ Nova rotina semanal', () => { if (requirePlan()) openRoutine() }, 'button button-primary'))
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
    node('p', { text: 'Os eventos públicos aparecem na seção Agenda da igreja, para consulta e para vincular como evento-alvo de uma demanda. Nenhum integrante precisa conectar a própria conta Google. O Planner não escreve na agenda da igreja.' }),
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
const taskFilterIds = ['plan-filter', 'team-filter', 'assignee-filter', 'status-filter', 'event-filter']
const taskViews = new Set(['board', 'list', 'calendar', 'calendar-all', 'gantt', 'summary'])
function clearTaskFilters() {
  for (const id of taskFilterIds) $(id).value = ''
  $('search-filter').value = ''
}
function changeView(view, { preserveFilters = false } = {}) {
  const previous = currentView
  if (!preserveFilters && (!taskViews.has(view) || !taskViews.has(previous))) clearTaskFilters()
  currentView = view
  $('mobile-more-menu').open = false
  if (['integrations', 'routines'].includes(view) || (view === 'list' && !selectedPlan())) $('nav-extras').open = true
  render()
}

function chooseView(control) {
  const insidePlan = !!control.closest('.plan-view-tabs')
  if (control.dataset.view === 'calendar-all') {
    clearTaskFilters()
    changeView('calendar-all', { preserveFilters: true })
    return
  }
  if (control.dataset.view === 'list' && !insidePlan) {
    clearTaskFilters()
    changeView('list', { preserveFilters: true })
    return
  }
  changeView(control.dataset.view, { preserveFilters: insidePlan })
}

function render() {
  if (session.status !== 'authorized') return
  refreshFilters()
  const selected = activePlans().find(plan => plan.id === selectedPlan())
  const withinPlan = !!selected && taskViews.has(currentView) && currentView !== 'calendar-all'
  const sidebarPlans = $('sidebar-plan-list')
  sidebarPlans.replaceChildren(...activePlans().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map(plan => {
    const entry = button(plan.name, () => openPlanBoard(plan.id), 'sidebar-plan-link')
    entry.title = plan.name
    entry.setAttribute('aria-current', withinPlan && selected.id === plan.id ? 'page' : 'false')
    return entry
  }))
  if (!activePlans().length) sidebarPlans.append(node('span', { class: 'sidebar-plan-empty', text: 'Nenhum plano criado' }))
  $('search-filter').parentElement.querySelector('span').textContent = currentView === 'events' ? 'Buscar evento' : 'Buscar demanda'
  $('search-filter').placeholder = currentView === 'events' ? 'Encontre um evento pelo nome' : 'Nome, responsável ou equipe'
  const title = { home: 'Início', mine: 'Minhas demandas', plans: 'Planos da Comissão', events: 'Agenda da igreja', board: 'Quadro', list: 'Todas as demandas', calendar: 'Calendário', 'calendar-all': 'Calendário', gantt: 'Cronograma', summary: 'Gráficos', integrations: 'Google Agenda', routines: 'Rotinas semanais' }[currentView]
  $('view-title').textContent = withinPlan ? selected.name : title
  $('view-title').parentElement.querySelector('.view-heading-note').textContent = withinPlan
    ? selected.description || 'Organize e acompanhe todas as tarefas deste plano.'
    : ({ home: 'O que você precisa acompanhar hoje.', mine: 'Suas tarefas, em todos os planos.', plans: 'Escolha um plano para começar a trabalhar.', events: 'Datas oficiais para consulta e referência das tarefas.', 'calendar-all': 'Visualize os prazos de todos os planos e os eventos oficiais da igreja.', list: 'Todas as tarefas, de todos os planos.', integrations: 'Fonte oficial e sincronização do calendário.', routines: 'Demandas que se repetem semanalmente.' })[currentView] || ''
  document.querySelectorAll('[data-view]').forEach(control => control.setAttribute('aria-pressed', String(control.dataset.view === currentView && (control.closest('.plan-view-tabs') || !withinPlan))))
  $('plan-view-tabs').hidden = !withinPlan
  $('plan-filter').closest('label').style.display = withinPlan ? 'none' : ''
  const filterVisible = currentView === 'events' || taskViews.has(currentView)
  $('workspace-filter-strip').hidden = !filterVisible
  $('advanced-filters').hidden = currentView === 'events'
  const filterCount = taskFilterIds.filter(id => $(id).value).length
  $('filter-count').textContent = String(filterCount)
  $('filter-count').hidden = !filterCount
  $('clear-filters').hidden = !filterCount && !value('search-filter')
  const content = $('view-content')
  content.replaceChildren()
  if (!activePlans().length && taskViews.has(currentView) && currentView !== 'calendar-all') {
    content.append(empty('Crie um plano para reunir suas demandas e acompanhar o andamento.'), button('Criar plano', () => openPlan(), 'button button-primary'))
    return
  }
  const tasks = visibleTasks()
  ;({ home: renderMyDay, mine: renderMyDay, plans: renderPlans, events: renderEvents, board: renderBoard, list: renderList, calendar: renderCalendar, 'calendar-all': renderCalendar, gantt: renderGantt, summary: renderSummary, integrations: renderIntegrations, routines: renderRoutines }[currentView])(content, tasks)
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
  $('task-dialog-title').textContent = task ? 'Editar demanda' : 'Nova demanda'
  $('task-id').value = current.id || ''
  $('task-dialog').dataset.version = current.version ?? ''
  $('task-title').value = current.title || ''
  setOptions($('task-plan'), activePlans().map(plan => [plan.id, plan.name]), current.planId)
  const firstBucket = state.buckets.filter(bucket => !bucket.deleted && bucket.planId === current.planId).sort((a, b) => a.order - b.order)[0]
  fillBucketSelect($('task-bucket'), current.planId, current.bucketId || (!task ? firstBucket?.id : ''))
  for (const [field, key] of [['task-team', 'team'], ['task-start', 'startDate'], ['task-due', 'dueDate'], ['task-description', 'description']]) $(field).value = current[key] || ''
  $('task-status').value = current.status
  $('task-priority').value = current.priority
  const dependencies = state.tasks.filter(item => item.planId === current.planId && item.id !== current.id && (!item.deleted || current.dependencyIds?.includes(item.id)))
  const people = [...state.tasks.flatMap(item => item.assignees || []), { name: session.name || '', email: session.email || '' }]
  taskEditor.setTask(current, { people, dependencies })
  const eventOptions = liveEvents().filter(event => event.startDate && (event.status !== 'cancelled' || event.id === current.eventId))
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map(event => [event.id, event.title + ' · ' + formatDate(event.startDate) + (event.status === 'cancelled' ? ' · Cancelado' : '')])
  if (current.eventId && !eventOptions.some(([id]) => id === current.eventId)) eventOptions.push([current.eventId, 'Evento indisponível · vínculo preservado'])
  setOptions($('task-event'), eventOptions, current.eventId || '', ['', 'Sem evento-alvo'])
  $('task-date-mode').value = current.dateMode || 'manual'
  $('task-offset').value = current.dueOffsetDays ?? 0
  $('legacy-relative-dates').hidden = current.dateMode !== 'event'
  $('task-advanced').open = !!current.dependencyIds?.length || current.dateMode === 'event' || (!!task && !bucketStatus(bucketName(current.bucketId)))
  $('task-details').open = !!(current.description || current.checklist?.length)
  updateTaskEventFields()
  $('delete-task-button').hidden = !task
  $('complete-task-button').hidden = !task
  $('complete-task-button').textContent = current.status === 'done' ? 'Reabrir demanda' : 'Concluir demanda'
  $('task-dialog').showModal()
  $('task-title').focus()
}
function updateTaskEventFields(recalculate = false) {
  const event = liveEvents().find(item => item.id === value('task-event'))
  if (!event && value('task-date-mode') === 'event') $('task-date-mode').value = 'manual'
  const relative = value('task-date-mode') === 'event' && !!event
  $('task-date-mode').querySelector('[value="event"]').disabled = !event
  $('task-offset').disabled = !relative
  $('task-offset').closest('.field')?.classList.toggle('is-disabled', !relative)
  $('task-event-hint').textContent = event
    ? 'Evento-alvo: ' + event.title + ' · ' + formatDate(event.startDate) + '. ' + (relative ? 'Esta demanda antiga usa um prazo relacionado ao evento.' : 'O prazo desta demanda é independente da data do evento.')
    : ''
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
$('task-due').addEventListener('input', () => {
  if (value('task-date-mode') === 'event') {
    $('task-date-mode').value = 'manual'
    updateTaskEventFields()
  }
})
$('task-plan').addEventListener('change', () => {
  fillBucketSelect($('task-bucket'), value('task-plan'))
  taskEditor.setDependencies(liveTasks().filter(task => task.planId === value('task-plan') && task.id !== value('task-id')))
})
$('task-bucket').addEventListener('change', () => {
  const status = bucketStatus(bucketName(value('task-bucket')))
  if (status) $('task-status').value = status
})
$('task-status').addEventListener('change', () => {
  const bucket = standardBucket(value('task-plan'), value('task-status'))
  if (bucket) $('task-bucket').value = bucket.id
})
$('task-form').addEventListener('submit', async event => {
  event.preventDefault()
  const submit = event.submitter || $('task-form').querySelector('[type=submit]')
  submit.disabled = true
  try {
    const previous = byId('tasks', value('task-id'))
    if (value('task-id') && !previous) throw new Error('Esta demanda não está mais disponível. Feche a janela e atualize a tela.')
    if (previous && String(previous.version) !== $('task-dialog').dataset.version) throw new Error('Esta demanda foi atualizada por outra pessoa. Feche e abra novamente antes de salvar.')
    const editorError = taskEditor.validate()
    if (editorError) throw new Error(editorError)
    const task = { ...(previous || {}), id: previous?.id || newId(), title: value('task-title'), planId: value('task-plan'), bucketId: value('task-bucket'), team: value('task-team'), description: value('task-description'), assignees: taskEditor.getAssignees(), startDate: value('task-start'), dueDate: value('task-due'), status: value('task-status'), priority: value('task-priority'), checklist: taskEditor.getChecklist(), dependencyIds: taskEditor.getDependencyIds(), eventId: value('task-event'), dateMode: value('task-date-mode'), dueOffsetDays: value('task-date-mode') === 'event' ? Number(value('task-offset')) : null }
    const linkedEvent = liveEvents().find(event => event.id === task.eventId)
    if (linkedEvent?.status === 'cancelled' && previous?.eventId !== task.eventId) throw new Error('Este evento foi cancelado. Escolha outro evento ou salve como demanda sem evento-alvo.')
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
$('complete-task-button').addEventListener('click', () => {
  const status = value('task-status') === 'done' ? 'todo' : 'done'
  $('task-status').value = status
  const bucket = standardBucket(value('task-plan'), status)
  if (bucket) $('task-bucket').value = bucket.id
  $('task-form').requestSubmit()
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
  $('plan-buckets').value = plan ? state.buckets.filter(bucket => bucket.planId === plan.id && !bucket.deleted).sort((a, b) => a.order - b.order).map(bucket => bucket.name).join('\n') : 'A fazer\nEm andamento\nConcluído'
  $('plan-advanced').open = !!plan
  $('delete-plan-button').hidden = !plan
  $('delete-plan-button').textContent = 'Arquivar plano'
  $('plan-dialog').showModal()
  $('plan-name').focus()
}
$('plan-kind').addEventListener('change', () => { if (!value('plan-id')) $('plan-buckets').value = 'A fazer\nEm andamento\nConcluído' })
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
    changeView('board', { preserveFilters: true })
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

document.querySelectorAll('[data-view]').forEach(control => control.addEventListener('click', () => chooseView(control)))
for (const id of ['plan-filter', 'team-filter', 'assignee-filter', 'status-filter', 'event-filter']) $(id).addEventListener('change', render)
$('search-filter').addEventListener('input', render)
$('clear-filters').addEventListener('click', () => { clearTaskFilters(); render() })
$('new-task-button').addEventListener('click', () => { if (requirePlan()) openTask() })
$('mobile-new-plan').addEventListener('click', () => { $('mobile-more-menu').open = false; openPlan() })
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


