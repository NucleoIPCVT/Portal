const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_GENERATION_DAYS = 366;
const VALID_STATUSES = ['todo', 'doing', 'done'];
const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

// Dates represent civil calendar days. UTC arithmetic avoids DST shifting a day.
function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

function dateISO(date) {
  const iso = date.toISOString().slice(0, 10);
  return parseDate(iso) ? iso : '';
}

function deterministicId(prefix, sourceId, suffix) {
  return `${prefix}_${encodeURIComponent(String(sourceId))}_${suffix}`;
}

function weekKey(iso) {
  const date = parseDate(iso);
  return date ? addDays(iso, -((date.getUTCDay() + 6) % 7)) : '';
}

function cloneAssignees(assignees) {
  return Array.isArray(assignees) ? assignees.map(person => ({ ...person })) : [];
}

function emptyTaskFields(source) {
  return {
    description: source.description || '',
    team: source.team || '',
    assignees: cloneAssignees(source.assignees),
    status: 'todo',
    priority: VALID_PRIORITIES.includes(source.priority) ? source.priority : 'normal',
    checklist: [],
    dependencyIds: [],
    eventId: '',
    dateMode: 'manual',
    dueOffsetDays: null,
  };
}

export function todayISO() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDays(iso, count) {
  const date = parseDate(iso);
  if (!date || !Number.isInteger(count)) return '';
  date.setUTCDate(date.getUTCDate() + count);
  return Number.isFinite(date.getTime()) ? dateISO(date) : '';
}

export function formatDate(iso) {
  const date = parseDate(iso);
  if (!date) return '—';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function calendarCells(month) {
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) return [];
  const firstDay = parseDate(`${month}-01`);
  if (!firstDay) return [];
  const offset = (firstDay.getUTCDay() + 6) % 7;
  const firstCell = addDays(`${month}-01`, -offset);
  return Array.from({ length: 42 }, (_, index) => addDays(firstCell, index));
}

export function isOverdue(task, today = todayISO()) {
  return Boolean(task && task.status !== 'done' && parseDate(today) && parseDate(task.dueDate) && task.dueDate < today);
}

export function taskProgress(task) {
  if (task?.status === 'done') return 100;
  const checklist = Array.isArray(task?.checklist) ? task.checklist : [];
  if (checklist.length) {
    return Math.round(checklist.filter(item => item?.done === true).length / checklist.length * 100);
  }
  return task?.status === 'doing' ? 50 : 0;
}

