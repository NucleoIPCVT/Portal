import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { teamMetadataTask,parseTeamMetadata } from '../planner-team-icons.js'
import {
  nextRecurringTask,setTaskRecurrence,taskRecurrence,rotationConfigId,
  rotationConfigRecord,parseRotationConfig,recurrenceOccurrenceAt,scheduledUpcomingDates
} from '../planner-recurrence.js'

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
    createGoogleLogin: () => async () => {},
    nextRecurringTask,taskRecurrence,rotationConfigId,rotationConfigRecord,
    parseRotationConfig,recurrenceOccurrenceAt,scheduledUpcomingDates,
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


test('rotating scheduled tasks preserve the chosen person and do not wait for completion', async () => {
  const {store,records,original}=await fixture()
  const people=['João','Liliane','Lucas'].map(name=>({name,email:''}))
  const current={...original,assignees:[people[0]],status:'todo'}
  await store.save('tasks',current,{expectedVersion:1,
    rotationConfig:{mode:'individual',advance:'scheduled',people,groups:[0,1,2]}})
  for(let attempt=0;attempt<50&&records.size<6;attempt++)
    await new Promise(resolve=>setTimeout(resolve,0))
  const config=[...records.values()].find(record=>record.templateKey?.startsWith('rotation-v1:'))
  assert.ok(config,'series configuration should be persisted')
  assert.equal(config.deleted,true)
  const future=[...records.values()].filter(record=>record.sourceTaskId===original.id && !record.deleted)
    .sort((a,b)=>a.dueDate.localeCompare(b.dueDate))
  assert.equal(future.length,4)
  const indexes=future.map(item=>item.assignees[0]?.name)
  assert.equal(new Set(indexes).size,3,'the three people should alternate')
  assert.equal(records.get(path('tasks',original.id)).status,'todo')
  assert.equal(records.size,6,'original, hidden config and four future occurrences')
})


test('a migração de Rotinas não duplica ocorrências antigas já programadas',async()=>{
  const {store,records,original}=await fixture()
  const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',
    year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  const upcoming=scheduledUpcomingDates(original,day,4)
  assert.ok(upcoming.length>=2)
  const first=upcoming[0]
  const date=new Date(first+'T12:00:00Z')
  date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7))
  const cycleKey=date.toISOString().slice(0,10)
  const routineId='weekly-before-migration'
  const legacyId='routine_'+routineId+'_'+cycleKey
  const older={
    ...original,id:legacyId,version:undefined,recurrenceId:'',
    sourceTaskId:'',routineId,cycleKey,dueDate:first,status:'todo'
  }
  delete older.version
  await store.save('tasks',older)
  await store.save('tasks',{...original,routineId},{
    expectedVersion:1,rotationConfig:{
      mode:'fixed',advance:'scheduled',people:[],groups:[]
    }
  })
  for(let attempt=0;attempt<50;attempt++){
    const repeated=[...records.keys()].filter(key=>key.includes('repeat_original_'))
    if(repeated.length>=upcoming.length-1)break
    await new Promise(resolve=>setTimeout(resolve,0))
  }
  assert.ok(records.has(path('tasks',legacyId)))
  assert.equal(records.has(path('tasks','repeat_original_'+first)),false,
    'ocorrência legada não pode reaparecer com um segundo ID')
  const regular=[...records.keys()].filter(key=>key.includes('repeat_original_'))
  assert.equal(regular.length,upcoming.length-1)
})


test('a equipe cadastrada persiste no Firebase existente sem virar uma demanda',async()=>{
  const {store,records}=await fixture()
  const id='team_meta_v1_'+'a'.repeat(64)
  const icon={type:'preset',value:'music'}
  const record=teamMetadataTask('Equipe de fotografia',icon,'p1',id)
  const saved=await store.save('tasks',record)
  assert.equal(saved.version,1)
  const raw=records.get(path('tasks',id))
  assert.equal(raw.deleted,true)
  assert.equal(raw.team,'Equipe de fotografia')
  assert.deepEqual(parseTeamMetadata({...raw,id}).icon,icon)
  assert.equal(records.size,2,'a equipe não gera ocorrências de demanda')

  const edited=teamMetadataTask('Equipe de fotografia',
    {type:'preset',value:'screen'},'p1',id,{...raw,id})
  const result=await store.save('tasks',edited,{expectedVersion:1})
  assert.equal(result.version,2)
  assert.equal(records.size,2)
  assert.equal(parseTeamMetadata({...records.get(path('tasks',id)),id}).icon.value,'screen')
})
