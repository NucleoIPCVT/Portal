import test from 'node:test';
import assert from 'node:assert/strict';
import {
  todayISO, addDays, formatDate, calendarCells, computeSummary, validateTask,
  isOverdue, taskProgress, generateWeeklyTasks, eventPreparationTasks,
} from '../planner-core.js';

const task = (values = {}) => ({
  id: 'task-1', planId: 'plan-1', bucketId: 'bucket-1', title: 'Preparar entrega',
  startDate: '', dueDate: '', status: 'todo', priority: 'normal', team: 'Música',
  assignees: [], checklist: [], dependencyIds: [], ...values,
});
const routine = (values = {}) => ({
  id: 'weekly-liturgia', planId: 'plan-1', bucketId: 'bucket-1', title: 'Revisar liturgia',
  description: 'Rotina independente', team: 'Liturgia', assignees: [{ email: 'test@example.com', name: 'Pessoa' }],
  weekday: 1, priority: 'high', active: true, ...values,
});

test('civil dates handle leap years, DST dates, month and year boundaries', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2025-02-28', 1), '2025-03-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2018-11-03', 1), '2018-11-04');
  assert.equal(addDays('2018-11-04', 1), '2018-11-05');
  assert.equal(addDays('2026-02-30', 1), '');
  assert.equal(addDays('2026-13-01', 1), '');
  assert.equal(addDays('2026-01-01', 0.5), '');
  assert.equal(formatDate('2026-11-15'), '15/11/2026');
  assert.equal(formatDate('2026-02-29'), '—');
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
});

test('calendar has 42 consecutive Monday-through-Sunday cells, including leap day', () => {
  const dates = calendarCells('2024-02');
  assert.equal(dates.length, 42);
  assert.equal(dates[0], '2024-01-29');
  assert.equal(dates.at(-1), '2024-03-10');
  assert.ok(dates.includes('2024-02-29'));
  assert.equal(calendarCells('2026-06')[0], '2026-06-01');
  assert.deepEqual(calendarCells('2026-13'), []);
  for (let i = 1; i < dates.length; i++) assert.equal(dates[i], addDays(dates[i - 1], 1));
});

test('today uses the São Paulo civil day even when the UTC host has advanced to tomorrow', () => {
  const OriginalDate = globalThis.Date;
  globalThis.Date = class extends OriginalDate {
    constructor(...args) {
      super(...(args.length ? args : ['2026-11-07T01:00:00.000Z']));
    }
  };
  try {
    assert.equal(todayISO(), '2026-11-06');
  } finally {
    globalThis.Date = OriginalDate;
  }
});

test('task validation rejects missing titles, impossible dates and reversed ranges', () => {
  assert.deepEqual(validateTask(task()), []);
  assert.match(validateTask(task({ title: '  ' })).join(' '), /título/);
  assert.match(validateTask(task({ startDate: '2026-02-30' })).join(' '), /inválida/);
  assert.match(validateTask(task({ dueDate: '2026-11-1' })).join(' '), /inválida/);
  assert.match(validateTask(task({ startDate: '2026-11-10', dueDate: '2026-11-09' })).join(' '), /anterior/);
  assert.deepEqual(validateTask(task({ startDate: '2026-11-10', dueDate: '2026-11-10' })), []);
});

test('dependency validation rejects self references, missing tasks and indirect cycles when editing', () => {
  const a = task({ id: 'a', dependencyIds: [] });
  const b = task({ id: 'b', dependencyIds: ['a'] });
  const c = task({ id: 'c', dependencyIds: ['b'] });
  assert.deepEqual(validateTask(c, [a, b, c]), []);
  assert.match(validateTask({ ...a, dependencyIds: ['a'] }, [a]).join(' '), /dela mesma/);
  assert.match(validateTask({ ...a, dependencyIds: ['unknown'] }, [a]).join(' '), /não foi encontrada/);
  assert.match(validateTask({ ...a, dependencyIds: ['c'] }, [a, b, c]).join(' '), /ciclo/);
  assert.deepEqual(validateTask(task({ id: 'unrelated' }), [
    task({ id: 'broken-1', dependencyIds: ['broken-2'] }),
    task({ id: 'broken-2', dependencyIds: ['broken-1'] }),
  ]), []);
});