export function computeSummary(tasks, today = todayISO()) {
  const items = Array.isArray(tasks) ? tasks.filter(task => task && typeof task === 'object') : [];
  const summary = {
    total: items.length,
    todo: 0,
    doing: 0,
    done: 0,
    overdue: 0,
    dueSoon: 0,
    unassigned: 0,
    completionRate: 0,
    byTeam: {},
    byPriority: { low: 0, normal: 0, high: 0, urgent: 0 },
  };
  const upcomingLimit = addDays(today, 7);
  for (const task of items) {
    const status = VALID_STATUSES.includes(task.status) ? task.status : 'todo';
    const priority = VALID_PRIORITIES.includes(task.priority) ? task.priority : 'normal';
    const team = typeof task.team === 'string' && task.team.trim() ? task.team.trim() : 'Sem equipe';
    const overdue = isOverdue(task, today);
    summary[status] += 1;
    summary.byPriority[priority] += 1;
    summary.overdue += Number(overdue);
    if (!Array.isArray(task.assignees) || !task.assignees.length) summary.unassigned += 1;
    if (status !== 'done' && parseDate(task.dueDate) && upcomingLimit && task.dueDate >= today && task.dueDate <= upcomingLimit) {
      summary.dueSoon += 1;
    }
    // Define own properties so arbitrary team names such as '__proto__' are safe.
    if (!Object.hasOwn(summary.byTeam, team)) {
      Object.defineProperty(summary.byTeam, team, {
        value: { total: 0, todo: 0, doing: 0, done: 0, overdue: 0 },
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    const teamSummary = summary.byTeam[team];
    teamSummary.total += 1;
    teamSummary[status] += 1;
    teamSummary.overdue += Number(overdue);
  }
  summary.completionRate = summary.total ? Math.round(summary.done / summary.total * 100) : 0;
  return summary;
}

export function validateTask(task, allTasks = []) {
  const errors = [];
  if (!task || typeof task.title !== 'string' || !task.title.trim()) errors.push('Informe o título da tarefa.');
  if (!task || typeof task !== 'object') return errors;

  for (const [field, label] of [['startDate', 'início'], ['dueDate', 'prazo']]) {
    if (task[field] && !parseDate(task[field])) errors.push(`A data de ${label} é inválida.`);
  }
  if (parseDate(task.startDate) && parseDate(task.dueDate) && task.dueDate < task.startDate) {
    errors.push('O prazo não pode ser anterior à data de início.');
  }

  const candidateId = task.id || Symbol('new-task');
  const tasksById = new Map((Array.isArray(allTasks) ? allTasks : []).filter(item => item?.id).map(item => [item.id, item]));
  tasksById.set(candidateId, task);
  const dependencies = Array.isArray(task.dependencyIds) ? task.dependencyIds : [];
  if (dependencies.includes(candidateId)) errors.push('A tarefa não pode depender dela mesma.');
  if (dependencies.some(id => id !== candidateId && !tasksById.has(id))) {
    errors.push('Uma das tarefas de dependência não foi encontrada.');
  }

  const visiting = new Set();
  const visited = new Set();
  function hasCycle(id) {
    if (visiting.has(id)) return true;
    if (visited.has(id) || !tasksById.has(id)) return false;
    visiting.add(id);
    const item = tasksById.get(id);
    for (const predecessor of Array.isArray(item.dependencyIds) ? item.dependencyIds : []) {
      if (hasCycle(predecessor)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }
  if (hasCycle(candidateId) && !dependencies.includes(candidateId)) {
    errors.push('As dependências criam um ciclo entre tarefas.');
  }
  return errors;
}

export function generateWeeklyTasks(routine, fromISO, toISO, existingTasks = []) {
  if (!routine?.active) return [];
  if (!routine.id) throw new TypeError('A rotina precisa de uma identificação.');
  if (!Number.isInteger(routine.weekday) || routine.weekday < 0 || routine.weekday > 6) {
    throw new RangeError('O dia da semana da rotina deve estar entre 0 e 6.');
  }
  const from = parseDate(fromISO);
  const to = parseDate(toISO);
  if (!from || !to || to < from) throw new RangeError('Informe um intervalo de datas válido para gerar a rotina.');
  const days = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
  if (days > MAX_GENERATION_DAYS) throw new RangeError(`Gere no máximo ${MAX_GENERATION_DAYS} dias de cada vez.`);
  if (routine.startDate && !parseDate(routine.startDate)) throw new RangeError('A data inicial da rotina é inválida.');
  let first = routine.startDate && routine.startDate > fromISO ? routine.startDate : fromISO;
  if (first > toISO) return [];
  const weekday = parseDate(first).getUTCDay();
  first = addDays(first, (routine.weekday - weekday + 7) % 7);

  const existing = Array.isArray(existingTasks) ? existingTasks : [];
  const ids = new Set(existing.map(task => task?.id));
  const cycles = new Set();
  for (const task of existing.filter(task => task?.routineId === routine.id)) {
    // Accept legacy occurrence-date keys and manually moved occurrences as well.
    for (const date of [task.cycleKey, task.dueDate]) {
      const key = weekKey(date);
      if (key) cycles.add(key);
    }
  }
  const generated = [];
  for (let occurrence = first; occurrence && occurrence <= toISO; occurrence = addDays(occurrence, 7)) {
    const cycleKey = weekKey(occurrence);
    const id = deterministicId('routine', routine.id, cycleKey);
    if (ids.has(id) || cycles.has(cycleKey)) continue;
    generated.push({
      ...emptyTaskFields(routine),
      id,
      planId: routine.planId || '',
      bucketId: routine.bucketId || '',
      title: routine.title || '',
      startDate: occurrence,
      dueDate: occurrence,
      routineId: routine.id,
      cycleKey,
    });
    ids.add(id);
    cycles.add(cycleKey);
  }
  return generated;
}

const EVENT_PREPARATION = [
  { key: 'band', title: 'Selecionar banda', team: 'Louvor', offset: -7, buckets: ['banda', 'Música', 'Louvor', 'Preparação musical'] },
  { key: 'repertoire', title: 'Definir repertório', team: 'Louvor', offset: -5, buckets: ['repertorio', 'Música', 'Louvor', 'Preparação musical'] },
  { key: 'liturgy', title: 'Montar liturgia', team: 'Liturgia', offset: -3, buckets: ['liturgia', 'Liturgia'] },
  { key: 'technical', title: 'Preparar técnica', team: 'Técnica', offset: -1, buckets: ['tecnica', 'Técnica', 'Produção técnica'] },
];

// Projetos especiais precisam começar muito antes da data oficial do evento.
// Os dois modelos usam chaves determinísticas para não gerar a mesma demanda duas vezes.
const SPECIAL_EVENT_PREPARATION = [
  { key: 'special-concept', title: 'Definir proposta e programação do evento', team: 'Comissão', offset: -120, buckets: ['Planejamento', 'Comissão'] },
  { key: 'special-script', title: 'Elaborar roteiro e programação detalhada', team: 'Litúrgico', offset: -90, buckets: ['Planejamento', 'Liturgia'] },
  { key: 'special-people', title: 'Confirmar equipes e participantes', team: 'Comissão', offset: -75, buckets: ['Planejamento', 'Comissão'] },
  { key: 'special-music', title: 'Preparar repertório e arranjos', team: 'Louvor', offset: -60, buckets: ['Preparação musical', 'Planejamento'] },
  { key: 'special-promotion', title: 'Preparar comunicação e divulgação', team: 'Comunicação', offset: -45, buckets: ['Comunicação', 'Planejamento'] },
  { key: 'special-production', title: 'Planejar estrutura, som e projeção', team: 'Técnica', offset: -30, buckets: ['Técnica', 'Planejamento'] },
  { key: 'special-alignment', title: 'Alinhar programação final com as equipes', team: 'Comissão', offset: -14, buckets: ['Revisão', 'Planejamento'] },
  { key: 'special-rehearsal', title: 'Realizar ensaio geral', team: 'Louvor', offset: -7, buckets: ['Execução', 'Preparação musical'] },
  { key: 'special-check', title: 'Conferir os preparativos finais', team: 'Técnica', offset: -1, buckets: ['Revisão', 'Técnica'] },
];

export function eventPreparationTasks(event, planId, bucketIdsByName = {}, existingTasks = [], mode = 'standard') {
  if (!event || event.status === 'cancelled') return [];
  if (!event.id) throw new TypeError('O evento precisa de uma identificação.');
  if (!parseDate(event.startDate)) throw new RangeError('A data inicial do evento é inválida.');
  const existing = Array.isArray(existingTasks) ? existingTasks : [];
  const ids = new Set(existing.map(task => task?.id));
  const templates = new Set(existing.filter(task => task?.eventId === event.id && task.templateKey).map(task => task.templateKey));
  const result = [];
  const definitions = mode === 'special' ? SPECIAL_EVENT_PREPARATION : EVENT_PREPARATION;
  for (const template of definitions) {
    const id = deterministicId('event', event.id, template.key);
    if (ids.has(id) || templates.has(template.key)) continue;
    const bucketId = template.buckets.map(key => bucketIdsByName?.[key]).find(value => typeof value === 'string' && value)
      || bucketIdsByName?.default || bucketIdsByName?.Geral || '';
    const dueDate = addDays(event.startDate, template.offset);
    result.push({
      ...emptyTaskFields(template),
      id,
      planId: planId || '',
      bucketId,
      title: template.title,
      description: event.title ? `Preparação para ${event.title}.` : '',
      startDate: dueDate,
      dueDate,
      eventId: event.id,
      dateMode: 'event',
      dueOffsetDays: template.offset,
      templateKey: template.key,
    });
  }
  return result;
}

