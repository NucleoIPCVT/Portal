import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PROJECT_FIELDS, TASK_FIELDS, parseProjectWorkbook,
  downloadProjectTemplate, existingProjectByName
} from '../planner-excel-import.js'

const mockXLSX = {
  utils: {
    sheet_to_json: sheet => sheet.rows,
    book_new: () => ({ SheetNames: [], Sheets: {} }),
    aoa_to_sheet: rows => ({ rows }),
    book_append_sheet: (book, sheet, name) => { book.SheetNames.push(name); book.Sheets[name] = sheet }
  },
  writeFile: (book, filename) => { mockXLSX.lastDownload = { book, filename } }
}
const projectRows = [
  PROJECT_FIELDS,
  ['Nome do plano', 'Projeto de Natal'],
  ['Descrição', 'Planejamento integrado'],
  ['Data de início', '01/12/2026'],
  ['Data de conclusão', '24/12/2026']
]
const task = (title, date, depends = '', extra = {}) => {
  const obj = { 'Título': title, 'Descrição': '', Etapa: '', Equipe: '',
    'Responsáveis': '', 'Início': '', Prazo: date, Status: '', Prioridade: '',
    'Depende de': depends, Checklist: '', ...extra }
  return TASK_FIELDS.map(field => obj[field] ?? '')
}
const workbook = (rows, project = projectRows) => ({
  Sheets: { Projeto: { rows: project }, Demandas: { rows: [TASK_FIELDS, ...rows] } }
})
const parse = (rows, project) => {
  let id = 0
  return parseProjectWorkbook(workbook(rows, project), mockXLSX, () => 'generated-' + (++id))
}

test('base Excel não exige ID e contém duas abas vazias para preenchimento e instruções', () => {
  downloadProjectTemplate(mockXLSX)
  const result = mockXLSX.lastDownload
  assert.equal(result.filename, 'Modelo_Projeto_Planner_IPCVT.xlsx')
  assert.deepEqual(result.book.SheetNames, ['Projeto', 'Demandas', 'Instruções'])
  assert.deepEqual(result.book.Sheets.Demandas.rows, [TASK_FIELDS])
  assert.equal(result.book.Sheets.Projeto.rows[1][1], '')
  assert.ok(!TASK_FIELDS.includes('ID'))
})

test('importa datas, responsáveis, status, checklist, etapas e dependências pelo título', () => {
  const result = parse([
    task('Escolher repertório', '10/12/2026', '', {
      'Início': '02/12/2026', Equipe: 'Louvor',
      'Responsáveis': 'Ana <ana@example.com>; João', Checklist: 'Consultar equipe; Enviar proposta',
      Etapa: 'Planejamento', Prioridade: 'Alta'
    }),
    task('Ensaiar', '2026-12-20', 'escolher repertório', {
      Status: 'Em andamento', Etapa: 'Execução'
    })
  ])
  assert.deepEqual(result.errors, [])
  assert.equal(result.plan.kind, 'project')
  assert.equal(result.tasks.length, 2)
  assert.equal(result.tasks[0].dueDate, '2026-12-10')
  assert.equal(result.tasks[0].startDate, '2026-12-02')
  assert.equal(result.tasks[0].assignees[0].email, 'ana@example.com')
  assert.equal(result.tasks[0].assignees[1].name, 'João')
  assert.equal(result.tasks[0].checklist.length, 2)
  assert.equal(result.tasks[0].priority, 'high')
  assert.equal(result.tasks[1].status, 'doing')
  assert.deepEqual(result.tasks[1].dependencyIds, [result.tasks[0].id])
  assert.ok(result.buckets.some(bucket => bucket.name === 'Planejamento'))
  assert.ok(result.buckets.some(bucket => bucket.name === 'Execução'))
  assert.ok(result.tasks.every(item => result.buckets.some(bucket => bucket.id === item.bucketId)))
})

test('sinaliza nomes duplicados, inexistentes e dependências circulares', () => {
  const duplicate = parse([task('Ensaio Geral', '2026-12-03'), task('ensaio  geral', '2026-12-04')])
  assert.match(duplicate.errors.join(' '), /mesmo título/)
  const missing = parse([task('Primeira', '2026-12-03', 'Outra tarefa')])
  assert.match(missing.errors.join(' '), /não corresponde/)
  const cycle = parse([task('Primeira', '2026-12-03', 'Segunda'), task('Segunda', '2026-12-04', 'Primeira')])
  assert.match(cycle.errors.join(' '), /circulares/)
})

test('identifica planos existentes independentemente de maiúsculas, acentos e espaços', () => {
  const plans = [{ name: '  CANTATA  de NATAL ', id: 'x', deleted: false },
    { name: 'Arquivo Antigo', id: 'y', deleted: true }]
  assert.equal(existingProjectByName('cantata de natal', plans)?.id, 'x')
  assert.equal(existingProjectByName('Cantáta de Natal', plans)?.id, 'x')
  assert.equal(existingProjectByName('Arquivo Antigo', plans), undefined)
  assert.equal(existingProjectByName('Projeto inédito', plans), undefined)
})

test('rejeita datas impossíveis, prazo anterior ao início e status desconhecido', () => {
  const bad = parse([task('Inviável', '31/02/2027', '', { 'Início': '2027-03-12', Status: 'Talvez' })])
  assert.match(bad.errors.join(' '), /data inválida/)
  assert.match(bad.errors.join(' '), /status desconhecido/)
  const reversed = parse([task('Invertida', '2026-12-04', '', { 'Início': '2026-12-10' })])
  assert.match(reversed.errors.join(' '), /prazo anterior/)
})

test('permite inferir período do plano e alerta sobre tarefas sem prazo', () => {
  const project = projectRows.map(row => row.slice())
  project[3][1] = ''
  project[4][1] = ''
  const result = parse([task('Começar', '2026-12-04', '', { 'Início': '2026-12-01' }),
    task('Sem prazo', '')], project)
  assert.deepEqual(result.errors, [])
  assert.equal(result.plan.startDate, '2026-12-01')
  assert.equal(result.plan.dueDate, '2026-12-04')
  assert.ok(result.warnings.some(message => message.includes('sem prazo')))
})

test('rejeita fórmulas, abas e cabeçalhos fora do padrão', () => {
  const formulaBook = workbook([task('Tarefa', '2026-12-01')])
  formulaBook.Sheets.Demandas.A2 = { f: 'HYPERLINK("https://example.invalid")' }
  assert.match(parseProjectWorkbook(formulaBook, mockXLSX).errors.join(' '), /fórmulas/)
  assert.match(parseProjectWorkbook({ Sheets: {} }, mockXLSX).errors.join(' '), /precisa ter/)
})
