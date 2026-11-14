// Modelo compartilhado entre o download Excel e a importação de projetos.
// Não grava dados: a confirmação e as permissões ficam no Planner/Firestore.
export const PROJECT_FIELDS = ['Campo', 'Valor'];
export const TASK_FIELDS = [
  'ID', 'Título', 'Descrição', 'Etapa', 'Equipe', 'Responsáveis',
  'Início', 'Prazo', 'Status', 'Prioridade', 'Depende de', 'Checklist'
];

const standardBuckets = ['A fazer', 'Em andamento', 'Concluído'];
const normalize = value => String(value ?? '').trim()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const clean = value => String(value ?? '').trim();
const splitItems = value => clean(value).split(/[;\n]+/).map(item => item.trim()).filter(Boolean);
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export function downloadProjectTemplate(XLSX) {
  if (!XLSX?.utils?.book_new) throw new Error('Não foi possível carregar o editor Excel. Confira sua conexão e tente novamente.');
  const book = XLSX.utils.book_new();
  const project = XLSX.utils.aoa_to_sheet([
    PROJECT_FIELDS,
    ['Nome do plano', ''],
    ['Descrição', ''],
    ['Data de início', ''],
    ['Data de conclusão', '']
  ]);
  project['!cols'] = [{ wch: 25 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(book, project, 'Projeto');
  const tasks = XLSX.utils.aoa_to_sheet([TASK_FIELDS]);
  tasks['!cols'] = [
    { wch: 12 }, { wch: 36 }, { wch: 50 }, { wch: 24 }, { wch: 22 },
    { wch: 45 }, { wch: 16 }, { wch: 16 }, { wch: 21 }, { wch: 16 },
    { wch: 22 }, { wch: 55 }
  ];
  XLSX.utils.book_append_sheet(book, tasks, 'Demandas');
  const instructions = XLSX.utils.aoa_to_sheet([
    ['MODELO IPCVT PLANNER', 'Preencha as abas Projeto e Demandas. Não renomeie abas ou cabeçalhos.'],
    ['Preenchimento com IA', 'Envie este arquivo vazio para a IA, peça o plano completo e solicite que preserve a estrutura.'],
    ['Projeto', 'Informe o nome. Descrição e datas gerais são opcionais; se omitidas, o Planner deduz as datas das tarefas.'],
    ['Demandas', 'Cada linha é uma tarefa. ID e Título são obrigatórios.'],
    ['ID', 'Código único na planilha: T01, T02, T03. Nunca repita um ID.'],
    ['Etapa', 'Coluna do Kanban. Ex.: Planejamento, Execução, Revisão. Vazia = etapa sugerida pelo status.'],
    ['Responsáveis', 'Separe por ponto e vírgula. Ex.: Ana <ana@exemplo.com>; João. Máximo: 10.'],
    ['Datas', 'Use DD/MM/AAAA ou AAAA-MM-DD. A data final não pode ser anterior ao início.'],
    ['Status', 'Não iniciada; Em andamento; Concluída. Vazio = Não iniciada.'],
    ['Prioridade', 'Baixa; Normal; Alta; Urgente. Vazio = Normal.'],
    ['Depende de', 'IDs de outras demandas separados por ponto e vírgula. Ex.: T01; T03. Sem ciclos.'],
    ['Checklist', 'Itens separados por ponto e vírgula. Máximo de 20 itens, até 300 caracteres cada.'],
    ['Exemplo apenas nesta aba', 'ID T03: "Montar estrutura" depende de T01; T02. Não inclua linhas de exemplo em Demandas.'],
    ['Segurança', 'Importa um NOVO plano; não altera planos existentes. Confira a prévia antes de confirmar.']
  ]);
  instructions['!cols'] = [{ wch: 28 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(book, instructions, 'Instruções');
  XLSX.writeFile(book, 'Modelo_Projeto_Planner_IPCVT.xlsx');
}

function readDate(value) {
  if (value === '' || value === undefined || value === null) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return [value.getUTCFullYear(), String(value.getUTCMonth() + 1).padStart(2, '0'), String(value.getUTCDate()).padStart(2, '0')].join('-');
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 1 || value > 2958465) return null;
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    return readDate(date);
  }
  const text = clean(value);
  let y, m, d;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const br = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(text);
  if (iso) [, y, m, d] = iso;
  else if (br) [, d, m, y] = br;
  else return null;
  y = Number(y); m = Number(m); d = Number(d);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() + 1 !== m || date.getUTCDate() !== d) return null;
  return [y, String(m).padStart(2, '0'), String(d).padStart(2, '0')].join('-');
}

function readAssignees(value, label, problems) {
  const people = [];
  const seen = new Set();
  for (const raw of splitItems(value)) {
    const match = /^(.*?)\s*<([^<>]+)>$/.exec(raw);
    const name = clean(match ? match[1] : raw.includes('@') ? raw.split('@')[0] : raw);
    const email = clean(match ? match[2] : raw.includes('@') ? raw : '').toLowerCase();
    if (!name && !email || name.length > 120 || email.length > 254 ||
        (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))) {
      problems.push(label + ': responsável inválido (' + raw.slice(0, 50) + ').');
      continue;
    }
    const key = normalize(email || name);
    if (!seen.has(key)) { people.push({ name, email }); seen.add(key); }
  }
  if (people.length > 10) problems.push(label + ': máximo de 10 responsáveis.');
  return people.slice(0, 10);
}