test('overdue and summary keep completed and undated tasks out of late/upcoming counts', () => {
  const tasks = [
    task({ id: 'a', dueDate: '2026-11-05', assignees: [{ email: 'a@example.com' }], priority: 'urgent' }),
    task({ id: 'b', dueDate: '2026-11-06', status: 'doing', priority: 'high' }),
    task({ id: 'c', dueDate: '2026-11-13', status: 'done', team: 'Técnica' }),
    task({ id: 'd', dueDate: '2026-11-13', team: 'Técnica' }),
    task({ id: 'e', dueDate: '2026-11-14', team: '' }),
    task({ id: 'f', dueDate: '', status: 'done', team: '' }),
  ];
  const summary = computeSummary(tasks, '2026-11-06');
  assert.deepEqual({ total: summary.total, todo: summary.todo, doing: summary.doing, done: summary.done },
    { total: 6, todo: 3, doing: 1, done: 2 });
  assert.equal(summary.overdue, 1);
  assert.equal(summary.dueSoon, 2);
  assert.equal(summary.unassigned, 5);
  assert.equal(summary.completionRate, 33);
  assert.deepEqual(summary.byTeam.Música, { total: 2, todo: 1, doing: 1, done: 0, overdue: 1 });
  assert.equal(summary.byTeam['Sem equipe'].total, 2);
  assert.equal(summary.byPriority.urgent, 1);
  assert.equal(isOverdue(task({ dueDate: '2026-11-05', status: 'done' }), '2026-11-06'), false);
  assert.equal(isOverdue(task({ dueDate: '2026-11-06' }), '2026-11-06'), false);
  assert.equal(isOverdue(task({ dueDate: '2026-02-30' }), '2026-11-06'), false);
  assert.equal(computeSummary([], '2026-11-06').completionRate, 0);
  const special = computeSummary([task({ team: '__proto__' })], '2026-11-06');
  assert.equal(special.byTeam.__proto__.total, 1);
  assert.equal(Object.getPrototypeOf(special.byTeam), Object.prototype);
});

test('task progress respects completion and otherwise summarizes checklist work', () => {
  assert.equal(taskProgress(task()), 0);
  assert.equal(taskProgress(task({ status: 'doing' })), 50);
  assert.equal(taskProgress(task({ checklist: [{ done: true }, { done: false }, { done: false }] })), 33);
  assert.equal(taskProgress(task({ status: 'done', checklist: [{ done: false }] })), 100);
});

test('weekly generation respects weekday, date window and routine start date', () => {
  const input = routine({ startDate: '2026-11-10' });
  const tasks = generateWeeklyTasks(input, '2026-11-01', '2026-11-30', []);
  assert.deepEqual(tasks.map(item => item.dueDate), ['2026-11-16', '2026-11-23', '2026-11-30']);
  assert.ok(tasks.every(item => item.status === 'todo' && item.routineId === input.id && item.cycleKey === item.dueDate));
  tasks[0].assignees[0].name = 'Alterado';
  assert.equal(input.assignees[0].name, 'Pessoa');
  assert.equal(tasks[1].assignees[0].name, 'Pessoa');
  assert.deepEqual(generateWeeklyTasks(routine({ active: false }), '2026-11-01', '2026-11-30'), []);
  assert.deepEqual(generateWeeklyTasks(routine({ startDate: '2027-01-01' }), '2026-11-01', '2026-11-30'), []);
  assert.deepEqual(generateWeeklyTasks(routine({ weekday: 0 }), '2026-11-01', '2026-11-08').map(item => item.dueDate),
    ['2026-11-01', '2026-11-08']);
});

test('weekly generation is stable and deduplicates by identity even after task edits', () => {
  const input = routine();
  const first = generateWeeklyTasks(input, '2026-11-01', '2026-11-30');
  assert.deepEqual(first.map(item => item.id), generateWeeklyTasks(input, '2026-11-01', '2026-11-30').map(item => item.id));
  const changed = first.map(item => ({ ...item, id: `migrated-${item.id}`, title: 'Título editado', dueDate: '2026-12-01', status: 'done' }));
  const snapshot = structuredClone(changed);
  assert.deepEqual(generateWeeklyTasks(input, '2026-11-01', '2026-11-30', changed), []);
  assert.deepEqual(changed, snapshot);
  assert.deepEqual(generateWeeklyTasks(input, '2026-11-01', '2026-11-30', first), []);
  assert.equal(generateWeeklyTasks(input, '2026-11-23', '2026-12-14', first).length, 2);
  assert.equal(generateWeeklyTasks(input, '2026-11-01', '2026-11-30', [task({ title: input.title })]).length, 5);
  const anotherRoutine = generateWeeklyTasks(routine({ id: 'another-routine' }), '2026-11-01', '2026-11-30', first);
  assert.equal(anotherRoutine.length, 5);
  assert.ok(anotherRoutine.every(item => !first.some(existing => existing.id === item.id)));
});

