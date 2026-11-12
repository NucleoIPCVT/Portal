import test from 'node:test'
import assert from 'node:assert/strict'
import { groupBoardTasks, moveBoardTask } from '../planner-board.js'

const plans = [{ id: 'p1', name: 'Cultos' }, { id: 'p2', name: 'Cantata' }, { id: 'old', name: 'Arquivado', deleted: true }]
const buckets = [{ id: 'a', planId: 'p1', name: 'A fazer', order: 0 }, { id: 'r', planId: 'p1', name: 'Em Revisão', order: 1 }, { id: 'b', planId: 'p2', name: 'A fazer', order: 0 }]
const ana = { name: 'Ana', email: 'ana@example.test' }, hudson = { name: 'Hudson', email: 'hudson@example.test' }
const tasks = [
  { id: 't1', title: 'Liturgia', planId: 'p1', bucketId: 'a', status: 'todo', priority: 'high', eventId: 'e1', team: 'Litúrgico', assignees: [ana, hudson], dueDate: '2026-11-15', dateMode: 'manual', dependencyIds: [] },
  { id: 't2', title: 'Revisão', planId: 'p1', bucketId: 'r', status: 'doing', priority: 'normal', assignees: [] },
  { id: 't3', title: 'Música', planId: 'p2', status: 'done', priority: 'low', assignees: [hudson] }
]
const context = { plans, buckets, tasks, events: [{ id: 'e1', title: 'Culto' }] }

test('agrupamentos preservam o plano e reúnem todas as demandas, inclusive sem vínculo', () => {
  for (const grouping of ['status', 'plan', 'event', 'team', 'priority', 'bucket']) {
    const groups = groupBoardTasks({ ...context, grouping })
    assert.deepEqual(groups.flatMap(group => group.tasks.map(task => task.id)).sort(), ['t1', 't2', 't3'])
  }
  const groups = groupBoardTasks({ ...context, grouping: 'status' })
  assert.deepEqual(groups.find(group => group.id === 'review').tasks.map(task => task.id), ['t2'])
  assert.equal(groups.find(group => group.id === 'doing').tasks.length, 0)
  assert.ok(!groupBoardTasks({ ...context, grouping: 'plan' }).some(group => group.id === 'old'))
})

test('uma demanda com dois responsáveis aparece nas duas colunas sem duplicação na mesma pessoa', () => {
  const groups = groupBoardTasks({ ...context, grouping: 'assignee' })
  assert.deepEqual(groups.find(group => group.id === hudson.email).tasks.map(task => task.id), ['t1', 't3'])
  assert.deepEqual(groups.find(group => group.id === ana.email).tasks.map(task => task.id), ['t1'])
  assert.deepEqual(groups.find(group => group.id === '').tasks.map(task => task.id), ['t2'])
})

test('criar em uma coluna herda seu plano, evento ou responsável', () => {
  assert.equal(groupBoardTasks({ ...context, grouping: 'plan' }).find(group => group.id === 'p2').defaults.planId, 'p2')
  assert.equal(groupBoardTasks({ ...context, grouping: 'event' })[0].defaults.eventId, 'e1')
  assert.deepEqual(groupBoardTasks({ ...context, grouping: 'assignee' }).find(group => group.id === ana.email).defaults.assignees, [ana])
  assert.equal(groupBoardTasks({ ...context, grouping: 'bucket' }).find(group => group.id === 'b').defaults.planId, 'p2')
})

test('mover entre planos remapeia a etapa e preserva prazo, responsáveis e evento', () => {
  const moved = moveBoardTask(tasks[0], 'plan', { id: 'p2' }, context)
  assert.equal(moved.planId, 'p2')
  assert.equal(moved.bucketId, 'b')
  for (const key of ['dueDate', 'assignees', 'eventId', 'status']) assert.deepEqual(moved[key], tasks[0][key])
  assert.equal(tasks[0].planId, 'p1')
})

test('dependências não podem ficar entre planos e planos arquivados são recusados', () => {
  assert.throws(() => moveBoardTask({ ...tasks[0], dependencyIds: ['t2'] }, 'plan', { id: 'p2' }, context), /dependências/)
  assert.throws(() => moveBoardTask(tasks[0], 'plan', { id: 'p2' }, { ...context, tasks: [{ id: 't2', dependencyIds: ['t1'] }] }), /dependências/)
  assert.throws(() => moveBoardTask(tasks[0], 'plan', { id: 'old' }, context), /não está mais disponível/)
})

test('mover responsabilidade preserva as outras pessoas e elimina duplicatas', () => {
  const target = { id: hudson.email, defaults: { assignees: [hudson] } }
  const moved = moveBoardTask(tasks[0], 'assignee', target, { ...context, fromGroup: ana.email })
  assert.deepEqual(moved.assignees, [hudson])
  assert.deepEqual(moveBoardTask(tasks[0], 'assignee', { id: '' }, context).assignees, [])
})

test('mover por evento preserva datas e exige o editor para prazos relativos', () => {
  const moved = moveBoardTask(tasks[0], 'event', { id: '' }, context)
  assert.equal(moved.eventId, '')
  assert.equal(moved.dueDate, tasks[0].dueDate)
  assert.throws(() => moveBoardTask({ ...tasks[0], dateMode: 'event' }, 'event', { id: 'e2' }, context), /prazo relativo/)
})

test('mudar equipe ou prioridade mantém os demais vínculos e dados da demanda', () => {
  const priority = moveBoardTask(tasks[0], 'priority', { id: 'low' }, context)
  assert.deepEqual(priority, { ...tasks[0], priority: 'low' })
  const team = moveBoardTask(tasks[0], 'team', { id: '' }, context)
  assert.deepEqual(team, { ...tasks[0], team: '' })
})
