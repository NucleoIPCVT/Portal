import test from 'node:test'
import assert from 'node:assert/strict'
import { taskCreationContext } from '../planner-task-context.js'

const plans = [{ id: 'general' }, { id: 'christmas' }, { id: 'archived', deleted: true }]
const buckets = [{ id: 'music', planId: 'christmas', order: 1 }, { id: 'planning', planId: 'christmas', order: 0 }]
const tasks = [{ id: 'existing', planId: 'christmas', eventId: 'christmas-event' }]
const data = { plans, buckets, tasks, eventId: 'christmas-event' }

test('new task inherits the event and its work plan from the filtered board', () => {
  assert.deepEqual(taskCreationContext(data), { planId: 'christmas', bucketId: 'planning', eventId: 'christmas-event' })
})
test('column creation keeps the clicked plan and bucket and inherits the event', () => {
  assert.deepEqual(taskCreationContext({ ...data, defaults: { planId: 'christmas', bucketId: 'music' } }),
    { planId: 'christmas', bucketId: 'music', eventId: 'christmas-event' })
})
test('explicit independent creation overrides an active event filter', () => {
  assert.equal(taskCreationContext({ ...data, defaults: { eventId: '' } }).eventId, '')
  assert.equal(taskCreationContext({ ...data, eventId: '__independent__' }).eventId, '')
})
test('explicit event and selected plan override inferred context', () => {
  const result = taskCreationContext({ ...data, planId: 'general', defaults: { eventId: 'other-event', dueDate: '2026-12-01' } })
  assert.equal(result.planId, 'general')
  assert.equal(result.eventId, 'other-event')
  assert.equal(result.dueDate, '2026-12-01')
})
test('empty bucket is preserved and archived plans are never inferred', () => {
  assert.equal(taskCreationContext({ ...data, defaults: { bucketId: '' } }).bucketId, '')
  assert.equal(taskCreationContext({ ...data, tasks: [{ planId: 'archived', eventId: 'christmas-event' }] }).planId, 'general')
})
test('an empty workspace has a safe context without inventing a plan', () => {
  assert.deepEqual(taskCreationContext({ eventId: 'christmas-event' }), { planId: '', bucketId: '', eventId: 'christmas-event' })
})
