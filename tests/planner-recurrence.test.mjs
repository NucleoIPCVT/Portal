import test from 'node:test'
import assert from 'node:assert/strict'
import { taskRecurrence, setTaskRecurrence, recurrenceLabel, nextRecurrenceDate, nextRecurringTask } from '../planner-recurrence.js'

const task = values => ({
  id: 'original', title: 'Organizar os arquivos', planId: 'p1', bucketId: 'files',
  dueDate: '2026-11-12', startDate: '', status: 'todo', dateMode: 'manual',
  priority: 'high', description: 'Conferir o backup', team: 'Administrativo',
  assignees: [{ name: 'Ana', email: 'ana@example.test' }],
  checklist: [{ id: 'c1', text: 'Fazer backup', done: true }], dependencyIds: ['d1'],
  eventId: '', ...values
})
const repeating = (values, interval = 1, unit = 'day') => setTaskRecurrence(task(values), { interval, unit })

test('daily, weekly, fortnightly and monthly rules accept custom intervals', () => {
  for (const [interval, unit, expected] of [[1, 'day', '2026-11-13'], [15, 'day', '2026-11-27'], [1, 'week', '2026-11-19'], [2, 'week', '2026-11-26'], [1, 'month', '2026-12-12'], [3, 'month', '2027-02-12']]) {
    const item = repeating({}, interval, unit)
    assert.equal(nextRecurrenceDate(item), expected)
    assert.equal(taskRecurrence(item).interval, interval)
    assert.ok(item.recurrenceId.length <= 200)
  }
  assert.equal(recurrenceLabel(repeating({}, 1, 'month')), 'A cada 1 mês')
  assert.equal(recurrenceLabel(repeating({}, 2, 'week')), 'A cada 2 semanas')
})

test('month ends preserve the original day through February and leap years', () => {
  for (const [start, february] of [['2027-01-31', '2027-02-28'], ['2028-01-31', '2028-02-29']]) {
    const first = repeating({ dueDate: start, status: 'done' }, 1, 'month')
    const second = nextRecurringTask(first)
    assert.equal(second.dueDate, february)
    const third = nextRecurringTask({ ...second, status: 'done' })
    assert.equal(third.dueDate, start.slice(0, 4) + '-03-31')
    assert.equal(taskRecurrence(third).anchor, start)
  }
  const leapDay = repeating({ dueDate: '2028-02-29', status: 'done' }, 12, 'month')
  assert.equal(nextRecurrenceDate(leapDay), '2029-02-28')
})

test('saving and editing later occurrences retains the monthly calendar anchor', () => {
  const first = repeating({ dueDate: '2027-01-31', status: 'done' }, 1, 'month')
  const second = nextRecurringTask(first)
  const saved = setTaskRecurrence({ ...second, title: 'Outro título' }, { interval: 1, unit: 'month' })
  assert.equal(saved.recurrenceId, first.recurrenceId)
  assert.equal(nextRecurrenceDate(saved), '2027-03-31')
  assert.equal(taskRecurrence(setTaskRecurrence(saved, { interval: 2, unit: 'week' })).anchor, '2027-02-28')
})

test('each occurrence resets completion and checklist while preserving its plan and content', () => {
  const source = repeating({ status: 'done', startDate: '2026-11-10', bucketId: 'done' })
  const next = nextRecurringTask(source, [{ id: 'done', planId: 'p1', name: 'Concluído' }, { id: 'todo', planId: 'p1', name: 'A fazer' }])
  assert.equal(next.planId, 'p1')
  assert.equal(next.bucketId, 'todo')
  assert.equal(next.status, 'todo')
  assert.equal(next.startDate, '2026-11-11')
  assert.equal(next.dueDate, '2026-11-13')
  assert.equal(next.checklist[0].done, false)
  assert.equal(source.checklist[0].done, true)
  assert.deepEqual(next.assignees, source.assignees)
  assert.notEqual(next.assignees[0], source.assignees[0])
  assert.deepEqual(next.dependencyIds, source.dependencyIds)
  assert.equal(next.sourceTaskId, source.id)
  assert.equal(next.cycleKey, next.dueDate)
  assert.equal(next.version, undefined)
  assert.equal(nextRecurringTask({ ...next, status: 'done' }).sourceTaskId, source.id)
})

test('occurrence identities are stable when completing twice or after reopening', () => {
  const original = repeating({ status: 'done' })
  assert.equal(nextRecurringTask(original).id, nextRecurringTask({ ...original, title: 'Editada' }).id)
  assert.equal(nextRecurringTask({ ...original, status: 'todo' }), null)
  assert.equal(nextRecurringTask({ ...original, deleted: true }), null)
  assert.equal(nextRecurringTask(setTaskRecurrence(original, null)), null)
  assert.equal(taskRecurrence(task()), null)
  assert.equal(nextRecurringTask(task({ status: 'done' })), null)
})

test('custom buckets and missing start dates remain unchanged in the next occurrence', () => {
  const original = repeating({ status: 'done' })
  const next = nextRecurringTask(original, [{ id: 'files', planId: 'p1', name: 'Arquivos' }])
  assert.equal(next.bucketId, 'files')
  assert.equal(next.startDate, '')
})

test('invalid dates, fractional or non-positive intervals and unknown units are rejected', () => {
  for (const interval of [0, -1, 1.5, NaN, Infinity, 1000]) assert.throws(() => repeating({}, interval))
  assert.throws(() => repeating({}, 1, 'year'))
  for (const dueDate of ['', '2026-02-30', '2026-13-01']) assert.throws(() => repeating({ dueDate }))
  assert.throws(() => repeating({ dateMode: 'event' }))
  for (const recurrenceId of ['weekly', 'repeat-v1:%E0%A4%A:day:1:2026-11-12', 'repeat-v1:a:day:0:2026-11-12', 'repeat-v1:a:month:1:2026-02-30']) assert.equal(taskRecurrence({ recurrenceId }), null)
})

test('day arithmetic handles daylight saving and year boundaries without time drift', () => {
  assert.equal(nextRecurrenceDate(repeating({ dueDate: '2018-11-03' })), '2018-11-04')
  assert.equal(nextRecurrenceDate(repeating({ dueDate: '2026-12-31' })), '2027-01-01')
  const moved = { ...repeating({}, 2, 'week'), dueDate: '2026-11-27' }
  assert.equal(nextRecurrenceDate(moved), '2026-12-10')
})