test('weekly generation rejects invalid and oversized intervals', () => {
  assert.throws(() => generateWeeklyTasks(routine(), '2026-02-30', '2026-03-01'), RangeError);
  assert.throws(() => generateWeeklyTasks(routine(), '2026-11-30', '2026-11-01'), RangeError);
  assert.throws(() => generateWeeklyTasks(routine(), '2026-01-01', '2027-01-02'), /366/);
  assert.throws(() => generateWeeklyTasks(routine({ weekday: 7 }), '2026-11-01', '2026-11-30'), RangeError);
  assert.doesNotThrow(() => generateWeeklyTasks(routine(), '2024-01-01', '2024-12-31'));
});

test('editing a routine weekday preserves existing weeks rather than creating a second task that week', () => {
  const monday = routine({ weekday: 1 });
  const tasks = generateWeeklyTasks(monday, '2026-11-06', '2026-12-03');
  const snapshot = structuredClone(tasks);
  const tuesday = { ...monday, weekday: 2 };
  assert.deepEqual(generateWeeklyTasks(tuesday, '2026-11-06', '2026-12-03', tasks), []);
  assert.deepEqual(tasks, snapshot);
  const next = generateWeeklyTasks(tuesday, '2026-12-01', '2026-12-08', tasks);
  assert.equal(next.length, 1);
  assert.equal(next[0].dueDate, '2026-12-08');
  assert.equal(next[0].cycleKey, '2026-12-07');
  assert.ok(next[0].id.endsWith('_2026-12-07'));
  const legacy = [task({ id: 'legacy', routineId: monday.id, cycleKey: '2026-11-11', dueDate: '2026-11-11' })];
  assert.deepEqual(generateWeeklyTasks(tuesday, '2026-11-10', '2026-11-10', legacy), []);
  const noCycleKey = [task({ id: 'migrated', routineId: monday.id, dueDate: '2026-11-12' })];
  assert.deepEqual(generateWeeklyTasks(tuesday, '2026-11-10', '2026-11-10', noCycleKey), []);
});

test('event preparation creates four offset tasks with stable template identities and buckets', () => {
  const event = { id: 'culto/2026-11-15', title: 'Culto de domingo', startDate: '2026-11-15', status: 'confirmed' };
  const buckets = { Música: 'music', Liturgia: 'liturgy', Técnica: 'technical' };
  const tasks = eventPreparationTasks(event, 'cultos', buckets, []);
  assert.equal(tasks.length, 4);
  assert.deepEqual(tasks.map(item => item.dueDate), ['2026-11-08', '2026-11-10', '2026-11-12', '2026-11-14']);
  assert.deepEqual(tasks.map(item => item.bucketId), ['music', 'music', 'liturgy', 'technical']);
  assert.ok(tasks.every(item => item.eventId === event.id && item.dateMode === 'event' && !item.id.includes('/')));
  assert.deepEqual(eventPreparationTasks(event, 'cultos', buckets, tasks), []);
  const changed = tasks.map(item => ({ ...item, id: `migration-${item.id}`, title: 'Entrega renomeada', status: 'done' }));
  const snapshot = structuredClone(changed);
  assert.deepEqual(eventPreparationTasks({ ...event, startDate: '2026-11-22' }, 'cultos', buckets, changed), []);
  assert.deepEqual(changed, snapshot);
  assert.equal(eventPreparationTasks(event, 'cultos', buckets, [task({ title: 'Selecionar banda' })]).length, 4);
  const secondService = eventPreparationTasks({ ...event, id: 'culto-noturno' }, 'cultos', buckets, tasks);
  assert.equal(secondService.length, 4);
  assert.ok(secondService.every(item => !tasks.some(existing => existing.id === item.id)));
  assert.deepEqual(eventPreparationTasks({ ...event, status: 'cancelled' }, 'cultos', buckets, []), []);
});
