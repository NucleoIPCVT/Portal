import { createPlannerStore } from './planner-store.js?v=20261113-rodizio-v1'
import {
  taskRecurrence,setTaskRecurrence,recurrenceLabel,nextRecurrenceDate,
  rotationConfigId,parseRotationConfig,rotationConfigRecord,rotationAssigneesForDate,
  recurrenceDateAt,recurrenceCycleIndex
} from './planner-recurrence.js?v=20261113-rodizio-v1'
import { todayISO, addDays, formatDate, calendarCells, computeSummary, validateTask, isOverdue, taskProgress, generateWeeklyTasks } from './planner-core.js'
import { createTaskEditor } from './planner-task-editor.js?v=20261113-rodizio-v1'
import { taskCreationContext } from './planner-task-context.js'
import { BOARD_GROUPINGS, groupBoardTasks, moveBoardTask } from './planner-board.js?v=20261112-planner-01'
import { GoogleCalendarClient } from './planner-google.js'
import { publicCalendar, readPublicCalendar, hasDirectGoogleAccess, parseCalendarSourceUrl, calendarWebUrl, summarizeCalendarEvents, diffCalendarEvents } from './planner-public.js?v=20261110'

const $ = id => document.getElementById(id)
const labels = { todo: 'Não iniciada', doing: 'Em andamento', done: 'Concluída', low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente' }
const teams = ['Louvor', 'Litúrgico', 'Técnica', 'Mídia', 'Comunicação', 'Comissão']
let state = { plans: [], buckets: [], tasks: [], events: [], routines: [] }
let session = { status: 'checking' }
// Os planos organizam o trabalho; o calendário é uma referência opcional.
let currentView = 'home'
let eventsYear = Number(todayISO().slice(0, 4))
let calendarDate = todayISO()
let calendarMode = 'week'
let selectedCalendarDay = todayISO()
let calendarShowEvents = true
let calendarShowTasks = true
let boardGrouping = 'status'
let googleClient = null
let googleCalendars = []
const calendarSelection = new Set()
let draggedTask = ''
let draggedTaskGroup = ''
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
let rotationEditorReady=false
let rotationGroupsByPerson=new Map()
const taskEditor = createTaskEditor({
  assigneesRoot: $('task-assignees-editor'),
  checklistRoot: $('task-checklist-editor'),
  dependencyRoot: $('task-dependencies-editor'),
  onAssigneesChange:()=>{
    if(rotationEditorReady)updateRotationEditor()
  }
})
rotationEditorReady=true

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
function save(kind,item,options={}){
  return store.save(kind,item,{
    ...(item.version===undefined?{}:{expectedVersion:item.version}),...options
  })
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
  if (taskRecurrence(task)) meta.append(node('span', { class: 'task-repeat-badge', text: '↻ ' + recurrenceLabel(task) }))
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
function renderWeeklyCalendar(content, header, datedTasks, datedEvents, tasks, globalCalendar) {
  const dates = calendarDates()
  const sunday = dates[6]
  const weekTasks = dates.flatMap(date => datedTasks.get(date) || [])
  const weekEvents = dates.flatMap(date => datedEvents.get(date) || [])
  const done = weekTasks.filter(task => task.status === 'done').length
  const summary = node('div', { class: 'week-summary', 'aria-label': 'Resumo da semana' }, [
    node('div', { class: 'week-summary-intro' }, [
      node('strong', { text: 'Preparação para domingo' }),
      node('span', { text: 'Domingo, ' + formatDate(sunday) })
    ]),
    node('div', { class: 'week-summary-stats' }, [
      node('span', { text: weekTasks.length + ' demanda(s) · ' + done + ' concluída(s)' }),
      node('span', { text: weekEvents.length + ' evento(s) oficial(is)' })
    ])
  ])
  function dayCard(date, spotlight = false) {
    const index = dates.indexOf(date)
    const name = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'][index]
    const dayTasks = datedTasks.get(date) || []
    const dayEvents = datedEvents.get(date) || []
    const card = node('section', {
      class: 'week-day-card' + (spotlight ? ' week-sunday' : '') + (date === todayISO() ? ' week-today' : ''),
      'aria-label': name + ', ' + formatDate(date)
    })
    const head = node('div', { class: 'week-day-head' }, [
      node('div', {}, [
        node('span', { class: 'week-day-name', text: name }),
        node('strong', { class: 'week-day-date', text: formatDate(date) })
      ]),
      node('span', { class: 'week-day-count', text: dayTasks.length + ' demanda(s)' })
    ])
    card.append(head)
    if (spotlight) card.append(node('p', { class: 'week-sunday-description', text: 'Eventos e entregas do domingo em um só lugar.' }))
    const entries = node('div', { class: 'week-day-entries' })
    for (const event of dayEvents) {
      const entry = button(event.title, () => openEvent(event), 'week-event-item')
      entry.prepend(node('span', { class: 'week-entry-kind', text: 'Evento' }))
      entry.append(node('small', { text: eventDateLabel(event) }))
      entries.append(entry)
    }
    for (const task of dayTasks) {
      const entry = button(task.title, () => openTask(task), 'week-task-item' + (task.status === 'done' ? ' completed' : '') + (isOverdue(task, todayISO()) ? ' overdue' : ''))
      entry.prepend(node('span', { class: 'week-entry-kind', text: task.status === 'done' ? 'Concluída' : 'Demanda' }))
      entry.append(node('small', { text: globalCalendar ? planName(task.planId) : (task.team || labels[task.status]) }))
      entries.append(entry)
    }
    if (!dayTasks.length && !dayEvents.length) entries.append(node('p', { class: 'week-day-empty', text: spotlight ? 'Nenhum evento ou prazo registrado para domingo.' : 'Sem eventos ou entregas neste dia.' }))
    card.append(entries)
    card.append(button('+ Nova demanda', () => { if (requirePlan()) openTask(null, { dueDate: date }) }, 'week-add-task'))
    return card
  }
  const workdays = node('div', { class: 'week-workdays' })
  for (const date of dates.slice(0, 6)) workdays.append(dayCard(date))
  const layout = node('div', { class: 'week-layout' })
  layout.append(workdays, dayCard(sunday, true))
  content.append(header, summary, layout)
  const undated = (globalCalendar && !calendarShowTasks ? [] : tasks).filter(task => !task.dueDate && !task.startDate)
  if (undated.length) {
    content.append(node('div', { class: 'week-undated' }, [
      node('h3', { text: 'Demandas sem prazo definido' }),
      node('p', { text: undated.length + ' demanda(s) sem data. Defina os prazos para que apareçam nas semanas correspondentes.' }),
      button('Ver demandas', () => changeView('list'), 'button button-small')
    ]))
  }
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
  const title = calendarMode === 'week'
    ? 'Semana de ' + formatDate(calendarDates()[0]) + ' a ' + formatDate(calendarDates()[6])
    : new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(calendarDate + 'T12:00:00Z'))
  heading.append(node('strong', { text: title }), node('span', { text: globalCalendar ? 'Demandas e referências da Agenda IPCVT' : 'Prazos das demandas deste plano' }))
  const mode = node('select', { 'aria-label': 'Período do calendário', onChange: event => { calendarMode = event.target.value; selectedCalendarDay = calendarDate; render() } }, [
    node('option', { value: 'week', text: 'Semana', selected: calendarMode === 'week' }),
    node('option', { value: 'month', text: 'Mês', selected: calendarMode === 'month' })
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
  if (calendarMode === 'week') return renderWeeklyCalendar(content, header, datedTasks, datedEvents, tasks, globalCalendar)
  for (const date of calendarDates()) {
    const dayTasks = datedTasks.get(date) || []
    const dayEvents = datedEvents.get(date) || []
    const day = node('section', { class: 'calendar-day' + (date.slice(0, 7) !== calendarDate.slice(0, 7) ? ' other-month' : '') + (date === todayISO() ? ' today' : '') + (new Date(date + 'T12:00:00Z').getUTCDay() === 0 ? ' sunday' : '') + (date === selectedCalendarDay ? ' selected' : ''), 'aria-label': formatDate(date), 'data-calendar-date': date })
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
  const allPlans=activePlans().sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'))
  const mine=allPlans.filter(pmIsMyPlan)
  const plans=pmShowAllPlans?allPlans:mine
  content.append(pmHeader('Organização','Meus planos',mine.length+' plano(s) com participação',[
    pmCreationButton('plan',()=>pmNewPlan())
  ]))
  const switcher=pmGroup('div','pm-plans-switch',[
    pmButton('Meus planos',()=>{pmShowAllPlans=false;render()},'pm-demand-tab'+(!pmShowAllPlans?' is-active':'')),
    pmButton('Todos os planos da Comissão',()=>{pmShowAllPlans=true;render()},'pm-demand-tab'+(pmShowAllPlans?' is-active':''))
  ])
  switcher.querySelectorAll('button').forEach((button,index)=>button.setAttribute('aria-pressed',String(Boolean(index)===pmShowAllPlans)))
  content.append(switcher)
  if (!plans.length) {
    content.append(empty(pmShowAllPlans?'Nenhum plano disponível. Crie o primeiro plano da Comissão.':'Você ainda não possui planos associados ao seu e-mail. Consulte Todos os planos da Comissão ou crie um plano.'))
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
      button('Editar plano', () => openPlan(plan), 'button button-small'),
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
  if($('pm-more'))$('pm-more').open=false
  pmSidebarClose()
  if (['integrations', 'routines'].includes(view) || (view === 'list' && !selectedPlan())) $('nav-extras').open = true
  render()
}

function chooseView(control) {
  const insidePlan = !!control.closest('.plan-view-tabs')
  if (control.dataset.view === 'calendar-all') {
    calendarMode = control.dataset.calendarMode || calendarMode
    clearTaskFilters()
    changeView('calendar-all', { preserveFilters: true })
    return
  }
  if (control.closest('.pm-primary-nav') && ['board','gantt'].includes(control.dataset.view)) {
    clearTaskFilters()
    changeView(control.dataset.view,{preserveFilters:true})
    return
  }
  if (control.dataset.view === 'list' && !insidePlan) {
    clearTaskFilters()
    changeView('list', { preserveFilters: true })
    return
  }
  changeView(control.dataset.view, { preserveFilters: insidePlan })
}


/* IPCVT Premium: a mesma estrutura de dados, com uma interface focada em
   Semana, Mês, Demandas, Kanban, Gantt, Domingo e Equipes.
   Nenhum registro de exemplo é criado no Firebase. */
let pmDemandTab = 'all'
let pmFiltersOpen = false
let pmPriorityFilter = ''
let pmDateStartFilter = ''
let pmDateDueFilter = ''
let pmSearchOpen = false
let pmGroupMenuOpen = false
let pmShowAllPlans = false
let pmSundayTab = 'overview'
let pmSundayCursor = todayISO()
let pmGanttCursor = todayISO()
const pmWeeks = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const pmMonthNames = new Intl.DateTimeFormat('pt-BR', {month:'long',year:'numeric',timeZone:'UTC'})
const pmShort = (date, options={day:'numeric',month:'short',timeZone:'UTC'}) =>
  new Intl.DateTimeFormat('pt-BR',options).format(new Date(date+'T12:00:00Z'))
const pmDayName = date => pmWeeks[new Date(date+'T12:00:00Z').getUTCDay()]
function pmWeekStart(date) {
  return addDays(date, -((new Date(date+'T12:00:00Z').getUTCDay()+6)%7))
}
function pmSunday(date) { return addDays(pmWeekStart(date),6) }
function pmEvents(date) { return liveEvents().filter(event=>event.startDate===date && event.status!=='cancelled') }
function pmTasks(date,tasks) { return tasks.filter(task=>(task.dueDate || task.startDate)===date) }
function pmNewTask(date='', defaults={}) {
  if (!requirePlan()) return
  openTask(null, taskCreationContext({
    plans: state.plans, buckets: state.buckets, tasks: liveTasks(),
    planId: selectedPlan(), eventId: value('event-filter'),
    defaults: { team: value('team-filter'), ...(date ? { dueDate: date } : {}), ...defaults }
  }))
}
function pmNewPlan(date='') { openPlan(null,date?{kind:'project',startDate:date,dueDate:date}:{}) }
function pmCreationButton(kind, handler, label='') {
  const plan = kind === 'plan'
  const control = pmButton('',handler,(plan?'pm-light-button pm-create-plan':'pm-primary-button pm-create-demand')+' pm-create-button')
  control.append(pmIcon(plan?'plan':'demand'),pmText('span','',label||(plan?'Novo plano':'Nova demanda')))
  return control
}
function pmCalendarSelector() {
  const selector=pmGroup('div','pm-calendar-switch')
  selector.setAttribute('role','group')
  selector.setAttribute('aria-label','Visualização do calendário')
  for(const [id,label] of [['week','Semana'],['month','Mês'],['year','Ano']]){
    const item=pmButton('',()=>{
      calendarMode=id
      render()
    },'pm-calendar-choice')
    item.append(pmIcon(id),pmText('span','',label))
    item.setAttribute('aria-pressed',String(calendarMode===id))
    item.setAttribute('title','Exibir calendário por '+label.toLowerCase())
    selector.append(item)
  }
  return selector
}
function pmGroup(tag,cls,children=[]) { return node(tag,{class:cls},children) }
function pmText(tag,cls,text) { return node(tag,{class:cls,text}) }
function pmButton(label,handler,cls='pm-light-button') { return button(label,handler,cls) }
function pmIcon(kind='calendar') {
  const paths={
    plan:'M3 7h7l2-3h9v17H3zM15 11v6m-3-3h6',
    demand:'M4 3h16v18H4zM8 8l2 2 4-4M8 15h8m-8 3h5',
    clock:'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    search:'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13m5-2 5 6',
    filter:'M4 4h16v3l-6 6v6l-4 2v-8L4 7z',
    flag:'M8 21V4m0 1c5-4 7 4 12 0v10c-5 4-7-4-12 0',
    team:'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M2 21v-2a7 7 0 0 1 14 0v2m1-17a4 4 0 0 1 0 8m3 3a6 6 0 0 1 2 5v1',
    music:'M9 18V5l11-2v13M9 5l11-2M9 8l11-2M9 18c0 2-6 3-6 0s6-3 6 0m11-2c0 2-6 3-6 0s6-3 6 0',
    screen:'M3 4h18v13H3zM8 21h8m-4-4v4M7 2v4m10-4v4',
    church:'M3 21V10l9-7 9 7v11H3m6 0v-7h6v7M12 2v7m-3-4h6',
    checklist:'M8 4h13v17H3V4h3m2-2h8v4H8zM7 11l2 2 3-4m2 3h4M7 17h11',
    resource:'M3 7h18v14H3zM5 3h14v4M3 11h18m-12 3h6',
    document:'M6 2h9l4 4v16H6zM14 2v5h5M9 12h7m-7 4h7',
    circle:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    calendar:'M4 5h16v16H4zM8 2v6m8-6v6M4 10h16m-11 4h6m-6 3h3',
    week:'M3 5h18v16H3zM7 3v4m10-4v4M3 10h18M9 11v10m6-10v10',
    month:'M3 5h18v16H3zM7 3v4m10-4v4M3 10h18M9 10v11m6-11v11M3 15h18',
    year:'M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18'
  }
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg')
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','pm-icon');svg.setAttribute('aria-hidden','true')
  const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[kind]||paths.calendar);svg.append(path)
  return svg
}
function pmTeamIcon(team='') {
  return pmIcon(/louvor/i.test(team)?'music':/m[ií]dia|t[eé]cnica/i.test(team)?'screen':/lit[uú]rg|celebra/i.test(team)?'church':'team')
}
function pmEventLine(event) {
  return pmGroup('span','',[pmIcon('clock'),pmText('span','',pmEventText(event))])
}
function pmHeader(kicker,title,meta='',actions=[]) {
  return pmGroup('div','pm-page-header',[
    pmGroup('div','pm-page-heading',[
      pmText('span','pm-kicker',kicker),
      pmGroup('div','pm-heading-line',[
        pmText('h2','pm-heading-title',title),
        meta ? pmText('span','pm-heading-meta',meta) : null
      ])
    ]),
    pmGroup('div','pm-header-actions',actions)
  ])
}
function pmPager(mode='week') {
  const shift=delta=>{
    if(mode==='month'){
      const value=new Date(calendarDate.slice(0,7)+'-01T12:00:00Z')
      value.setUTCMonth(value.getUTCMonth()+delta)
      calendarDate=value.toISOString().slice(0,10)
    }else if(mode==='year') calendarDate=String(Number(calendarDate.slice(0,4))+delta)+'-01-01'
    else if(mode==='gantt') pmGanttCursor=addDays(pmGanttCursor,delta*28)
    else if(mode==='sunday') pmSundayCursor=addDays(pmSundayCursor,delta*7)
    else calendarDate=addDays(calendarDate,delta*7)
    selectedCalendarDay=calendarDate
    render()
  }
  const today=()=>{
    if(mode==='gantt') pmGanttCursor=todayISO()
    else if(mode==='sunday') pmSundayCursor=todayISO()
    else calendarDate=todayISO()
    selectedCalendarDay=todayISO()
    render()
  }
  return pmGroup('div','pm-pager',[
    pmButton('‹',()=>shift(-1),'pm-arrow-button'),
    pmButton('Hoje',today,'pm-light-button'),
    pmButton('›',()=>shift(1),'pm-arrow-button')
  ])
}
function pmPerson(task) {
  const person=task.assignees?.[0]
  return person?.name || person?.email || task.team || 'Sem responsável'
}
function pmInitials(text) {
  const parts=String(text||'IP').trim().split(/\s+/).filter(Boolean)
  return (parts.length>1?parts[0][0]+parts[parts.length-1][0]:parts[0]?.slice(0,2)||'IP').toLocaleUpperCase('pt-BR')
}
function pmAvatarFor(task) {
  const person=pmPerson(task)
  const avatar=pmText('span','pm-mini-avatar',pmInitials(person))
  avatar.title=person
  return avatar
}
function pmEventButton(event,compact=false) {
  return pmButton(event.title,()=>openEvent(event),compact?'pm-event-line pm-compact':'pm-event-line')
}
function pmTaskButton(task,compact=false) {
  const line=pmButton(task.title,()=>openTask(task),compact?'pm-task-line pm-compact':'pm-task-line')
  line.classList.toggle('pm-done',task.status==='done')
  if(isOverdue(task,todayISO()))line.classList.add('pm-overdue')
  if(taskRecurrence(task))line.title=recurrenceLabel(task)
  return line
}
function pmEventText(event) {
  return eventDateLabel(event)==='Dia inteiro'?event.title:eventDateLabel(event)+' · '+event.title
}
function pmWeekView(content,tasks) {
  const monday=pmWeekStart(calendarDate)
  const sunday=addDays(monday,6)
  const dates=Array.from({length:7},(_,i)=>addDays(monday,i))
  const events=dates.flatMap(pmEvents)
  const pending=tasks.filter(task=>task.status!=='done'&&task.dueDate>=monday&&task.dueDate<=sunday)
    .sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||'')||
      (['urgent','high','normal','low'].indexOf(a.priority)-['urgent','high','normal','low'].indexOf(b.priority)))
  const header=pmHeader('PLANEJAMENTO SEMANAL','Semana',
    pmShort(monday,{day:'numeric',month:'long',timeZone:'UTC'})+' a '+pmShort(sunday,{day:'numeric',month:'long',timeZone:'UTC'}),[
      pmPager('week'),
      pmCalendarSelector(),
      pmCreationButton('plan',()=>pmNewPlan()),
      pmCreationButton('task',()=>pmNewTask())
    ])
  const agenda=pmGroup('section','pm-week-agenda')
  agenda.append(pmGroup('div','pm-week-section-heading',[
    pmText('h3','','Agenda da semana'),
    pmText('span','',events.length+' evento(s) registrado(s)')
  ]))
  const columns=pmGroup('div','pm-week-columns')
  for(const date of dates){
    const isSunday=new Date(date+'T12:00:00Z').getUTCDay()===0
    const dayEvents=pmEvents(date)
    const col=pmGroup('div','pm-week-column'+(isSunday?' pm-week-column-sunday':'')+(date===todayISO()?' pm-week-column-today':''))
    const dayHead=pmButton('',()=>pmDayDetails(date,tasks),'pm-week-column-head')
    dayHead.setAttribute('aria-label','Detalhes de '+formatDate(date))
    dayHead.append(pmText('span','pm-week-column-name',pmDayName(date).toUpperCase()),
      pmText('strong','pm-week-column-date',String(Number(date.slice(-2)))))
    col.append(dayHead)
    const entries=pmGroup('div','pm-week-column-events')
    for(const event of dayEvents){
      const card=pmButton('',()=>openEvent(event),'pm-week-event-card')
      card.append(pmText('span','pm-week-event-time',eventDateLabel(event)),
        pmText('strong','pm-week-event-title',event.title))
      entries.append(card)
    }
    if(!dayEvents.length)entries.append(pmText('span','pm-week-empty','Sem eventos'))
    col.append(entries)
    const count=pmTasks(date,tasks).filter(task=>task.status!=='done').length
    if(count)col.append(pmButton(count+' demanda(s)',()=>pmDayDetails(date,tasks),'pm-week-day-tasks'))
    columns.append(col)
  }
  const scroll=pmGroup('div','pm-week-columns-scroll',[columns])
  scroll.setAttribute('tabindex','0')
  scroll.setAttribute('aria-label','Agenda de segunda-feira a domingo')
  agenda.append(scroll)
  const aside=pmGroup('aside','pm-week-pending')
  const pendingTitle=pmGroup('div','pm-week-section-heading',[
    pmGroup('div','pm-pending-title',[pmIcon('checklist'),pmText('h3','','Pendências')]),
    pmButton('Ver todas',()=>changeView('list'),'pm-week-see-all')
  ])
  aside.append(pendingTitle,pmText('p','pm-week-pending-sub','Demandas com prazo nesta semana'))
  const list=pmGroup('div','pm-week-pending-list')
  if(!pending.length)list.append(pmText('p','pm-week-pending-empty','Nenhuma demanda pendente nesta semana.'))
  for(const task of pending){
    const checkbox=node('input',{
      type:'checkbox',
      'aria-label':'Concluir '+task.title,
      onChange:async event=>{
        try{await pmComplete(task,event.target.checked)}catch{event.target.checked=false}
      }
    })
    const entry=pmGroup('div','pm-week-pending-row',[
      checkbox,
      pmGroup('div','pm-week-pending-copy',[
        pmButton(task.title,()=>openTask(task),'pm-week-pending-task'),
        pmText('span','',pmPerson(task))
      ]),
      pmText('time','pm-week-pending-due',task.dueDate?pmShort(task.dueDate):'')
    ])
    list.append(entry)
  }
  aside.append(list)
  const sundayCard=pmButton('',()=>pmDayDetails(sunday,tasks),'pm-week-sunday-summary')
  sundayCard.append(pmIcon('church'),pmGroup('span','',[
    pmText('strong','','Domingo, '+pmShort(sunday,{day:'numeric',month:'long',timeZone:'UTC'})),
    pmText('small','','Ver os detalhes dos cultos e suas demandas')
  ]))
  aside.append(sundayCard)
  content.append(header,pmGroup('div','pm-week-planner-layout',[agenda,aside]))
}
function pmMonthDates(date) {
  const first=date.slice(0,7)+'-01'
  const start=addDays(first,-new Date(first+'T12:00:00Z').getUTCDay())
  const next=new Date(first+'T12:00:00Z');next.setUTCMonth(next.getUTCMonth()+1)
  const monthEnd=addDays(next.toISOString().slice(0,10),-1)
  const number=Math.ceil((new Date(first+'T12:00:00Z').getUTCDay()+Number(monthEnd.slice(-2)))/7)*7
  return Array.from({length:number},(_,i)=>addDays(start,i))
}
function pmMonthView(content,tasks) {
  const label=pmMonthNames.format(new Date(calendarDate.slice(0,7)+'-01T12:00:00Z'))
  const layout=pmGroup('div','pm-month-layout')
  const calendar=pmGroup('div','pm-month-calendar')
  const weekday=pmGroup('div','pm-month-weekday-row')
  for(const day of ['DOM','SEG','TER','QUA','QUI','SEX','SÁB'])weekday.append(pmText('span','',day))
  const dates=pmGroup('div','pm-month-grid')
  for(const date of pmMonthDates(calendarDate)){
    const eventItems=pmEvents(date),taskItems=pmTasks(date,tasks)
    const btn=pmGroup('button','pm-month-cell'+(date.slice(0,7)!==calendarDate.slice(0,7)?' pm-other-month':'')+(date===selectedCalendarDay?' pm-selected':'')+(date===todayISO()?' pm-today':'')+(pmDayName(date)==='Dom'?' pm-dom':''))
    btn.type='button';btn.setAttribute('aria-label',formatDate(date)+': '+eventItems.length+' eventos e '+taskItems.length+' demandas')
    btn.append(pmText('strong','pm-date-number',String(Number(date.slice(-2)))))
    for(const event of eventItems.slice(0,2))btn.append(pmText('span','pm-month-entry pm-month-event',event.title))
    for(const task of taskItems.slice(0,Math.max(0,2-eventItems.length)))btn.append(pmText('span','pm-month-entry pm-month-task',task.title))
    if(eventItems.length+taskItems.length>2)btn.append(pmText('small','pm-month-extra','+'+(eventItems.length+taskItems.length-2)))
    btn.addEventListener('click',()=>{selectedCalendarDay=date;render()})
    dates.append(btn)
  }
  calendar.append(weekday,dates)
  const selectedEvents=pmEvents(selectedCalendarDay),selectedTasks=pmTasks(selectedCalendarDay,tasks)
  const aside=pmGroup('aside','pm-month-aside',[
    pmText('h3','','Eventos do dia'),
    pmText('p','pm-aside-date',pmShort(selectedCalendarDay,{day:'numeric',month:'long',weekday:'short',timeZone:'UTC'}))
  ])
  const eventList=pmGroup('div','pm-aside-events')
  if(!selectedEvents.length)eventList.append(pmText('p','pm-muted','Nenhum evento oficial neste dia.'))
  for(const event of selectedEvents){
    const card=pmButton('',()=>openEvent(event),'pm-aside-event')
    card.append(pmGroup('strong','',[pmText('span','pm-check-icon','✓'),pmText('span','',event.title)]),pmText('small','',eventDateLabel(event)))
    eventList.append(card)
  }
  aside.append(eventList,pmText('h3','pm-aside-subtitle','Demandas do dia'))
  const list=pmGroup('div','pm-aside-tasks')
  if(!selectedTasks.length)list.append(pmText('p','pm-muted','Nenhuma demanda com prazo neste dia.'))
  for(const task of selectedTasks){
    const item=pmGroup('div','pm-aside-task')
    const check=node('input',{type:'checkbox',class:'pm-aside-check',checked:task.status==='done','aria-label':'Concluir '+task.title,onChange:async e=>{try{await pmComplete(task,e.target.checked)}catch{e.target.checked=task.status==='done'}}})
    item.append(check,pmGroup('span','pm-aside-task-copy',[pmButton(task.title,()=>openTask(task),'pm-aside-task-title'),pmText('small','',pmPerson(task))]),pmText('span','pm-aside-priority pm-priority-'+task.priority,''))
    list.append(item)
  }
  aside.append(list)
  if(new Date(selectedCalendarDay+'T12:00:00Z').getUTCDay()===0)
    aside.append(pmButton('Preparação do domingo',()=>pmDayDetails(selectedCalendarDay,tasks),'pm-light-button pm-sunday-detail-link'))
  else aside.append(pmButton('Ver detalhes  →',()=>pmDayDetails(selectedCalendarDay,tasks),'pm-text-link'))
  const calendarMain=pmGroup('section','pm-month-main',[
    pmHeader('Calendário',label.replace(/^./,x=>x.toUpperCase()),'',[
      pmPager('month'),
      pmCalendarSelector()
    ]),
    calendar
  ])
  layout.append(calendarMain,aside)
  content.append(layout)
}
function pmYearView(content,tasks) {
  const year=calendarDate.slice(0,4)
  const grid=pmGroup('div','pm-year-grid')
  for(let month=1;month<=12;month++){
    const first=year+'-'+String(month).padStart(2,'0')+'-01'
    const name=pmShort(first,{month:'long',timeZone:'UTC'})
    const card=pmGroup('section','pm-year-month')
    const heading=pmButton(name.replace(/^./,letter=>letter.toUpperCase()),()=>{
      calendarDate=first;selectedCalendarDay=first;calendarMode='month';render()
    },'pm-year-month-name')
    heading.setAttribute('aria-label','Abrir '+name+' de '+year)
    const weekdays=pmGroup('div','pm-year-weekdays',pmWeeks.map(day=>pmText('span','',day)))
    const dates=pmGroup('div','pm-year-dates')
    for(const date of pmMonthDates(first)){
      if(date.slice(0,7)!==first.slice(0,7)){dates.append(node('span',{'aria-hidden':'true'}));continue}
      const events=pmEvents(date),dayTasks=pmTasks(date,tasks)
      const day=pmButton('',()=>{selectedCalendarDay=date;pmDayDetails(date,tasks)},'pm-year-day'+(date===todayISO()?' pm-year-today':''))
      day.setAttribute('aria-label','Ver detalhes de '+formatDate(date)+': '+events.length+' eventos e '+dayTasks.length+' demandas')
      day.setAttribute('aria-haspopup','dialog')
      day.append(pmText('span','',String(Number(date.slice(-2)))))
      const marks=pmGroup('span','pm-year-marks')
      if(events.length)marks.append(pmText('i','pm-year-event-dot',''))
      if(dayTasks.length)marks.append(pmText('i','pm-year-task-dot',''))
      marks.setAttribute('aria-hidden','true');day.append(marks);dates.append(day)
    }
    card.append(heading,weekdays,dates);grid.append(card)
  }
  content.append(pmHeader('Calendário',year,'',[
    pmPager('year'),pmCalendarSelector(),pmCreationButton('plan',()=>pmNewPlan()),pmCreationButton('task',()=>pmNewTask())
  ]),pmText('p','pm-year-legend','Verde: eventos da igreja · Dourado: demandas. Selecione um dia para ver os detalhes.'),grid)
}
function pmDayDetails(date,tasks) {
  const dialog=pmGroup('dialog','editor-dialog compact-dialog')
  const heading=pmGroup('div','dialog-heading',[
    pmGroup('div','',[pmText('p','eyebrow','Agenda IPCVT'),pmText('h2','',pmShort(date,{day:'numeric',month:'long',timeZone:'UTC'}))]),
    pmButton('×',()=>dialog.close(),'icon-button')
  ])
  heading.querySelector('button').setAttribute('aria-label','Fechar detalhes do dia')
  const body=pmGroup('div','dialog-body')
  const events=pmEvents(date),dayTasks=pmTasks(date,tasks)
  if(new Date(date+'T12:00:00Z').getUTCDay()===0){
    const ids=new Set(events.map(event=>event.id)),start=pmWeekStart(date)
    const related=tasks.filter(task=>ids.has(task.eventId)&&task.dueDate>=start&&task.dueDate<=date)
    const todayIds=new Set(dayTasks.map(task=>task.id))
    const work=[...dayTasks,...related.filter(task=>!todayIds.has(task.id))]
    const complete=work.filter(task=>task.status==='done').length
    body.append(pmGroup('div','pm-day-sunday-summary',[
      pmIcon('church'),
      pmGroup('div','',[pmText('strong','','Preparação do domingo'),pmText('span','',complete+' de '+work.length+' demandas concluídas')])
    ]))
    const preparation=related.filter(task=>!todayIds.has(task.id))
    if(preparation.length){
      body.append(pmText('h3','pm-section-title','Preparação na semana'))
      body.append(...preparation.map(pmTaskButton))
    }
  }
  body.append(pmText('h3','pm-section-title','Eventos do dia'))
  body.append(...(events.length?events.map(event=>pmEventButton(event)):[pmText('p','pm-muted','Nenhum evento oficial neste dia.')]))
  body.append(pmText('h3','pm-section-title','Demandas do dia'))
  body.append(...(dayTasks.length?dayTasks.map(task=>pmTaskButton(task)):[pmText('p','pm-muted','Nenhuma demanda com prazo neste dia.')]))
  dialog.setAttribute('aria-label','Detalhes de '+formatDate(date))
  dialog.append(heading,body,pmGroup('div','dialog-footer',[
    pmCreationButton('plan',()=>{dialog.close();pmNewPlan(date)}),
    pmCreationButton('task',()=>{dialog.close();pmNewTask(date)})
  ]))
  dialog.addEventListener('close',()=>dialog.remove(),{once:true})
  document.body.append(dialog);dialog.showModal()
}
function pmIsMine(task){return (task.assignees||[]).some(person=>person.email?.toLowerCase()===session.email)}
function pmIsMyPlan(plan) {
  const email=(session.email||'').toLowerCase()
  if(!email)return false
  return (plan.createdBy||'').toLowerCase()===email
    || liveTasks().some(task=>task.planId===plan.id&&pmIsMine(task))
    || state.routines.some(routine=>!routine.deleted&&routine.planId===plan.id&&
      (routine.assignees||[]).some(person=>(person.email||'').toLowerCase()===email))
}
function pmTaskListItems(tasks){
  return tasks.filter(task=>(pmDemandTab!=='mine'||pmIsMine(task))&&
    (!pmPriorityFilter||task.priority===pmPriorityFilter)&&
    pmMatchesDate(task,'startDate',pmDateStartFilter)&&
    pmMatchesDate(task,'dueDate',pmDateDueFilter))
}
function pmPriorityLabel(key){return ({urgent:'Urgente',high:'Alta',normal:'Média',low:'Baixa'})[key]||'Normal'}
function pmComplete(task,checked){
  const status=checked?'done':'todo'
  const bucket=standardBucket(task.planId,status)
  return action(()=>save('tasks',{...task,status,bucketId:bucket?.id||(pmIsReview(task)?'':task.bucketId)}),checked?'Demanda concluída.':'Demanda reaberta.')
}
function pmMatchesDate(task,field,rule){
  if(!rule)return true
  const date=task[field]||''
  const today=todayISO()
  if(rule==='none')return !date
  if(!date)return false
  if(rule==='today')return date===today
  if(rule==='week')return date>=pmWeekStart(today)&&date<=addDays(pmWeekStart(today),6)
  if(rule==='next7')return date>=today&&date<=addDays(today,7)
  if(rule==='past')return date<today
  return true
}
function pmDueCategory(task){
  if(task.status==='done')return 'done'
  if(!task.dueDate)return 'none'
  if(task.dueDate<todayISO())return 'late'
  if(task.dueDate===todayISO())return 'today'
  if(task.dueDate<=addDays(todayISO(),7))return 'soon'
  return 'future'
}
const pmDueCategories=[
  ['late','Atrasadas'],['today','Hoje'],['soon','Próximos 7 dias'],
  ['future','Mais adiante'],['none','Sem prazo'],['done','Concluídas']
]
function pmGroupTaskLabel(task){
  if(boardGrouping==='plan')return planName(task.planId)
  if(boardGrouping==='priority')return pmPriorityLabel(task.priority)
  if(boardGrouping==='dueDate')return pmDueCategories.find(([id])=>id===pmDueCategory(task))?.[1]||'Sem prazo'
  if(boardGrouping==='team')return task.team||'Sem equipe'
  if(boardGrouping==='event')return liveEvents().find(event=>event.id===task.eventId)?.title||'Sem evento-alvo'
  if(boardGrouping==='bucket')return bucketName(task.bucketId)
  if(boardGrouping==='assignee')return pmPerson(task)
  return pmIsReview(task)?'Em revisão':(labels[task.status]||'Não iniciada')
}
function pmDueGroups(tasks){
  const columns=pmDueCategories.map(([id,label])=>({
    id,label,defaults:{},tone:id==='done'?'done':id==='late'?'urgent':'neutral',
    tasks:tasks.filter(task=>pmDueCategory(task)===id)
  })).filter(group=>group.tasks.length)
  return columns.length?columns:[{id:'none',label:'Sem prazo',defaults:{},tone:'neutral',tasks:[]}]
}
function pmMenuOption(label,active,onSelect){
  const item=pmButton('',onSelect,'pm-popover-option')
  item.setAttribute('aria-pressed',String(active))
  item.append(pmText('span','pm-popover-check',active?'✓':''),pmText('span','',label))
  return item
}
function pmMenuSection(title,icon,items){
  const group=pmGroup('details','pm-filter-category')
  const summary=pmGroup('summary','pm-filter-category-title',[
    pmIcon(icon),pmText('span','',title),pmText('span','pm-filter-chevron','›')
  ])
  group.append(summary,pmGroup('div','pm-filter-choices',items))
  return group
}
function pmTaskTools(content,tasks,mode){
  content.append(pmHeader('Trabalho da Comissão','Minhas tarefas','',[pmCreationButton('task',()=>pmNewTask())]))
  const toggle=pmGroup('div','pm-task-mode')
  for(const [id,label,icon] of [['list','Grade','document'],['board','Quadro','plan']]){
    const option=pmButton('',()=>changeView(id,{preserveFilters:true}),'pm-mode-button')
    option.append(pmIcon(icon),pmText('span','',label))
    option.setAttribute('aria-pressed',String(mode===id))
    toggle.append(option)
  }
  const countAll=tasks.filter(task=>(!pmPriorityFilter||task.priority===pmPriorityFilter)&&pmMatchesDate(task,'startDate',pmDateStartFilter)&&pmMatchesDate(task,'dueDate',pmDateDueFilter)).length
  const countMine=tasks.filter(task=>pmIsMine(task)&&(!pmPriorityFilter||task.priority===pmPriorityFilter)&&pmMatchesDate(task,'startDate',pmDateStartFilter)&&pmMatchesDate(task,'dueDate',pmDateDueFilter)).length
  const scope=pmGroup('div','pm-task-scopes')
  for(const [id,label,count] of [['all','Todos',countAll],['mine','Atribuídos a mim',countMine]]){
    const option=pmButton(label+(count?' ('+count+')':''),()=>{pmDemandTab=id;render()},'pm-scope-button')
    option.setAttribute('aria-pressed',String(pmDemandTab===id));scope.append(option)
  }
  const input=node('input',{
    id:'pm-demand-search',type:'search',value:$('search-filter').value,
    placeholder:'Pesquisar tarefas','aria-label':'Pesquisar tarefas',
    onInput:event=>{
      const pos=event.target.selectionStart
      $('search-filter').value=event.target.value
      $('pm-search').value=event.target.value
      render()
      const next=$('pm-demand-search')
      if(next){next.focus({preventScroll:true});try{next.setSelectionRange(pos,pos)}catch{}}
    }
  })
  const searchBox=pmGroup('div','pm-task-search')
  const searchToggle=pmButton('',()=>{
    pmSearchOpen=!pmSearchOpen
    render()
    if(pmSearchOpen)$('pm-demand-search')?.focus({preventScroll:true})
  },'pm-toolbar-icon')
  searchToggle.setAttribute('aria-label',pmSearchOpen?'Fechar pesquisa':'Pesquisar tarefas')
  searchToggle.setAttribute('aria-expanded',String(pmSearchOpen))
  searchToggle.append(pmIcon('search'))
  searchBox.append(searchToggle)
  if(pmSearchOpen||value('search-filter'))searchBox.append(input)
  const filterMenu=pmGroup('details','pm-filter-menu')
  filterMenu.open=pmFiltersOpen
  filterMenu.addEventListener('toggle',()=>{if(filterMenu.isConnected)pmFiltersOpen=filterMenu.open})
  const summary=pmGroup('summary','pm-toolbar-icon pm-filter-summary',[pmIcon('filter')])
  summary.setAttribute('aria-label','Filtrar tarefas')
  summary.setAttribute('title','Filtrar tarefas')
  const active=!!(pmPriorityFilter||pmDateStartFilter||pmDateDueFilter||
    ['plan-filter','team-filter','status-filter','assignee-filter','event-filter'].some(id=>$(id).value))
  if(active)summary.append(pmText('span','pm-filter-indicator',''))
  const popup=pmGroup('div','pm-task-popover',[
    pmGroup('div','pm-task-popover-head',[
      pmText('strong','','Filtrar por'),
      pmButton('Limpar tudo',()=>{
        clearTaskFilters();pmPriorityFilter='';pmDateStartFilter='';pmDateDueFilter='';pmFiltersOpen=false;render()
      },'pm-popover-clear')
    ])
  ])
  const makeChoices=(kind,options,read,write)=>pmMenuSection(kind,kind==='Prioridade'?'flag':kind==='Status'?'circle':'calendar',
    options.map(([id,label])=>pmMenuOption(label,read()===id,()=>{write(id);pmFiltersOpen=false;render()})))
  popup.append(
    makeChoices('Prioridade',[['','Todas'],['urgent','Urgente'],['high','Alta'],['normal','Normal'],['low','Baixa']],()=>pmPriorityFilter,v=>pmPriorityFilter=v),
    makeChoices('Status',[['','Todos'],['todo','Não iniciada'],['doing','Em andamento'],['done','Concluída']],()=>value('status-filter'),v=>$('status-filter').value=v),
    makeChoices('Data de início',[['','Qualquer data'],['today','Hoje'],['week','Esta semana'],['next7','Próximos 7 dias'],['past','Antes de hoje'],['none','Sem data']],()=>pmDateStartFilter,v=>pmDateStartFilter=v),
    makeChoices('Data de conclusão',[['','Qualquer data'],['today','Hoje'],['week','Esta semana'],['next7','Próximos 7 dias'],['past','Antes de hoje'],['none','Sem prazo']],()=>pmDateDueFilter,v=>pmDateDueFilter=v)
  )
  popup.append(pmMenuSection('Outros filtros','plan',[
    pmFilterSelect('plan-filter','Plano'),
    pmFilterSelect('team-filter','Equipe'),
    pmFilterSelect('assignee-filter','Responsável'),
    pmFilterSelect('event-filter','Evento-alvo')
  ]))
  filterMenu.append(summary,popup)
  const groupingLabels=[
    ['status','Status','checklist'],['dueDate','Data de conclusão','calendar'],
    ['plan','Plano','plan'],['priority','Prioridade','flag'],
    ['team','Equipe','team'],['bucket','Etapa (bucket)','checklist'],
    ['event','Evento-alvo','calendar'],['assignee','Responsável','team']
  ]
  const name=groupingLabels.find(([id])=>id===boardGrouping)?.[1]||'Status'
  const grouping=pmGroup('details','pm-group-menu')
  grouping.open=pmGroupMenuOpen
  grouping.addEventListener('toggle',()=>{if(grouping.isConnected)pmGroupMenuOpen=grouping.open})
  const groupSummary=pmGroup('summary','pm-group-summary',[
    pmIcon('checklist'),pmText('span','','Agrupar por: '+name),pmText('span','pm-group-chevron','⌄')
  ])
  const groupOptions=pmGroup('div','pm-group-popover')
  for(const [id,label,icon] of groupingLabels){
    const option=pmButton('',()=>{
      boardGrouping=id;pmGroupMenuOpen=false;render()
    },'pm-group-option')
    option.setAttribute('aria-pressed',String(boardGrouping===id))
    option.append(pmIcon(icon),pmText('span','',label),pmText('span','pm-group-check',boardGrouping===id?'✓':''))
    groupOptions.append(option)
  }
  grouping.append(groupSummary,groupOptions)
  content.append(pmGroup('div','pm-task-toolbar',[
    pmGroup('div','pm-task-toolbar-start',[
      toggle,pmText('span','pm-task-toolbar-divider',''),scope,
      pmGroup('div','pm-task-toolbar-icons',[searchBox,filterMenu])
    ]),
    grouping
  ]))
}

function pmDemandView(content,tasks) {
  pmTaskTools(content,tasks,'list')
  const sorted=pmTaskListItems(tasks).sort((a,b)=>
    pmGroupTaskLabel(a).localeCompare(pmGroupTaskLabel(b),'pt-BR')||
    (a.dueDate||'9999').localeCompare(b.dueDate||'9999'))
  const rows=sorted.map((task,i)=>({
    task,label:i===0||pmGroupTaskLabel(sorted[i-1])!==pmGroupTaskLabel(task)?pmGroupTaskLabel(task):''
  }))
  const table=pmGroup('table','pm-demand-table')
  table.append(node('thead',{},node('tr',{},['','Demanda','Equipe','Responsável','Prazo','Status','Prioridade',''].map(x=>node('th',{scope:'col',text:x})))))
  const body=node('tbody')
  for(const {task,label} of rows){
    if(label)body.append(node('tr',{class:'pm-group-row'},node('td',{colSpan:8,text:label})))
    const check=node('input',{type:'checkbox',checked:task.status==='done','aria-label':'Concluir '+task.title,onChange:async e=>{try{await pmComplete(task,e.target.checked)}catch{e.target.checked=task.status==='done'}}})
    body.append(node('tr',{},[
      node('td',{},check),
      node('td',{},[pmButton(task.title,()=>openTask(task),'pm-table-task'),taskRecurrence(task)?pmText('small','task-repeat-badge','↻ '+recurrenceLabel(task)):null]),
      node('td',{},pmText('span','pm-team-tag',task.team||'Sem equipe')),
      node('td',{},pmGroup('div','pm-table-person',[pmAvatarFor(task),pmText('span','',pmPerson(task))])),
      node('td',{class:isOverdue(task,todayISO())?'pm-overdue':'' ,text:task.dueDate?pmShort(task.dueDate):'Sem prazo'}),
      node('td',{},pmText('span','pm-status-chip pm-status-'+task.status,labels[task.status]||'A fazer')),
      node('td',{},pmText('span','pm-priority-chip pm-priority-'+(task.priority||'normal'),pmPriorityLabel(task.priority))),
      node('td',{},pmButton('⋮',()=>openTask(task),'pm-table-menu'))
    ]))
  }
  table.append(body)
  const wrap=pmGroup('div','pm-demand-table-wrap',[table])
  content.append(wrap)
  if(!rows.length)content.append(pmText('p','pm-muted','Nenhuma demanda encontrada para esta visualização.'))
}
function pmReviewBucket(planId) {
  return state.buckets.find(b=>!b.deleted&&b.planId===planId&&/revis[aã]o/i.test(b.name))
}
function pmIsReview(task) {return task.status!=='done'&&!!pmReviewBucket(task.planId)&&pmReviewBucket(task.planId)?.id===task.bucketId}
async function pmMoveTo(task,group) {
  let bucket
  let status=group
  if(group==='review'){
    status='doing'
    bucket=pmReviewBucket(task.planId)
    if(!bucket){
      const entry={id:newId(),planId:task.planId,name:'Em Revisão',order:40}
      await save('buckets',entry)
      bucket=entry
    }
  }else bucket=standardBucket(task.planId,status)
  await save('tasks',{...task,status,bucketId:bucket?.id||(pmIsReview(task)?'':task.bucketId)})
}
function pmFilterSelect(id,label) {
  const source=$(id)
  return node('label',{class:'pm-dropdown'},[
    node('span',{class:'pm-dropdown-caption',text:label}),
    node('select',{value:source.value,'aria-label':label,onChange:e=>{source.value=e.target.value;render()}},
      [...source.options].map(o=>node('option',{value:o.value,text:o.textContent,selected:o.value===source.value})))
  ])
}
function pmKanbanView(content,tasks) {
  pmTaskTools(content,tasks,'board')
  const focused=pmTaskListItems(tasks)
  const groups=(boardGrouping==='dueDate'?pmDueGroups(focused):groupBoardTasks({grouping:boardGrouping,tasks:focused,plans:state.plans,buckets:state.buckets,events:liveEvents(),teams,planId:selectedPlan(),eventId:value('event-filter')}))
    .filter(group=>boardGrouping!=='status'||group.id!=='review'||group.tasks.length)
  const editingPlan=activePlans().find(plan=>plan.id===selectedPlan())
  const filterbar=pmGroup('div','pm-board-controls pm-board-subtools',[
    editingPlan?pmButton('Editar etapas',()=>{openPlan(editingPlan);$('plan-buckets').focus()},'pm-light-button'):null
  ])
  const board=pmGroup('div','pm-premium-board'+(groups.length>4?' pm-board-many':''))
  board.style.setProperty('--board-columns',Math.max(1,groups.length))
  for(const group of groups) {
    const items=group.tasks
    const col=pmGroup('section','pm-kanban-column pm-column-'+(group.tone||'neutral'))
    col.setAttribute('data-group-id',group.id)
    col.setAttribute('aria-label',group.label)
    col.append(pmGroup('div','pm-kanban-heading',[pmText('h3','',group.label),pmText('span','',String(items.length))]))
    const stack=pmGroup('div','pm-kanban-stack')
    for(const task of items){
      const card=pmGroup('article','pm-kanban-task')
      card.draggable=boardGrouping!=='dueDate';card.setAttribute('data-task-id',task.id)
      card.addEventListener('dragstart',e=>{draggedTask=task.id;draggedTaskGroup=group.id;e.dataTransfer?.setData('text/plain',task.id)})
      if(task.status==='done'){
        card.append(pmGroup('div','pm-kanban-done-line',[
          pmText('span','pm-done-symbol','✓'),
          pmButton(task.title,()=>openTask(task),'pm-kanban-title')
        ]))
      } else {
        card.append(pmButton(task.title,()=>openTask(task),'pm-kanban-title'))
      }
      if(taskRecurrence(task))card.append(pmText('small','task-repeat-badge','↻ '+recurrenceLabel(task)))
      card.append(pmText('small','pm-kanban-plan',planName(task.planId)),pmGroup('div','pm-kanban-card-foot',[
        pmText('span','pm-team-tag',task.team||pmPriorityLabel(task.priority)),pmAvatarFor(task)
      ]))
      stack.append(card)
    }
    if(!items.length)stack.append(pmText('p','pm-kanban-empty','Nenhuma demanda nesta coluna.'))
    const add=pmCreationButton('task',async()=>{
      if(!requirePlan())return
      const defaults={...group.defaults}
      if(boardGrouping==='status'){
        const planId=selectedPlan()||activePlans()[0]?.id
        let bucket=group.id==='review'?pmReviewBucket(planId):standardBucket(planId,group.id)
        if(group.id==='review'&&!bucket){
          try{
            bucket=await action(()=>save('buckets',{id:newId(),planId,name:'Em Revisão',order:40}))
            if(!state.buckets.some(item=>item.id===bucket.id))state.buckets.push(bucket)
          }catch{return}
        }
        Object.assign(defaults,{planId,bucketId:bucket?.id||''})
      }
      pmNewTask('',defaults)
    },'Adicionar demanda')
    add.className='pm-kanban-add pm-create-button'
    add.replaceChildren(pmText('span','pm-kanban-add-plus','+'),pmText('span','','Adicionar demanda'))
    add.setAttribute('aria-label','Adicionar demanda em '+group.label)
    col.append(add,stack)
    col.addEventListener('dragover',e=>{e.preventDefault();col.classList.add('pm-drag-over')})
    col.addEventListener('dragleave',e=>{if(!col.contains(e.relatedTarget))col.classList.remove('pm-drag-over')})
    col.addEventListener('drop',async e=>{
      e.preventDefault();col.classList.remove('pm-drag-over')
      if(boardGrouping==='dueDate')return notice('Para mudar o prazo, abra a demanda e edite sua data.')
      const task=byId('tasks',e.dataTransfer?.getData('text/plain')||draggedTask)
      if(task)try{
        await action(async()=>{
          if(boardGrouping==='status')return pmMoveTo(task,group.id)
          const next=moveBoardTask(task,boardGrouping,group,{plans:state.plans,buckets:state.buckets,tasks:state.tasks,fromGroup:draggedTaskGroup})
          const errors=validateTask(next,state.tasks)
          if(errors.length)throw new Error(errors.join(' '))
          return save('tasks',next)
        },'Demanda movida.')
      }catch{}
    })
    board.append(col)
  }
  if(filterbar.children.length)content.append(filterbar)
  if(boardGrouping==='dueDate')content.append(pmText('p','pm-board-note','Para mudar um prazo, abra a demanda e altere a data de conclusão.'))
  if(boardGrouping==='assignee')content.append(pmText('p','pm-board-note','Demandas com mais de um responsável aparecem na coluna de cada pessoa.'))
  content.append(board)
}
function pmGanttView(content,tasks){
  const start=pmWeekStart(pmGanttCursor)
  const dates=Array.from({length:35},(_,i)=>addDays(start,i))
  const end=dates[dates.length-1]
  const shown=tasks.filter(task=>{
    if(!task.startDate&&!task.dueDate)return false
    const a=task.startDate||task.dueDate
    const b=task.dueDate||task.startDate
    return a<=end&&b>=start
  })
  const layout=pmGroup('div','pm-gantt-view')
  const left=pmGroup('div','pm-gantt-outline',[pmGroup('h3','',[pmText('span','','Planos'),pmText('small','','Etapas e demandas')])])
  const right=pmGroup('div','pm-gantt-chart')
  const ganttBars=new Map()
  const datesRow=pmGroup('div','pm-gantt-dates')
  for(const date of dates){
    datesRow.append(pmText('span','pm-gantt-date'+(pmDayName(date)==='Dom'?' pm-gantt-sunday':''),String(Number(date.slice(-2)))))
  }
  right.append(pmGroup('div','pm-gantt-toolbar',[pmText('span','',pmShort(start,{month:'long',timeZone:'UTC'})),pmPager('gantt')]),datesRow)
  const insertHeader=(title,kind)=>{
    left.append(pmText('h4',kind==='plan'?'pm-gantt-plan':'pm-gantt-bucket',title))
    right.append(pmGroup('div',kind==='plan'?'pm-gantt-plan-row':'pm-gantt-bucket-row'))
  }
  const insertTask=task=>{
    left.append(pmButton(task.title,()=>openTask(task),'pm-gantt-label'))
    const row=pmGroup('div','pm-gantt-row')
    const a=task.startDate||task.dueDate
    const b=task.dueDate||task.startDate
    const first=Math.max(0,dayDiff(start,a)),last=Math.min(34,dayDiff(start,b))
    if(last>=first){
      const bar=pmButton('',()=>openTask(task),'pm-gantt-bar'+(task.status==='done'?' pm-gantt-done':''))
      bar.style.left=(first/35*100)+'%'
      bar.style.width=(Math.max(1,last-first+1)/35*100)+'%'
      bar.title=task.title+' · '+formatDate(a)+' a '+formatDate(b)
      bar.setAttribute('aria-label',bar.title)
      row.append(bar)
      ganttBars.set(task.id,{task,bar,row})
    }
    right.append(row)
  }
  const planIds=[...new Set(shown.map(task=>task.planId))]
  if(!planIds.length){
    left.append(pmText('p','pm-muted','Nenhuma demanda com prazo neste período.'))
  }else{
    for(const planId of planIds){
      insertHeader(planName(planId),'plan')
      const entries=shown.filter(task=>task.planId===planId)
      const buckets=state.buckets.filter(bucket=>bucket.planId===planId&&!bucket.deleted)
        .sort((a,b)=>a.order-b.order)
      const groupKeys=[...new Set(entries.map(task=>task.bucketId||''))]
      for(const bucketId of groupKeys){
        const bucket=buckets.find(item=>item.id===bucketId)
        insertHeader(bucket?.name||'Outras demandas','bucket')
        for(const task of entries.filter(item=>(item.bucketId||'')===bucketId))insertTask(task)
      }
    }
  }
  layout.append(left,right)
  content.append(layout)
  // Desenhar somente dependências reais entre as barras que estão visíveis.
  requestAnimationFrame(()=>{
    if(!right.isConnected||!ganttBars.size)return
    const ns='http://www.w3.org/2000/svg'
    const overlay=document.createElementNS(ns,'svg')
    overlay.setAttribute('class','pm-gantt-dependencies')
    overlay.setAttribute('width',String(right.scrollWidth))
    overlay.setAttribute('height',String(right.scrollHeight))
    overlay.setAttribute('viewBox','0 0 '+right.scrollWidth+' '+right.scrollHeight)
    overlay.setAttribute('aria-hidden','true')
    const defs=document.createElementNS(ns,'defs')
    const marker=document.createElementNS(ns,'marker')
    marker.setAttribute('id','pm-gantt-dependency-arrow')
    marker.setAttribute('markerWidth','6')
    marker.setAttribute('markerHeight','6')
    marker.setAttribute('refX','5')
    marker.setAttribute('refY','3')
    marker.setAttribute('orient','auto')
    const arrow=document.createElementNS(ns,'path')
    arrow.setAttribute('d','M0 0 L6 3 L0 6 Z')
    marker.append(arrow);defs.append(marker);overlay.append(defs)
    for(const entry of ganttBars.values()){
      for(const dependencyId of entry.task.dependencyIds||[]){
        const predecessor=ganttBars.get(dependencyId)
        if(!predecessor)continue
        const x1=predecessor.bar.offsetLeft+predecessor.bar.offsetWidth
        const y1=predecessor.row.offsetTop+predecessor.row.offsetHeight/2
        const x2=entry.bar.offsetLeft
        const y2=entry.row.offsetTop+entry.row.offsetHeight/2
        const path=document.createElementNS(ns,'path')
        const elbow=x1+Math.min(18,Math.max(9,(x2-x1)/2))
        const route=x2>x1+15
          ? 'M'+x1+' '+y1+' H'+elbow+' V'+y2+' H'+(x2-3)
          : 'M'+x1+' '+y1+' H'+elbow+' V'+(y1+12)+' H'+Math.max(2,x2-9)+' V'+y2+' H'+(x2-3)
        path.setAttribute('d',route)
        path.setAttribute('marker-end','url(#pm-gantt-dependency-arrow)')
        overlay.append(path)
      }
    }
    if(overlay.childNodes.length>1)right.append(overlay)
  })
}
function pmSundayView(content,tasks){
  const day=pmSunday(pmSundayCursor),dates=Array.from({length:7},(_,i)=>addDays(day,-6+i))
  const events=pmEvents(day)
  const event=events.find(e=>/culto|domingo|celebra/i.test(e.title))||events[0]
  const eventIds=new Set(events.map(e=>e.id))
  const work=tasks.filter(task=>dates.includes(task.dueDate||task.startDate)||eventIds.has(task.eventId))
  const pending=work.filter(task=>task.status!=='done')
  const done=work.filter(task=>task.status==='done').length
  const percent=work.length?Math.round(done/work.length*100):0
  const aside=pmGroup('aside','pm-sunday-navigation')
  for(const [id,name,symbol] of [['overview','Visão Geral','calendar'],['liturgia','Liturgia','church'],['equipes','Equipes','team'],['recursos','Recursos','resource'],['checklist','Check-list','checklist']]){
    const b=pmButton('',()=>{pmSundayTab=id;render()},'pm-sunday-navitem')
    b.append(pmIcon(symbol),pmText('span','',name))
    b.setAttribute('aria-pressed',String(pmSundayTab===id));aside.append(b)
  }
  const main=pmGroup('div','pm-sunday-main')
  if(pmSundayTab==='overview'){
    const hero=pmGroup('div','pm-sunday-hero',[
      pmGroup('span','pm-hero-overline',[pmIcon('church')]),
      pmText('strong','pm-hero-date',event?.title||'Cultos e celebrações'),
      pmGroup('div','pm-hero-events',events.length?events.map(pmEventLine):[pmText('span','','Sem eventos oficiais para esta data')])
    ])
    const ring=pmGroup('div','pm-sunday-progress',[
      pmText('strong','','Preparação'),
      pmGroup('div','pm-progress-ring',[pmText('strong','',percent+'%')]),
      pmText('small','',done+' de '+work.length+' demandas concluídas')
    ])
    ring.querySelector('.pm-progress-ring').style.setProperty('--progress',percent+'%')
    const pend=pmGroup('div','pm-sunday-pending',[pmText('strong','','Pendências ('+pending.length+')')])
    if(!pending.length)pend.append(pmText('p','pm-muted','Nenhuma pendência com prazo nesta semana.'))
    for(const task of pending.slice(0,5)){
      const item=pmButton('',()=>openTask(task),'pm-pending-item')
      item.append(pmText('span','pm-aside-check',''),pmText('strong','',task.title),pmText('small','',task.dueDate?'Até '+pmShort(task.dueDate):'Sem prazo'))
      pend.append(item)
    }
    main.append(pmGroup('div','pm-sunday-overview-top',[hero,ring,pend]))
    const teamsView=pmGroup('section','pm-sunday-teams',[pmText('h3','pm-section-title','Equipes relacionadas')])
    const groups=[...new Set(work.map(task=>task.team||'Sem equipe'))]
    const tiles=pmGroup('div','pm-sunday-team-grid')
    for(const group of groups){
      const groupTasks=work.filter(t=>(t.team||'Sem equipe')===group)
      const people=new Set(groupTasks.flatMap(t=>(t.assignees||[]).map(p=>p.email||p.name).filter(Boolean)))
      tiles.append(pmGroup('div','pm-team-tile',[pmGroup('span','pm-team-icon',[pmTeamIcon(group)]),pmGroup('div','',[pmText('strong','',group),pmText('small','',people.size+' responsáveis em demandas')])]))
    }
    if(!groups.length)tiles.append(pmText('p','pm-muted','As equipes aparecerão quando houver demandas vinculadas.'))
    teamsView.append(tiles);main.append(teamsView)
  } else {
    const title={liturgia:'Liturgia',equipes:'Equipes do domingo',recursos:'Recursos e preparativos',checklist:'Check-list da semana'}[pmSundayTab]
    const box=pmGroup('section','pm-sunday-detail',[pmText('h3','pm-section-title',title)])
    let shown=work
    if(pmSundayTab==='liturgia')shown=work.filter(t=>/liturg|celebra/i.test(t.team+' '+t.title))
    if(pmSundayTab==='recursos')shown=work.filter(t=>/técnic|mídia|som|proje|recurso|material|equipamento|infra/i.test(t.team+' '+t.title))
    if(pmSundayTab==='equipes'){
      const grouped=pmGroup('div','pm-sunday-team-grid')
      for(const team of [...new Set(work.map(t=>t.team||'Sem equipe'))]){
        const subset=work.filter(t=>(t.team||'Sem equipe')===team)
        grouped.append(pmGroup('div','pm-team-tile',[pmText('strong','',team),pmText('small','',subset.length+' demanda(s)')]))
      }
      box.append(grouped)
    }else{
      if(!shown.length)box.append(pmText('p','pm-muted','Nenhuma demanda cadastrada nesta seção para a semana selecionada.'))
      for(const task of shown)box.append(pmTaskButton(task))
    }
    main.append(box)
  }
  const sundayHeader=pmHeader('',pmShort(day,{day:'numeric',month:'long',timeZone:'UTC'}),'',[
    pmPager('sunday'),
    pmButton('Selecionar data',()=>{
      calendarDate=day
      selectedCalendarDay=day
      calendarMode='month'
      changeView('calendar-all')
    },'pm-light-button')
  ])
  main.prepend(sundayHeader)
  content.append(pmGroup('div','pm-sunday-layout',[aside,main]))
}
function pmTeamsView(content,tasks){
  const groups=[...new Set([...teams,...tasks.map(t=>t.team).filter(Boolean)])]
  const cards=pmGroup('div','pm-teams-view')
  for(const group of groups){
    const members=tasks.filter(t=>t.team===group)
    const people=[...new Set(members.flatMap(t=>(t.assignees||[]).map(p=>p.name||p.email).filter(Boolean)))]
    const done=members.filter(t=>t.status==='done').length
    const card=pmGroup('article','pm-team-card',[
      pmGroup('div','pm-team-card-top',[pmGroup('span','pm-team-card-icon',[pmTeamIcon(group)]),pmText('h3','',group)]),
      pmGroup('div','pm-team-stats',[
        pmText('strong','',String(members.length)),
        pmText('span','','demandas'),
        pmText('small','',done+' concluída(s)')
      ]),
      pmGroup('div','pm-team-members',people.length?people.map(name=>pmText('span','pm-team-tag',name)): [pmText('span','pm-muted','Sem responsáveis atribuídos')]),
      pmButton('Ver demandas  →',()=>{
        $('team-filter').value=group
        changeView('list',{preserveFilters:true})
      },'pm-text-link')
    ])
    cards.append(card)
  }
  content.append(pmHeader('Pessoas e responsabilidades','Equipes','',[pmCreationButton('task',()=>pmNewTask())]),cards)
}
function pmTodayView(content) {
  const today=todayISO()
  const mine=liveTasks().filter(pmIsMine)
  const due=mine.filter(t=>t.status!=='done'&&t.dueDate===today)
  const late=mine.filter(t=>isOverdue(t,today))
  const done=mine.filter(t=>t.status==='done'&&t.dueDate===today)
  const events=pmEvents(today)
  content.append(pmHeader('Organização pessoal','Meu dia',
    pmShort(today,{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}),[
      pmCreationButton('task',()=>pmNewTask(today))
    ]))
  content.append(pmGroup('div','pm-today-stats',[
    pmGroup('div','pm-today-stat',[pmIcon('checklist'),pmGroup('div','',[pmText('strong','',String(due.length)),pmText('span','','Para hoje')])]),
    pmGroup('div','pm-today-stat'+(late.length?' pm-today-danger':''),[pmIcon('clock'),pmGroup('div','',[pmText('strong','',String(late.length)),pmText('span','','Atrasadas')])]),
    pmGroup('div','pm-today-stat',[pmIcon('circle'),pmGroup('div','',[pmText('strong','',String(done.length)),pmText('span','','Concluídas hoje')])])
  ]))
  const work=pmGroup('section','pm-today-card',[pmText('h3','','Minhas tarefas de hoje')])
  for(const [label,items] of [['Para hoje',due],['Atrasadas',late]]){
    if(!items.length)continue
    work.append(pmText('h4','pm-today-section-title',label))
    for(const task of items){
      const checkbox=node('input',{type:'checkbox','aria-label':'Concluir '+task.title,
        onChange:async e=>{try{await pmComplete(task,e.target.checked)}catch{e.target.checked=false}}})
      work.append(pmGroup('div','pm-today-task',[
        checkbox,
        pmGroup('div','pm-today-task-content',[
          pmButton(task.title,()=>openTask(task),'pm-table-task'),
          pmText('span','',planName(task.planId)+' · '+(task.team||'Sem equipe'))
        ]),
        pmText('span','pm-priority-chip pm-priority-'+(task.priority||'normal'),pmPriorityLabel(task.priority))
      ]))
    }
  }
  if(!due.length&&!late.length)work.append(pmText('p','pm-muted','Tudo em dia! Nenhuma tarefa sua vence hoje e não há pendências atrasadas.'))
  work.append(pmButton('Ver minhas tarefas',()=>{pmDemandTab='mine';changeView('list')},'pm-text-link'))
  const agenda=pmGroup('section','pm-today-card',[pmText('h3','','Agenda IPCVT de hoje')])
  if(!events.length)agenda.append(pmText('p','pm-muted','Nenhum evento da igreja cadastrado para hoje.'))
  for(const event of events){
    const item=pmButton('',()=>openEvent(event),'pm-today-event')
    item.append(pmIcon('calendar'),pmGroup('span','',[pmText('strong','',event.title),pmText('small','',eventDateLabel(event))]))
    agenda.append(item)
  }
  agenda.append(pmButton('Ver calendário',()=>{calendarDate=today;selectedCalendarDay=today;calendarMode='week';changeView('calendar-all')},'pm-text-link'))
  content.append(pmGroup('div','pm-today-layout',[work,agenda]))
}
function pmRenderMain(content,tasks){
  if(currentView==='calendar-all')return calendarMode==='week'?pmWeekView(content,tasks):calendarMode==='year'?pmYearView(content,tasks):pmMonthView(content,tasks)
  if(currentView==='list')return pmDemandView(content,tasks)
  if(currentView==='board')return pmKanbanView(content,tasks)
  if(currentView==='gantt')return pmGanttView(content,tasks)
  if(currentView==='sunday')return pmSundayView(content,tasks)
  if(currentView==='teams')return pmTeamsView(content,tasks)
  const legacy={home:pmTodayView,mine:renderMyDay,plans:renderPlans,events:renderEvents,calendar:renderCalendar,summary:renderSummary,integrations:renderIntegrations,routines:renderRoutines}
  return legacy[currentView](content,tasks)
}
function pmSetSession(next){
  const active=next.status==='authorized'
  document.body.classList.toggle('pm-active',active)
  const avatar=$('pm-avatar')
  if(avatar)avatar.textContent=pmInitials(next.name||next.email||'IP')
  if($('pm-account-name'))$('pm-account-name').textContent=next.name||next.email||''
  if($('pm-settings'))$('pm-settings').hidden=!active||!next.isAdmin
}
$('pm-brand-home').addEventListener('click',()=>{clearTaskFilters();changeView('home')})
function pmSidebarClose(){
  document.body.classList.remove('pm-sidebar-open')
  $('pm-sidebar-toggle').setAttribute('aria-expanded','false')
}
$('pm-sidebar-toggle').addEventListener('click',()=>{
  const next=!document.body.classList.contains('pm-sidebar-open')
  document.body.classList.toggle('pm-sidebar-open',next)
  $('pm-sidebar-toggle').setAttribute('aria-expanded',String(next))
})
$('pm-sidebar-backdrop').addEventListener('click',pmSidebarClose)
document.addEventListener('keydown',event=>{if(event.key==='Escape')pmSidebarClose()})
function pmSyncThemeButton(){
  const dark=document.documentElement.dataset.theme==='dark'
  $('pm-sidebar-theme-label').textContent=dark?'Modo claro':'Modo escuro'
  $('pm-sidebar-theme').setAttribute('aria-label',dark?'Ativar modo claro':'Ativar modo escuro')
}
$('pm-sidebar-theme').addEventListener('click',()=>{$('theme-toggle').click();pmSyncThemeButton()})
$('theme-toggle').addEventListener('click',()=>pmSyncThemeButton())
pmSyncThemeButton()
$('pm-search').addEventListener('input',e=>{$('search-filter').value=e.target.value;render()})
$('pm-notifications').addEventListener('click',()=>$('planner-notifications-button').click())
$('pm-theme').addEventListener('click',()=>{$('theme-toggle').click();$('pm-more').open=false})
$('pm-settings').addEventListener('click',()=>{$('planner-settings-button').click();$('pm-more').open=false})
$('pm-logout').addEventListener('click',()=>$('logout-button').click())

function render() {
  if (session.status !== 'authorized') return
  refreshFilters()
  const selected = activePlans().find(plan => plan.id === selectedPlan())
  const withinPlan = !!selected && taskViews.has(currentView) && currentView !== 'calendar-all'
  const sidebarPlans = $('sidebar-plan-list')
  sidebarPlans.replaceChildren(...activePlans().filter(pmIsMyPlan).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map(plan => {
    const entry = button(plan.name, () => openPlanBoard(plan.id), 'sidebar-plan-link')
    entry.title = plan.name
    entry.setAttribute('aria-current', withinPlan && selected.id === plan.id ? 'page' : 'false')
    return entry
  }))
  if(!sidebarPlans.children.length)sidebarPlans.append(node('span',{class:'sidebar-plan-empty',text:'Nenhum plano associado'}))
  $('search-filter').parentElement.querySelector('span').textContent = currentView === 'events' ? 'Buscar evento' : 'Buscar demanda'
  $('search-filter').placeholder = currentView === 'events' ? 'Encontre um evento pelo nome' : 'Nome, responsável ou equipe'
  const title = { home: 'Meu dia', mine: 'Minhas tarefas', plans: 'Meus planos', events: 'Agenda da igreja', board: 'Minhas tarefas', list: 'Minhas tarefas', calendar: 'Calendário', 'calendar-all': 'Calendário', gantt: 'Gantt', sunday: 'Domingo', teams: 'Equipes', summary: 'Gráficos', integrations: 'Google Agenda', routines: 'Rotinas semanais' }[currentView]
  $('view-title').textContent = withinPlan ? selected.name : title
  $('view-title').parentElement.querySelector('.view-heading-note').textContent = withinPlan
    ? selected.description || 'Organize e acompanhe todas as tarefas deste plano.'
    : ({ home: 'O que você precisa acompanhar hoje.', mine: 'Suas tarefas, em todos os planos.', plans: 'Escolha um plano para começar a trabalhar.', events: 'Datas oficiais para consulta e referência das tarefas.', 'calendar-all': ({week:'Da preparação durante a semana ao culto de domingo, com a Agenda IPCVT como referência.',month:'Visualize os compromissos do mês, unindo a Agenda IPCVT às demandas.',year:'Acompanhe os eventos e as demandas ao longo do ano.'})[calendarMode], list: 'Todas as tarefas, de todos os planos.', integrations: 'Fonte oficial e sincronização do calendário.', routines: 'Demandas que se repetem semanalmente.' })[currentView] || ''
  document.querySelectorAll('[data-view]').forEach(control=>{
    const group=currentView==='board'?'list':currentView
    const view=control.dataset.view
    const correctMode=!control.dataset.calendarMode||control.dataset.calendarMode===calendarMode
    control.setAttribute('aria-pressed',String(view===group&&correctMode))
  })
  pmSyncThemeButton()
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
  if (!activePlans().length && ['calendar', 'summary'].includes(currentView)) {
    content.append(empty('Crie um plano para reunir suas demandas e acompanhar o andamento.'), button('Criar plano', () => openPlan(), 'button button-primary'))
    return
  }
  const tasks = visibleTasks()
  if(document.activeElement !== $('pm-search')) $('pm-search').value = $('search-filter').value
  pmRenderMain(content,tasks)
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
  const repeat = taskRecurrence(current)
  const storedRotation=repeat
    ? parseRotationConfig(state.tasks.find(task=>task.id===rotationConfigId(repeat.sourceId))):null
  rotationGroupsByPerson=new Map((storedRotation?.people||[]).map((person,index)=>[
    rotationPersonKey(person),storedRotation.groups[index]
  ]))
  $('task-repeat-mode').value = repeat ? 'repeat' : 'none'
  $('task-repeat-interval').value = repeat?.interval || 1
  $('task-repeat-unit').value = repeat?.unit || 'week'
  $('task-repeat-advance').value = storedRotation?.advance || 'completion'
  $('task-rotation-mode').value = storedRotation?.mode || 'fixed'
  const dependencies = state.tasks.filter(item => item.planId === current.planId && item.id !== current.id && (!item.deleted || current.dependencyIds?.includes(item.id)))
  const people = [...state.tasks.flatMap(item => item.assignees || []), { name: session.name || '', email: session.email || '' }]
  taskEditor.setTask({...current,assignees:storedRotation?.people||current.assignees||[]}, { people, dependencies })
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
  updateTaskRepeatFields()
}

const rotationPersonKey=person=>(person.email||person.name||'').trim().toLocaleLowerCase('pt-BR')
function currentRotationSettings(){
  const people=taskEditor.getAssignees()
  const groups=people.map((person,index)=>{
    const value=rotationGroupsByPerson.get(rotationPersonKey(person))
    return Number.isInteger(value)?value:index
  })
  return {mode:value('task-rotation-mode'),advance:value('task-repeat-advance'),people,groups}
}
function updateRotationEditor(){
  const enabled=value('task-repeat-mode')==='repeat'
  const mode=value('task-rotation-mode')
  const active=enabled&&mode!=='fixed'
  $('task-rotation-roster').hidden=!active
  $('task-rotation-people-hint').hidden=!active
  $('task-rotation-preview-wrap').hidden=!enabled
  $('task-rotation-roster-hint').textContent=mode==='groups'
    ? 'Defina a ordem dos grupos. Se alguém servir em todas as vezes, selecione Fixo.'
    : 'Reordene as pessoas. Marque Fixo para quem deve acompanhar todos os turnos.'
  const roster=taskEditor.getAssignees()
  const list=$('task-rotation-list')
  list.replaceChildren()
  if(active){
    roster.forEach((person,index)=>{
      const label=person.name||person.email
      const row=node('div',{class:'task-rotation-person'})
      row.append(node('span',{class:'task-rotation-person-name',text:(index+1)+'. '+label}))
      if(mode==='groups'){
        const selector=node('select',{'aria-label':'Grupo de '+label,onChange:e=>{
          rotationGroupsByPerson.set(rotationPersonKey(person),Number(e.target.value))
          updateRotationPreview()
        }})
        selector.append(node('option',{value:'-1',text:'Fixo (todos os turnos)'}))
        for(let group=0;group<Math.max(2,roster.length);group++){
          selector.append(node('option',{value:String(group),text:'Grupo '+(group+1)}))
        }
        selector.value=String(rotationGroupsByPerson.get(rotationPersonKey(person))??index)
        row.append(selector)
      }else{
        const isFixed=rotationGroupsByPerson.get(rotationPersonKey(person))===-1
        const fixed=node('label',{class:'task-rotation-fixed'},[
          node('input',{type:'checkbox',checked:isFixed,onChange:event=>{
            rotationGroupsByPerson.set(rotationPersonKey(person),event.target.checked?-1:index)
            updateRotationPreview()
          }}),
          node('span',{text:'Fixo'})
        ])
        row.append(fixed)
      }
      const up=button('↑',()=>{
        const revised=taskEditor.getAssignees()
        ;[revised[index],revised[index-1]]=[revised[index-1],revised[index]]
        taskEditor.setAssignees(revised)
      },'task-rotation-arrow')
      up.disabled=index===0
      up.setAttribute('aria-label','Mover '+label+' para cima')
      const down=button('↓',()=>{
        const revised=taskEditor.getAssignees()
        ;[revised[index],revised[index+1]]=[revised[index+1],revised[index]]
        taskEditor.setAssignees(revised)
      },'task-rotation-arrow')
      down.disabled=index===roster.length-1
      down.setAttribute('aria-label','Mover '+label+' para baixo')
      row.append(up,down)
      list.append(row)
    })
    if(!roster.length)list.append(node('p',{class:'task-rotation-empty',text:'Adicione duas ou mais pessoas acima.'}))
  }
  updateRotationPreview()
}
function updateRotationPreview(){
  const list=$('task-rotation-preview')
  list.replaceChildren()
  if(value('task-repeat-mode')!=='repeat')return
  try{
    const settings=currentRotationSettings()
    const draft=taskRepeatDraft()
    const rule=taskRecurrence(draft)
    if(!rule||!draft.dueDate)throw new Error('Informe a data e o intervalo da repetição para visualizar o rodízio.')
    const index=recurrenceCycleIndex(rule,draft.dueDate)
    for(let n=0;n<4;n++){
      const date=n===0?draft.dueDate:recurrenceDateAt(rule,index+n)
      const people=rotationAssigneesForDate({...draft,assignees:settings.people},settings,date)
      list.append(node('li',{},[
        node('strong',{text:formatDate(date)}),
        node('span',{text:people.map(person=>person.name||person.email).join(' + ')||'Sem responsável'})
      ]))
    }
  }catch(error){
    list.append(node('li',{class:'task-rotation-empty',text:error.message}))
  }
}

function taskRepeatDraft() {
  const previous = byId('tasks', value('task-id'))
  return setTaskRecurrence({
    ...(previous || {}), id: previous?.id || 'preview',
    dueDate: value('task-due'), dateMode: value('task-date-mode')
  }, value('task-repeat-mode') === 'repeat'
    ? { interval: Number(value('task-repeat-interval')), unit: value('task-repeat-unit') } : null)
}
function updateTaskRepeatFields() {
  const enabled = value('task-repeat-mode') === 'repeat'
  $('task-rotation-settings').hidden = !enabled
  $('task-repeat-advance').disabled = !enabled
  $('task-rotation-mode').disabled = !enabled
  $('task-repeat-options').hidden = !enabled
  $('task-repeat-interval').disabled = !enabled
  $('task-repeat-unit').disabled = !enabled
  $('task-repeat-interval').required = enabled
  $('task-repeat-unit').required = enabled
  for (const option of $('task-repeat-unit').options) {
    const names = { day: ['Dia', 'Dias'], week: ['Semana', 'Semanas'], month: ['Mês', 'Meses'] }[option.value]
    option.textContent = names[Number(value('task-repeat-interval')) === 1 ? 0 : 1]
  }
  const hint = $('task-repeat-hint')
  hint.classList.remove('is-error')
  if (!enabled) {
    hint.textContent = 'Esta demanda acontece uma única vez.'
    updateRotationEditor()
    return
  }
  try {
    const next = nextRecurrenceDate(taskRepeatDraft())
    if (!next) throw new Error('Confira a data de entrega e o intervalo da repetição.')
    hint.textContent = value('task-repeat-advance') === 'scheduled'
      ? 'As próximas quatro ocorrências serão preparadas automaticamente, mesmo sem concluir a anterior. A lista será renovada quando alguém abrir o Planner. Para encerrar, escolha “Não repetir” na ocorrência que define a série.'
      : 'Ao concluir esta demanda, a próxima será criada para ' + formatDate(next) + ', com o checklist reiniciado. Para encerrar, escolha “Não repetir” na ocorrência pendente.'
  } catch (error) {
    hint.textContent = error.message
    hint.classList.add('is-error')
  }
  updateRotationEditor()
}
for (const id of ['task-repeat-mode', 'task-repeat-interval', 'task-repeat-unit']) $(id).addEventListener('input', updateTaskRepeatFields)
for (const id of ['task-repeat-advance','task-rotation-mode']) $(id).addEventListener('change', updateRotationEditor)
$('task-event').addEventListener('change', () => updateTaskEventFields(true))
$('task-date-mode').addEventListener('change', () => updateTaskEventFields(true))
$('task-offset').addEventListener('input', () => updateTaskEventFields(true))
$('task-due').addEventListener('input', () => {
  if (value('task-date-mode') === 'event') {
    $('task-date-mode').value = 'manual'
    updateTaskEventFields()
  }
  updateTaskRepeatFields()
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
    let task = { ...(previous || {}), id: previous?.id || newId(), title: value('task-title'), planId: value('task-plan'), bucketId: value('task-bucket'), team: value('task-team'), description: value('task-description'), assignees: taskEditor.getAssignees(), startDate: value('task-start'), dueDate: value('task-due'), status: value('task-status'), priority: value('task-priority'), checklist: taskEditor.getChecklist(), dependencyIds: taskEditor.getDependencyIds(), eventId: value('task-event'), dateMode: value('task-date-mode'), dueOffsetDays: value('task-date-mode') === 'event' ? Number(value('task-offset')) : null }
    const linkedEvent = liveEvents().find(event => event.id === task.eventId)
    if (linkedEvent?.status === 'cancelled' && previous?.eventId !== task.eventId) throw new Error('Este evento foi cancelado. Escolha outro evento ou salve como demanda sem evento-alvo.')
    if (task.dateMode === 'event') {
      const linked = liveEvents().find(event => event.id === task.eventId)
      if (!linked?.startDate || !Number.isInteger(task.dueOffsetDays) || Math.abs(task.dueOffsetDays) > 365) throw new Error('Selecione um evento e um intervalo de até 365 dias para o prazo relativo.')
      task.dueDate = addDays(linked.startDate, task.dueOffsetDays)
    }
    task = setTaskRecurrence(task, value('task-repeat-mode') === 'repeat'
      ? { interval: Number(value('task-repeat-interval')), unit: value('task-repeat-unit') } : null)
    const config=taskRecurrence(task)?currentRotationSettings():null
    if(config){
      rotationConfigRecord(task,config)
      task.assignees=rotationAssigneesForDate(task,config,task.dueDate)
    }
    const errors = validateTask(task, state.tasks)
    if (errors.length) throw new Error(errors.join(' '))
    if (task.assignees.length > 10 || task.checklist.length > 20 || task.dependencyIds.length > 20) throw new Error('Use até 10 responsáveis, 20 itens de checklist e 20 dependências.')
    if (task.description.length > 10000 || task.checklist.some(item => item.text.length > 300)) throw new Error('Use até 10.000 caracteres na descrição e 300 em cada item do checklist.')
    task.reviewRequired = false
    task.reviewReason = ''
    await action(() => save('tasks',task,config?{rotationConfig:config}:{}),
      previous ? 'Demanda atualizada.' : 'Demanda criada.')
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

function openPlan(plan = null, defaults = {}) {
  $('plan-form').reset()
  $('plan-feedback').textContent = ''
  $('plan-id').value = plan?.id || ''
  $('plan-dialog').dataset.version = plan?.version ?? ''
  $('plan-name').value = plan?.name || ''
  $('plan-dialog-title').textContent = plan ? 'Editar plano' : 'Novo plano'
  $('plan-kind').value = plan?.kind || defaults.kind || 'continuous'
  $('plan-description').value = plan?.description || ''
  $('plan-start').value = plan?.startDate || defaults.startDate || ''
  $('plan-due').value = plan?.dueDate || defaults.dueDate || ''
  $('plan-buckets').value = plan ? state.buckets.filter(bucket => bucket.planId === plan.id && !bucket.deleted).sort((a, b) => a.order - b.order).map(bucket => bucket.name).join('\n') : 'A fazer\nEm andamento\nConcluído'
  $('plan-advanced').open = !!plan || !!defaults.startDate
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
$('new-task-button').addEventListener('click', () => pmNewTask())
$('quick-new-plan').addEventListener('click', () => pmNewPlan())
$('mobile-new-plan').addEventListener('click', () => { $('mobile-more-menu').open = false; openPlan() })
$('new-plan-button').addEventListener('click', () => openPlan())
$('google-login').addEventListener('click', async () => {
  $('google-login').disabled = true
  $('auth-feedback').textContent = 'Abrindo o Google…'
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
    pmSetSession(next)
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