function statusValue(value, label, errors) {
  const map = {
    '': 'todo', 'todo': 'todo', 'nao iniciada': 'todo', 'nao iniciado': 'todo',
    'a fazer': 'todo', 'pendente': 'todo', 'planejada': 'todo',
    'doing': 'doing', 'em andamento': 'doing', 'andamento': 'doing',
    'done': 'done', 'concluida': 'done', 'concluido': 'done', 'finalizada': 'done'
  };
  const key = normalize(value);
  if (!has(map, key)) errors.push(label + ': status desconhecido "' + clean(value) + '".');
  return map[key] || 'todo';
}
function priorityValue(value, label, errors) {
  const map = { '': 'normal', 'normal': 'normal', 'low': 'low', 'baixa': 'low',
    'high': 'high', 'alta': 'high', 'urgent': 'urgent', 'urgente': 'urgent' };
  const key = normalize(value);
  if (!has(map, key)) errors.push(label + ': prioridade desconhecida "' + clean(value) + '".');
  return map[key] || 'normal';
}

function assertHeader(table, required, sheet, errors) {
  const found = (table[0] || []).map(normalize);
  if (required.some(field => !found.includes(normalize(field)))) {
    errors.push('Aba "' + sheet + '": faltam cabeçalhos. Baixe novamente o modelo original.');
    return null;
  }
  return required.map(field => found.indexOf(normalize(field)));
}

function ensureNoFormula(sheet, sheetName, errors) {
  for (const [address, cell] of Object.entries(sheet)) {
    if (address.startsWith('!')) continue;
    if (cell?.f) { errors.push('Aba "' + sheetName + '": há fórmulas. Converta as fórmulas em valores antes de importar.'); return; }
  }
}

