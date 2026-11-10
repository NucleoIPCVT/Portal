import test from 'node:test'
import assert from 'node:assert/strict'
import { addDays, eventPreparationTasks, validateTask } from '../planner-core.js'

const example = {
  id: 'a'.repeat(64),
  title: 'Cantata de Natal',
  startDate: '2026-12-20',
  status: 'confirmed'
}
const bucketIds = { Planejamento: 'bucket-planning', default: 'bucket-planning' }

test('modelo básico vincula as demandas ao evento oficial sem duplicar IDs', () => {
  const tasks = eventPreparationTasks(example, 'plan', bucketIds)
  assert.equal(tasks.length, 4)
  assert.ok(tasks.every(task => task.eventId === example.id && task.dateMode === 'event'))
  assert.ok(tasks.every(task => validateTask(task, []).length === 0))
  assert.equal(eventPreparationTasks(example, 'plan', bucketIds, tasks).length, 0)
})

test('modelo especial permite planejar eventos com quatro meses de antecedência', () => {
  const tasks = eventPreparationTasks(example, 'plan', bucketIds, [], 'special')
  assert.equal(tasks.length, 9)
  assert.equal(tasks[0].title, 'Definir proposta e programação do evento')
  assert.equal(tasks[0].dueDate, addDays(example.startDate, -120))
  assert.ok(tasks.every(task => task.dueDate === task.startDate))
  assert.ok(tasks.every(task => task.bucketId === 'bucket-planning'))
  assert.equal(eventPreparationTasks(example, 'plan', bucketIds, tasks, 'special').length, 0)
  assert.ok(tasks.every(task => task.dueOffsetDays <= -1 && task.dueOffsetDays >= -365))
})

test('mudança no Google altera o cálculo relativo, sem modificar a tarefa existente', () => {
  const tasks = eventPreparationTasks(example, 'plan', bucketIds, [], 'special')
  const changed = { ...example, startDate: '2026-12-22' }
  assert.equal(addDays(changed.startDate, tasks[0].dueOffsetDays), addDays(tasks[0].dueDate, 2))
  assert.equal(tasks[0].dueDate, addDays(example.startDate, -120))
})

test('eventos cancelados não geram demandas automaticamente', () => {
  assert.deepEqual(eventPreparationTasks({ ...example, status: 'cancelled' }, 'plan', bucketIds, [], 'special'), [])
})
