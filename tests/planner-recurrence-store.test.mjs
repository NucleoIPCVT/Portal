import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { nextRecurringTask, setTaskRecurrence } from '../planner-recurrence.js'

// Exercise the production store and its version checks with an isolated,
// transactional Firebase adapter. No credentials or live data are involved.
const source = (await readFile(new URL('../planner-store.js', import.meta.url), 'utf8'))
  .replace(/^import\s+[\s\S]*?\sfrom\s+['"][^'"]+['"]\r?\n/gm, '')
  .replace('export function createPlannerStore', 'function createPlannerStore')
const path = (kind, id) => 'comissao_planner/main/' + kind + '/' + id
const copy = value => structuredClone(value)

async function fixture({ failCommit = false } = {}) {
  const original = setTaskRecurrence({
    id: 'original', planId: 'p1', bucketId: 'todo', title: 'Conferir arquivos',
    description: '', team: '', assignees: [], startDate: '', dueDate: '2026-11-12',
    status: 'todo', priority: 'normal', checklist: [], dependencyIds: [],
    eventId: '', dateMode: 'manual', dueOffsetDays: null, deleted: false,
    version: 1, createdBy: 'person@example.test', createdAt: 'created'
  }, { interval: 2, unit: 'week' })
  const records = new Map([[path('tasks', original.id), copy(original)]])
  const listeners = []
  let releasePrevious = Promise.resolve()
  const user = { uid: 'uid', email: 'person@example.test', emailVerified: true,
    getIdTokenResult: async () => ({ claims: { firebase: { sign_in_provider: 'google.com' }, email_verified: true } }) }
  const auth = { currentUser: user }
  const snapshot = ref => ({ exists: () => records.has(ref.path), data: () => copy(records.get(ref.path)) })
  const emit = () => {
    for (const [ref, callback] of listeners) {
      const prefix = ref.path + '/'
      callback({ docs: [...records].filter(([key]) => key.startsWith(prefix)).map(([key, data]) => ({ id: key.slice(prefix.length), data: () => copy(data) })) })
    }
  }
  const dependencies = {
    initializeApp: () => ({ name: 'ipcvt-comissao' }), getApps: () => [],
    getAuth: () => auth, GoogleAuthProvider: {}, signInWithCredential() {},
    reauthenticateWithPopup() {}, signInWithPopup() {}, signOut() {},
    createGoogleLogin: () => async () => {}, nextRecurringTask,
    onAuthStateChanged: (_, callback) => { queueMicrotask(() => callback(user)); return () => {} },
    getFirestore: () => ({}), serverTimestamp: () => 'timestamp', setDoc() {},
    doc: (_, ...parts) => ({ path: parts.join('/') }),
    collection: (_, ...parts) => ({ path: parts.join('/'), collection: true }),
    onSnapshot(ref, callback) {
      if (ref.collection) { listeners.push([ref, callback]); emit() }
      else if (ref.path.startsWith('comissao_acessos/')) callback({ exists: () => true, data: () => ({ ativo: true, perfil: 'admin' }) })
      else callback({ exists: () => false })
      return () => {}
    },
    async runTransaction(_, work) {
      const previous = releasePrevious
      let release
      releasePrevious = new Promise(resolve => { release = resolve })
      await previous
      const writes = []
      let writing = false
      try {
        const result = await work({
          async get(ref) { assert.equal(writing, false, 'all reads must precede writes'); return snapshot(ref) },
          set(ref, item) { writing = true; writes.push([ref.path, copy(item)]) },
          delete(ref) { writing = true; writes.push([ref.path, null]) }
        })
        if (failCommit) throw Object.assign(new Error('offline'), { code: 'unavailable' })
        for (const [key, value] of writes) {
          if (value) records.set(key, value)
          else records.delete(key)
        }
        emit()
        return result
      } finally { release() }
    }
  }
  const createStore = new Function(...Object.keys(dependencies), source + '\nreturn createPlannerStore;')(...Object.values(dependencies))
  let authorized
  const ready = new Promise(resolve => { authorized = resolve })
  const store = createStore({ onSession(next) { if (next.status === 'authorized') authorized() } })
  await ready
  return { store, records, original }
}

test('concurrent completions create exactly one next occurrence and preserve version checks', async () => {
  const { store, records, original } = await fixture()
  const results = await Promise.allSettled([
    store.save('tasks', { ...original, status: 'done' }, { expectedVersion: 1 }),
    store.save('tasks', { ...original, status: 'done' }, { expectedVersion: 1 })
  ])
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1)
  assert.equal(results.find(item => item.status === 'rejected').reason.code, 'conflict')
  assert.equal(records.size, 2)
  const next = [...records.values()].find(item => item.sourceTaskId === original.id)
  assert.equal(next.dueDate, '2026-11-26')
  assert.equal(next.status, 'todo')
  assert.equal(next.version, 1)
  assert.equal(records.get(path('tasks', original.id)).status, 'done')
})

test('failed commits leave both the original and its next occurrence unchanged', async () => {
  const { store, records, original } = await fixture({ failCommit: true })
  await assert.rejects(() => store.save('tasks', { ...original, status: 'done' }, { expectedVersion: 1 }), { code: 'unavailable' })
  assert.equal(records.size, 1)
  assert.equal(records.get(path('tasks', original.id)).status, 'todo')
  assert.equal(records.get(path('tasks', original.id)).version, 1)
})

test('reopening, recompleting and editing history do not overwrite or duplicate the next occurrence', async () => {
  const { store, records, original } = await fixture()
  const completed = await store.save('tasks', { ...original, status: 'done' }, { expectedVersion: 1 })
  const reopened = await store.save('tasks', { ...completed, status: 'todo' }, { expectedVersion: 2 })
  const recompleted = await store.save('tasks', { ...reopened, status: 'done' }, { expectedVersion: 3 })
  await store.save('tasks', { ...recompleted, dueDate: '2026-12-01' }, { expectedVersion: 4 })
  assert.equal(records.size, 2)
  const next = [...records.values()].find(item => item.sourceTaskId === original.id)
  assert.equal(next.dueDate, '2026-11-26')
  assert.equal(next.version, 1)
})

test('stopping recurrence on a pending demand prevents generation on completion', async () => {
  const { store, records, original } = await fixture()
  await store.save('tasks', setTaskRecurrence({ ...original, status: 'done' }, null), { expectedVersion: 1 })
  assert.equal(records.size, 1)
  assert.equal(records.get(path('tasks', original.id)).status, 'done')
})