// Entrada pura, testável também fora do navegador. IDs são gerados antes da gravação.
export function parseProjectWorkbook(workbook, XLSX, createId = () => crypto.randomUUID()) {
  const errors = [], warnings = [];
  const sheetProject = workbook?.Sheets?.Projeto;
  const sheetTasks = workbook?.Sheets?.Demandas;
  if (!sheetProject || !sheetTasks) return { errors: ['O arquivo precisa ter as abas "Projeto" e "Demandas" do modelo IPCVT.'], warnings };
  ensureNoFormula(sheetProject, 'Projeto', errors);
  ensureNoFormula(sheetTasks, 'Demandas', errors);
  const projectRows = XLSX.utils.sheet_to_json(sheetProject, { header: 1, defval: '', raw: true });
  const taskRows = XLSX.utils.sheet_to_json(sheetTasks, { header: 1, defval: '', raw: true });
  const projectCols = assertHeader(projectRows, PROJECT_FIELDS, 'Projeto', errors);
  const taskCols = assertHeader(taskRows, TASK_FIELDS, 'Demandas', errors);
  if (!projectCols || !taskCols) return { errors, warnings };
  const values = new Map();
  for (const row of projectRows.slice(1)) {
    const key = normalize(row[projectCols[0]]);
    if (key) values.set(key, row[projectCols[1]]);
  }
  const name = clean(values.get('nome do plano'));
  const description = clean(values.get('descricao'));
  if (!name || name.length > 120) errors.push('Projeto: informe um nome de plano com até 120 caracteres.');
  if (description.length > 5000) errors.push('Projeto: a descrição deve ter até 5.000 caracteres.');
  const start = readDate(values.get('data de inicio'));
  const due = readDate(values.get('data de conclusao'));
  if (start === null || due === null) errors.push('Projeto: confira as datas (DD/MM/AAAA ou AAAA-MM-DD).');
  if (start && due && due < start) errors.push('Projeto: a conclusão não pode ser anterior ao início.');

  const rows = taskRows.slice(1).map((raw, index) => ({
    index: index + 2, cells: Object.fromEntries(TASK_FIELDS.map((header, col) => [header, raw[taskCols[col]]]))
  })).filter(({ cells }) => TASK_FIELDS.some(field => clean(cells[field]) !== ''));
  if (!rows.length) errors.push('Demandas: adicione pelo menos uma tarefa.');
  if (rows.length > 100) errors.push('Demandas: importe até 100 tarefas por projeto.');

  const planId = createId();
  const codes = new Map();
  const draftTasks = [];
  const buckets = [...standardBuckets];
  const bucketIndex = new Map(buckets.map((bucket, i) => [normalize(bucket), i]));
  for (const { index, cells } of rows.slice(0, 100)) {
    const label = 'Demandas, linha ' + index;
    const code = clean(cells.ID);
    const title = clean(cells['Título']);
    const taskStart = readDate(cells['Início']);
    const taskDue = readDate(cells['Prazo']);
    const status = statusValue(cells.Status, label, errors);
    const priority = priorityValue(cells.Prioridade, label, errors);
    const team = clean(cells.Equipe);
    const text = clean(cells['Descrição']);
    const stage = clean(cells.Etapa) || ({ todo: 'A fazer', doing: 'Em andamento', done: 'Concluído' })[status];
    const checklistTexts = splitItems(cells.Checklist);
    const dependencies = splitItems(cells['Depende de']);
    if (!code || code.length > 100) errors.push(label + ': ID obrigatório, até 100 caracteres.');
    if (codes.has(normalize(code))) errors.push(label + ': ID "' + code + '" repetido.');
    if (!title || title.length > 160) errors.push(label + ': título obrigatório, até 160 caracteres.');
    if (text.length > 10000) errors.push(label + ': descrição limitada a 10.000 caracteres.');
    if (team.length > 120) errors.push(label + ': nome da equipe limitado a 120 caracteres.');
    if (stage.length > 80) errors.push(label + ': etapa limitada a 80 caracteres.');
    if (taskStart === null || taskDue === null) errors.push(label + ': data inválida.');
    if (taskStart && taskDue && taskDue < taskStart) errors.push(label + ': prazo anterior ao início.');
    if (!taskDue) warnings.push(label + ': sem prazo; não aparecerá como barra no Gantt.');
    if (checklistTexts.length > 20 || checklistTexts.some(item => item.length > 300)) errors.push(label + ': checklist limitado a 20 itens de até 300 caracteres.');
    if (dependencies.length > 20) errors.push(label + ': máximo de 20 dependências.');
    if (!bucketIndex.has(normalize(stage))) { bucketIndex.set(normalize(stage), buckets.length); buckets.push(stage); }
    const id = createId();
    if (code) codes.set(normalize(code), id);
    draftTasks.push({
      id, planId, title, description: text, team,
      assignees: readAssignees(cells['Responsáveis'], label, errors),
      startDate: taskStart || '', dueDate: taskDue || '',
      status, priority, stage, dependencyCodes: dependencies,
      checklist: checklistTexts.map(value => ({ id: createId(), text: value, done: false })),
      dateMode: 'manual', eventId: '', dueOffsetDays: null, deleted: false
    });
  }
  if (buckets.length > 30) errors.push('Projeto: máximo de 30 etapas diferentes.');
  const bucketRecords = buckets.map((bucket, order) => ({ id: createId(), planId, name: bucket, order }));
  const bucketIds = new Map(bucketRecords.map(bucket => [normalize(bucket.name), bucket.id]));
  const tasks = draftTasks.map(task => {
    const dependencyIds = task.dependencyCodes.map(code => {
      const id = codes.get(normalize(code));
      if (!id) errors.push('Demanda "' + task.title + '": dependência "' + code + '" não existe na coluna ID.');
      if (id === task.id) errors.push('Demanda "' + task.title + '": não pode depender de si mesma.');
      return id;
    }).filter(Boolean);
    const { stage, dependencyCodes, ...rest } = task;
    return { ...rest, bucketId: bucketIds.get(normalize(stage)), dependencyIds: [...new Set(dependencyIds)] };
  });
  const byId = new Map(tasks.map(task => [task.id, task]));
  const visiting = new Set(), visited = new Set();
  function loop(id) {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if ((byId.get(id)?.dependencyIds || []).some(loop)) return true;
    visiting.delete(id); visited.add(id);
    return false;
  }
  if (tasks.some(task => loop(task.id))) errors.push('Demandas: existem dependências circulares. Revise a coluna "Depende de".');
  const taskDates = tasks.flatMap(task => [task.startDate, task.dueDate]).filter(Boolean).sort();
  const inferredStart = start || taskDates[0] || '';
  const inferredEnd = due || taskDates[taskDates.length - 1] || '';
  if (inferredStart && inferredEnd && inferredEnd < inferredStart) errors.push('Projeto: as datas gerais não abrangem um período válido.');
  if (tasks.some(task => task.dueDate && inferredEnd && task.dueDate > inferredEnd))
    warnings.push('Algumas demandas terminam depois da data final informada para o projeto.');
  if (tasks.some(task => task.startDate && inferredStart && task.startDate < inferredStart))
    warnings.push('Algumas demandas começam antes do início informado para o projeto.');
  if (errors.length) return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
  return {
    errors: [], warnings: [...new Set(warnings)],
    plan: { id: planId, name, description, kind: 'project', startDate: inferredStart, dueDate: inferredEnd },
    buckets: bucketRecords, tasks
  };
}

export async function readProjectFile(file, XLSX) {
  if (!XLSX?.read) throw new Error('A biblioteca de leitura Excel não carregou. Confira a internet e tente novamente.');
  if (!file || !/\.xlsx$/i.test(file.name) || file.size > 5 * 1024 * 1024)
    throw new Error('Envie um arquivo .xlsx de até 5 MB.');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  return parseProjectWorkbook(workbook, XLSX);
}
