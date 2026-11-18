const plan = { type: 'string', maxLength: 200 };
const person = { type: 'string', maxLength: 254 };
const date = { type: 'string', format: 'date' };
const limit = { type: 'integer', minimum: 1, maximum: 100 };
const pageSize = 50;
const pageLimit = 20;
const assigneeFilters = { nomeOuEmail: person, planoId: plan, maximoResultados: limit };
const deadlineFilters = { de: date, ate: date, planoId: plan, responsavel: person, incluirConcluidas: { type: 'boolean' }, maximoResultados: limit };

export const TASK_QUERY_DESCRIPTORS = [
  {
    name: 'consultar_responsaveis',
    description: 'Agrupa as demandas por responsável, com pendências, atrasos e primeiro prazo em aberto. Informa quando a leitura é parcial.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: assigneeFilters
    }
  },
  {
    name: 'consultar_prazos',
    description: 'Lista demandas por vencimento, com filtros de período, plano e responsável. Informa quando a leitura é parcial.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: deadlineFilters
    }
  }
];

export function isPlannerDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T12:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function plannerToday(clock) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(clock());
}

// A última página pode vir com menos de 50 registros e ainda ter continuação.
export async function readTaskPages(list, visit) {
  const seen = new Set();
  let cursor = '';
  let scanned = 0;
  for (let index = 0; index < pageLimit; index++) {
    const page = await list('tasks', { pageSize, pageToken: cursor });
    if (!Array.isArray(page?.items)) throw new Error('Leitura incompleta do Planner.');
    scanned += page.items.length;
    for (const task of page.items) visit(task);
    if (page.nextPageToken == null || page.nextPageToken === '') {
      return { registrosLidos: scanned, resultadoCompleto: true };
    }
    cursor = page.nextPageToken;
    if (typeof cursor !== 'string' || seen.has(cursor)) throw new Error('Paginação inválida.');
    seen.add(cursor);
  }
  return { registrosLidos: scanned, resultadoCompleto: false, aviso: 'Limite de páginas atingido. Resultado parcial.' };
}

function invalidArgument() {
  throw Object.assign(new Error('Argumento inválido para a consulta.'), { code: 'invalid_arguments' });
}

function validateOptions(options, schema) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) invalidArgument();
  for (const [key, value] of Object.entries(options)) {
    if (!Object.hasOwn(schema, key)) invalidArgument();
    const field = schema[key];
    if (field.type === 'integer') {
      if (!Number.isInteger(value) || value < field.minimum || value > field.maximum) invalidArgument();
    } else if (typeof value !== field.type || (field.maxLength && value.length > field.maxLength)) {
      invalidArgument();
    } else if (field.format === 'date' && value !== '' && !isPlannerDate(value)) {
      invalidArgument();
    }
  }
  if (options.de && options.ate && options.de > options.ate) invalidArgument();
}

function searchText(value) {
  return String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function matchesPerson(person, query) {
  return searchText(person?.name).includes(query) || searchText(person?.email).includes(query);
}

export async function queryDeadlines(list, options) {
  validateOptions(options, deadlineFilters);
  const planId = options.planoId?.trim();
  const query = searchText(options.responsavel);
  const matches = [];
  const page = await readTaskPages(list, task => {
    if (task.deleted || (planId && task.planId !== planId) || !isPlannerDate(task.dueDate)) return;
    if (!options.incluirConcluidas && task.status === 'done') return;
    if ((options.de && task.dueDate < options.de) || (options.ate && task.dueDate > options.ate)) return;
    if (query && !(Array.isArray(task.assignees) && task.assignees.some(person => matchesPerson(person, query)))) return;
    matches.push(task);
  });
  matches.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || String(a.id).localeCompare(String(b.id)));
  const demandas = matches.slice(0, options.maximoResultados ?? 50);
  return { ...page, fuso: 'America/Sao_Paulo', quantidadeEncontrada: matches.length, exibidas: demandas.length, demandas };
}

export async function queryAssignees(list, options, clock = () => new Date()) {
  validateOptions(options, assigneeFilters);
  const planId = options.planoId?.trim();
  const query = searchText(options.nomeOuEmail);
  const today = plannerToday(clock);
  const people = new Map();
  const page = await readTaskPages(list, task => {
    if (task.deleted || (planId && task.planId !== planId) || !Array.isArray(task.assignees)) return;
    const counted = new Set();
    for (const person of task.assignees) {
      if (!person || !matchesPerson(person, query)) continue;
      const key = (typeof person.email === 'string' && person.email.trim().toLowerCase()) || searchText(person.name);
      if (!key || counted.has(key)) continue;
      counted.add(key);
      const row = people.get(key) ?? {
        nome: person.name || '', email: person.email || '', demandas: 0, pendentes: 0, atrasadas: 0, proximoPrazo: null
      };
      people.set(key, row);
      row.demandas++;
      if (task.status === 'done') continue;
      row.pendentes++;
      if (!isPlannerDate(task.dueDate)) continue;
      if (task.dueDate < today) row.atrasadas++;
      if (!row.proximoPrazo || task.dueDate < row.proximoPrazo) row.proximoPrazo = task.dueDate;
    }
  });
  const sorted = [...people.values()].sort((a, b) => (a.nome || a.email).localeCompare(b.nome || b.email, 'pt-BR'));
  const responsaveis = sorted.slice(0, options.maximoResultados ?? 50);
  return {
    ...page, origem: 'O resultado agrupa os responsáveis informados nas demandas e não é o cadastro de membros.',
    quantidadeEncontrada: sorted.length, exibidos: responsaveis.length, responsaveis
  };
}
