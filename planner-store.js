import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js'
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithCredential,
  reauthenticateWithPopup, signOut
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js'
import {
  getFirestore, collection, doc, onSnapshot, runTransaction, serverTimestamp, setDoc
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js'
import { createGoogleLogin } from './ipcvt-google-login.js?v=20261112-google-direto-02'
import { nextRecurringTask, taskRecurrence, rotationConfigId, rotationConfigRecord,
  parseRotationConfig, recurrenceOccurrenceAt, scheduledUpcomingDates
} from './planner-recurrence.js?v=20261113-unified-v1'
import {parsePlanCycleConfig,missingPlanCycleTasks} from './planner-plan-cycles.js?v=20261113-plan-cycle-v2'

const googleLogin = createGoogleLogin({
  getAccounts: () => window.google?.accounts,
  credentialFromAccessToken: token => GoogleAuthProvider.credential(null, token),
  signInWithCredential,
  fallback: auth => {
    const provider = new GoogleAuthProvider()
    provider.setCustomParameters({ prompt: 'select_account' })
    return signInWithPopup(auth, provider)
  }
})

const firebaseConfig = {
  apiKey: 'AIzaSyAg9w5QohkcmXUFRgLfSI5Sh1chnCD1Owc',
  authDomain: 'repertorio-ipcvt.firebaseapp.com',
  projectId: 'repertorio-ipcvt',
  storageBucket: 'repertorio-ipcvt.firebasestorage.app',
  messagingSenderId: '774659782213',
  appId: '1:774659782213:web:5e9cbf88fec30eb382152c'
}
const KINDS = ['plans', 'buckets', 'tasks', 'events', 'routines']
const FIELDS = {
  plans: ['name', 'kind', 'description', 'startDate', 'dueDate', 'deleted'],
  buckets: ['planId', 'name', 'order', 'deleted'],
  tasks: ['planId', 'bucketId', 'title', 'description', 'team', 'assignees', 'startDate', 'dueDate', 'status', 'priority', 'checklist', 'dependencyIds', 'eventId', 'dateMode', 'dueOffsetDays', 'startOffsetDays', 'routineId', 'cycleKey', 'templateKey', 'sourceTaskId', 'recurrenceId', 'recurrence', 'reviewRequired', 'reviewReason', 'deleted'],
  events: ['source', 'sourceCalendarId', 'sourceEventId', 'sourceKey', 'title', 'description', 'location', 'startDate', 'endDate', 'startAt', 'endAt', 'allDay', 'timeZone', 'status', 'htmlLink', 'calendarName', 'sourceUpdatedAt', 'recurringEventId', 'originalStartTime', 'deleted'],
  routines: ['planId', 'bucketId', 'title', 'description', 'team', 'assignees', 'weekday', 'priority', 'active', 'startDate', 'checklist']
}
const METADATA = ['id', 'version', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']
const DEFAULTS = {
  plans: { name: '', kind: 'continuous', description: '', startDate: '', dueDate: '', deleted: false },
  buckets: { planId: '', name: '', order: 0, deleted: false },
  tasks: { planId: '', bucketId: '', title: '', description: '', team: '', assignees: [], startDate: '', dueDate: '', status: 'todo', priority: 'normal', checklist: [], dependencyIds: [], eventId: '', dateMode: 'manual', dueOffsetDays: null, deleted: false },
  events: { source: 'manual', title: '', description: '', startDate: '', endDate: '', allDay: true, status: 'confirmed', deleted: false },
  routines: { planId: '', bucketId: '', title: '', description: '', team: '', assignees: [], weekday: 0, priority: 'normal', active: true, startDate: '' }
}

function error(message, code = 'planner-error') {
  return Object.assign(new Error(message), { code })
}

function readableError(cause) {
  if (cause?.code === 'conflict' || cause?.code?.startsWith('planner-')) return cause
  const messages = {
    'permission-denied': 'O acesso aos dados do Planner foi negado. Confira sua autorização e as regras do Firestore.',
    'unavailable': 'O Planner está sem conexão com o servidor. Tente salvar novamente quando a conexão voltar.',
    'auth/popup-closed-by-user': 'A janela do Google foi fechada antes de concluir o login. No tablet, tente abrir o Planner diretamente no Chrome e permitir pop-ups.',
    'auth/cancelled-popup-request': 'A janela anterior de login foi cancelada.',
    'auth/popup-blocked': 'O navegador bloqueou a janela do Google. Abra o Planner no Chrome ou Firefox, fora de outros aplicativos, e permita pop-ups.',
    'auth/operation-not-supported-in-this-environment': 'Este navegador não permite o login do Google. Abra o link diretamente no Chrome ou Firefox.',
    'auth/web-storage-unsupported': 'O armazenamento deste navegador está bloqueado. Use uma aba comum no Chrome ou Firefox, fora do modo anônimo.',
    'auth/unauthorized-domain': 'Este endereço precisa ser autorizado no Firebase Authentication.',
    'auth/operation-not-allowed': 'O login Google precisa ser habilitado no Firebase.',
    'auth/user-mismatch': 'Conecte a mesma conta Google usada para entrar na Comissão.',
    'auth/network-request-failed': 'Não foi possível acessar o Google. Confira sua conexão.'
  }
  return error(messages[cause?.code] || 'Não foi possível concluir a operação. Tente novamente.', cause?.code || 'planner-error')
}

function blankData() {
  return Object.fromEntries(KINDS.map(kind => [kind, []]))
}

function payloadFor(kind, item) {
  const allowed = FIELDS[kind]
  for (const key of Object.keys(item)) {
    if (!allowed.includes(key) && !METADATA.includes(key)) throw error('O registro contém um campo não reconhecido: ' + key, 'planner-invalid-field')
  }
  const fields = { ...DEFAULTS[kind] }
  for (const key of allowed) if (item[key] !== undefined) fields[key] = item[key]
  if (kind === 'tasks' || kind === 'routines') {
    const validPeople = Array.isArray(fields.assignees) && fields.assignees.length <= 10
      && fields.assignees.every(person => person && !Array.isArray(person)
        && Object.keys(person).every(key => ['email', 'name'].includes(key))
        && typeof person.email === 'string' && person.email.length <= 254
        && typeof person.name === 'string' && person.name.length <= 120
        && Boolean(person.email.trim() || person.name.trim()))
    if (!validPeople) throw error('Informe até 10 responsáveis válidos, por nome ou e-mail.', 'planner-invalid-assignees')
    const entries = fields.checklist || []
    const validChecklist = Array.isArray(entries) && entries.length <= 20
      && entries.every(entry => entry && !Array.isArray(entry)
        && Object.keys(entry).every(key => ['id', 'text', 'done'].includes(key))
        && typeof entry.id === 'string' && entry.id.length > 0 && entry.id.length <= 200
        && typeof entry.text === 'string' && entry.text.length <= 300 && typeof entry.done === 'boolean')
    if (!validChecklist) throw error('O checklist aceita até 20 itens, com até 300 caracteres por item.', 'planner-invalid-checklist')
  }
  if (kind === 'tasks' && (!Array.isArray(fields.dependencyIds) || fields.dependencyIds.length > 20
    || !fields.dependencyIds.every(id => typeof id === 'string' && id && id.length <= 200 && !id.includes('/')))) {
    throw error('Informe até 20 dependências válidas.', 'planner-invalid-dependencies')
  }
  return fields
}

function snapshotItem(kind, item) {
  const record = { ...item.data(), id: item.id }
  // Be defensive with legacy/admin-created records as well as concurrent edits.
  if (kind === 'tasks' || kind === 'routines') {
    record.assignees = (Array.isArray(record.assignees) ? record.assignees : [])
      .filter(person => person && typeof person.email === 'string' && typeof person.name === 'string' && (person.email || person.name))
      .slice(0, 10).map(person => ({ email: person.email.slice(0, 254), name: person.name.slice(0, 120) }))
    record.checklist = (Array.isArray(record.checklist) ? record.checklist : [])
      .filter(entry => entry && typeof entry.id === 'string' && typeof entry.text === 'string' && typeof entry.done === 'boolean')
      .slice(0, 20).map(entry => ({ id: entry.id.slice(0, 200), text: entry.text.slice(0, 300), done: entry.done }))
  }
  if (kind === 'tasks') {
    record.dependencyIds = (Array.isArray(record.dependencyIds) ? record.dependencyIds : [])
      .filter(id => typeof id === 'string' && id && id.length <= 200 && !id.includes('/')).slice(0, 20)
  }
  return record
}

/** Each item is a separate versioned Firestore document; no shared board snapshot is overwritten. */
export function createPlannerStore({ onSession = () => {}, onData = () => {}, onConfig = () => {}, onConfigError = () => {}, onError = () => {} } = {}) {
  const app = getApps().find(candidate => candidate.name === 'ipcvt-comissao') || initializeApp(firebaseConfig, 'ipcvt-comissao')
  const auth = getAuth(app)
  const db = getFirestore(app)
  let session = { status: 'signed-out', email: '', name: '', isAdmin: false, user: null, message: '' }
  let data = blankData()
  let sequence = 0
  let stopAccess = null
  let stopData = []
  let watchingData = false
  let scheduling = false
  let schedulingPending = false
  let scheduleRevision = ''
  let loadedKinds = new Set()
  const planConfigFor=id=>data.tasks.map(parsePlanCycleConfig).find(config=>config?.planId===id)
  function rotationRevision(){
    return data.tasks.filter(task=>task.deleted&&task.id?.startsWith('rotation_v1_'))
      .map(config=>{
        const template=data.tasks.find(task=>task.id===config.routineId)
        return [config.id,config.version||0,template?.id||'',template?.version||0].join(':')
      }).sort().join('|')
  }
  function planCycleRevision(){
    const configs=data.tasks.map(parsePlanCycleConfig).filter(Boolean)
    const active=new Set(configs.map(config=>config.planId))
    return [localDay(),...configs.map(cfg=>cfg.id+':'+cfg.templateKey),
      ...data.plans.filter(plan=>active.has(plan.id)).map(plan=>plan.id+':'+plan.deleted),
      ...data.tasks.filter(task=>active.has(task.planId)&&!task.deleted)
        .map(task=>task.id+':'+task.dueDate+':'+task.sourceTaskId+':'+task.recurrenceId)]
      .sort().join('|')
  }
  function requestScheduleRefresh(){
    if(!loadedKinds.has('tasks')||!loadedKinds.has('buckets')||!loadedKinds.has('plans'))return
    const revision=rotationRevision()+'||'+planCycleRevision()
    if(revision===scheduleRevision)return
    scheduleRevision=revision
    void refreshScheduledSeries()
  }
  const localDay=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',
    year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  async function ensureScheduledSeries(template,config) {
    if(!template||!taskRecurrence(template)||config?.advance!=='scheduled'||planConfigFor(template.planId))return
    const upcoming=scheduledUpcomingDates(template,localDay(),4)
    for(const date of upcoming){
      if(session.status!=='authorized')return
      const occurrence=recurrenceOccurrenceAt(template,date,config,data.buckets)
      if(!occurrence||data.tasks.some(task=>task.id===occurrence.id))continue
      const target=itemRef('tasks',occurrence.id)
      const setting=itemRef('tasks',config.id||rotationConfigId(config.sourceId))
      const original=itemRef('tasks',template.id)
      // Rotinas migradas preservam as ocorrências legadas e seus IDs.
      // Consulte também a chave semanal antiga para jamais duplicar a semana.
      const dateUTC=new Date(date+'T12:00:00Z')
      const dayOfWeek=dateUTC.getUTCDay()
      const weekStart=new Date(dateUTC.getTime()-((dayOfWeek+6)%7)*86400000)
        .toISOString().slice(0,10)
      const oldId=template.routineId
        ? 'routine_'+encodeURIComponent(template.routineId)+'_'+weekStart : ''
      const oldOccurrence=oldId&&oldId!==occurrence.id?itemRef('tasks',oldId):null
      if(data.tasks.some(task=>task.routineId===template.routineId&&
        !!template.routineId&&!task.deleted&&
        (task.dueDate===date||task.cycleKey===weekStart)))continue
      await runTransaction(db,async tx=>{
        const currentSetting=await tx.get(setting)
        const currentOriginal=await tx.get(original)
        const exists=await tx.get(target)
        const legacy=oldOccurrence?await tx.get(oldOccurrence):null
        if(exists.exists()||legacy?.exists()||!currentSetting.exists()||!currentOriginal.exists()||currentOriginal.data().deleted)return
        const latestConfig=parseRotationConfig({...currentSetting.data(),id:config.id})
        if(!latestConfig||latestConfig.advance!=='scheduled'||latestConfig.templateId!==template.id||
          currentOriginal.data().recurrenceId!==template.recurrenceId)return
        const latest=recurrenceOccurrenceAt({...currentOriginal.data(),id:template.id},date,latestConfig,data.buckets)
        if(!latest)return
        const actor=requireSession()
        tx.set(target,{...payloadFor('tasks',latest),version:1,
          createdAt:serverTimestamp(),createdBy:actor.email,
          updatedAt:serverTimestamp(),updatedBy:actor.email})
      })
    }
  }
  async function refreshScheduledSeries(){
    if(scheduling){schedulingPending=true;return}
    scheduling=true
    try{
      do{
        schedulingPending=false
        const configs=data.tasks.map(parseRotationConfig).filter(config=>config?.advance==='scheduled')
        for(const config of configs){
          if(session.status!=='authorized')return
          const template=data.tasks.find(task=>task.id===config.templateId&&!task.deleted)
          const plan=template&&data.plans.find(item=>item.id===template.planId)
          if(template&&!plan?.deleted)await ensureScheduledSeries(template,config)
        }
        await refreshRecurringPlans()
      }while(schedulingPending&&session.status==='authorized')
    }catch(cause){onError(readableError(cause))}
    finally{scheduling=false}
  }

  async function refreshRecurringPlans(){
    const configs=data.tasks.map(parsePlanCycleConfig).filter(Boolean)
    for(const config of configs){
      if(session.status!=='authorized')return
      if(!data.plans.some(plan=>plan.id===config.planId&&!plan.deleted))continue
      const targets=missingPlanCycleTasks(config,data.tasks,data.buckets,localDay(),2)
      for(const draft of targets){
        if(session.status!=='authorized')return
        await runTransaction(db,async tx=>{
          const configDoc=await tx.get(itemRef('tasks',config.id))
          const planDoc=await tx.get(itemRef('plans',config.planId))
          const target=itemRef('tasks',draft.id)
          const exists=await tx.get(target)
          if(exists.exists()||!configDoc.exists()||!planDoc.exists()||planDoc.data().deleted||
            parsePlanCycleConfig({...configDoc.data(),id:config.id})?.templateKey!==config.templateKey)return
          const actor=requireSession()
          tx.set(target,{...payloadFor('tasks',draft),version:1,
            createdAt:serverTimestamp(),createdBy:actor.email,
            updatedAt:serverTimestamp(),updatedBy:actor.email})
        })
      }
    }
  }

  function publishSession(fields) {
    session = { ...session, ...fields }
    onSession({ ...session })
  }

  function clearData() {
    for (const stop of stopData) stop()
    stopData = []
    watchingData = false
    schedulingPending = false
    scheduleRevision = ''
    loadedKinds = new Set()
    data = blankData()
    onData(data)
    onConfig(null)
  }

  function clearAll() {
    stopAccess?.()
    stopAccess = null
    clearData()
  }

  function requireSession() {
    if (session.status !== 'authorized' || !session.user || auth.currentUser?.uid !== session.user.uid) {
      throw error('Entre com uma conta autorizada da Comissão para continuar.', 'planner-not-authorized')
    }
    return session
  }

  function itemRef(kind, id) {
    if (!KINDS.includes(kind)) throw error('Tipo de registro inválido.', 'planner-invalid-kind')
    if (typeof id !== 'string' || !id || id.includes('/') || id.length > 200) throw error('Identificação do registro inválida.', 'planner-invalid-id')
    return doc(db, 'comissao_planner', 'main', kind, id)
  }

  function watchData(currentSequence) {
    if (watchingData) return
    watchingData = true
    stopData = KINDS.map(kind => onSnapshot(collection(db, 'comissao_planner', 'main', kind), snapshot => {
      if (sequence !== currentSequence || session.status !== 'authorized') return
      data = { ...data, [kind]: snapshot.docs.map(item => snapshotItem(kind, item)) }
      loadedKinds.add(kind)
      onData(data)
      if(['tasks','buckets','plans'].includes(kind))requestScheduleRefresh()
    }, cause => {
      if (sequence !== currentSequence) return
      const problem = readableError(cause)
      clearData()
      publishSession({ status: 'error', isAdmin: false, message: problem.message })
      onError(problem)
    }))
    stopData.push(onSnapshot(doc(db, 'comissao_planner', 'main', 'config', 'calendar'), snapshot => {
      if (sequence !== currentSequence || session.status !== 'authorized') return
      onConfig(snapshot.exists() ? snapshot.data() : null)
    }, cause => {
      if (sequence !== currentSequence) return
      onConfigError(readableError(cause))
    }))
  }

  onAuthStateChanged(auth, async user => {
    const currentSequence = ++sequence
    clearAll()
    if (!user) {
      publishSession({ status: 'signed-out', email: '', name: '', isAdmin: false, user: null, message: '' })
      return
    }
    const email = (user.email || '').trim().toLowerCase()
    publishSession({ status: 'checking', email, name: user.displayName || email, user, isAdmin: false, message: 'Verificando sua autorização...' })
    try {
      const token = await user.getIdTokenResult()
      if (sequence !== currentSequence) return
      if (!email || !user.emailVerified || token.claims.firebase?.sign_in_provider !== 'google.com' || token.claims.email_verified !== true) {
        publishSession({ status: 'pending', isAdmin: false, message: 'Use uma conta Google com e-mail verificado.' })
        return
      }
      stopAccess = onSnapshot(doc(db, 'comissao_acessos', email), snapshot => {
        if (sequence !== currentSequence) return
        const access = snapshot.exists() ? snapshot.data() : null
        if (access?.ativo !== true) {
          clearData()
          publishSession({ status: 'pending', isAdmin: false, message: 'Seu e-mail precisa de autorização da coordenação da Comissão.' })
          return
        }
        publishSession({ status: 'authorized', name: access.nome || user.displayName || email, isAdmin: access.perfil === 'admin', message: '' })
        watchData(currentSequence)
      }, cause => {
        if (sequence !== currentSequence) return
        const problem = readableError(cause)
        clearData()
        publishSession({ status: 'error', isAdmin: false, message: problem.message })
        onError(problem)
      })
    } catch (cause) {
      if (sequence !== currentSequence) return
      const problem = readableError(cause)
      publishSession({ status: 'error', isAdmin: false, message: problem.message })
      onError(problem)
    }
  }, cause => {
    ++sequence
    clearAll()
    const problem = readableError(cause)
    publishSession({ status: 'error', user: null, isAdmin: false, message: problem.message })
    onError(problem)
  })

  return {
    get session() { return { ...session } },

    // Cria um espaço compartilhado somente quando um integrante solicita uma
    // demanda diretamente a partir de um evento ou de uma tarefa independente.
    // Identificadores fixos impedem que acessos simultâneos criem planos duplicados.
    async ensureStandardPlan(category) {
      const actor = requireSession()
      const presets = {
        events: { id: 'ipcvt-preparacao-eventos', name: 'Preparação de eventos', bucketId: 'ipcvt-preparacao-planejamento', bucketName: 'Planejamento' },
        independent: { id: 'ipcvt-demandas-independentes', name: 'Demandas independentes', bucketId: 'ipcvt-independentes-geral', bucketName: 'A organizar' }
      }
      const preset = presets[category]
      if (!preset) throw error('Tipo de plano inicial inválido.', 'planner-invalid-category')
      const planRef = itemRef('plans', preset.id)
      const bucketRef = itemRef('buckets', preset.bucketId)
      try {
        const plan = await runTransaction(db, async transaction => {
          const existing = await transaction.get(planRef)
          requireSession()
          if (existing.exists()) {
            if (existing.data().deleted) throw error('O plano padrão está arquivado. Restaure-o antes de criar novas demandas.', 'planner-plan-archived')
            return { ...existing.data(), id: preset.id }
          }
          const record = {
            ...DEFAULTS.plans, name: preset.name,
            description: category === 'events' ? 'Demandas vinculadas à agenda oficial da IPCVT.' : 'Demandas sem vínculo obrigatório com eventos.',
            version: 1, createdAt: serverTimestamp(), createdBy: actor.email,
            updatedAt: serverTimestamp(), updatedBy: actor.email
          }
          transaction.set(planRef, record)
          return { ...record, id: preset.id }
        })
        const bucket = await runTransaction(db, async transaction => {
          const existing = await transaction.get(bucketRef)
          requireSession()
          if (existing.exists()) {
            if (existing.data().deleted) throw error('A etapa padrão está arquivada. Atualize o plano antes de continuar.', 'planner-bucket-archived')
            return { ...existing.data(), id: preset.bucketId }
          }
          const record = {
            ...DEFAULTS.buckets, planId: preset.id, name: preset.bucketName, order: 0,
            version: 1, createdAt: serverTimestamp(), createdBy: actor.email,
            updatedAt: serverTimestamp(), updatedBy: actor.email
          }
          transaction.set(bucketRef, record)
          return { ...record, id: preset.bucketId }
        })
        return { plan, bucket }
      } catch (cause) { throw readableError(cause) }
    },

    async login() {
      try {
        await googleLogin(auth)
      } catch (cause) {
        throw readableError(cause)
      }
    },

    async logout() {
      ++sequence
      clearAll()
      publishSession({ status: 'signed-out', email: '', name: '', isAdmin: false, user: null, message: '' })
      try { await signOut(auth) } catch (cause) { throw readableError(cause) }
    },

    async save(kind, item, { expectedVersion, rotationConfig } = {}) {
      const actor = requireSession()
      const ref = itemRef(kind, item.id)
      const fields = payloadFor(kind, item)
      const setup=kind==='tasks'&&rotationConfig
        ? rotationConfigRecord({...fields,id:item.id},rotationConfig):null
      const setupFields=setup?payloadFor('tasks',setup):null
      const setupRef=setup?itemRef('tasks',setup.id):null
      const rule=kind==='tasks'?taskRecurrence({...fields,id:item.id}):null
      const oldConfig=rule?data.tasks.find(task=>task.id===rotationConfigId(rule.sourceId)):null
      const config=setup?parseRotationConfig(setup):parseRotationConfig(oldConfig)
      const nextTask=kind==='tasks'&&!planConfigFor(fields.planId)
        ?nextRecurringTask({...fields,id:item.id},data.buckets,config):null
      const nextRef=nextTask?itemRef('tasks',nextTask.id):null
      if (kind === 'events' && fields.source === 'google' && !actor.isAdmin) throw error('Somente um administrador pode importar eventos do Google Agenda.', 'planner-admin-required')
      try {
        const saved=await runTransaction(db, async transaction => {
          const previous = await transaction.get(ref)
          const previousSetup=setupRef?await transaction.get(setupRef):null
          // Read both documents before writing. Completing an occurrence and
          // creating its successor succeed together, including on retries.
          const continues = nextRef && (!previous.exists() || previous.data().status !== 'done')
          const nextSnapshot = continues ? await transaction.get(nextRef) : null
          requireSession()
          if (previous.exists() && (!Number.isInteger(expectedVersion) || previous.data().version !== expectedVersion)) {
            throw error('Outra pessoa atualizou este registro. Abra novamente para conferir as alterações antes de salvar.', 'conflict')
          }
          if (!previous.exists() && expectedVersion !== undefined) throw error('Este registro foi excluído. Atualize a tela antes de continuar.', 'conflict')
          const version = previous.exists() ? previous.data().version + 1 : 1
          const record = {
            ...fields, version,
            createdAt: previous.exists() ? previous.data().createdAt : serverTimestamp(),
            createdBy: previous.exists() ? previous.data().createdBy : actor.email,
            updatedAt: serverTimestamp(), updatedBy: actor.email
          }
          transaction.set(ref, record)
          if(setupRef){
            const wasSaved=previousSetup?.exists()
            transaction.set(setupRef,{
              ...setupFields,version:wasSaved?previousSetup.data().version+1:1,
              createdAt:wasSaved?previousSetup.data().createdAt:serverTimestamp(),
              createdBy:wasSaved?previousSetup.data().createdBy:actor.email,
              updatedAt:serverTimestamp(),updatedBy:actor.email
            })
          }
          if (continues && !nextSnapshot.exists()) {
            const nextFields = payloadFor('tasks', nextTask)
            transaction.set(nextRef, {
              ...nextFields, version: 1,
              createdAt: serverTimestamp(), createdBy: actor.email,
              updatedAt: serverTimestamp(), updatedBy: actor.email
            })
          }
          return { ...fields, id: item.id, version }
        })
        return saved
      } catch (cause) { throw readableError(cause) }
    },

    async remove(kind, id, { expectedVersion } = {}) {
      requireSession()
      const ref = itemRef(kind, id)
      if (kind === 'plans') {
        const plan = data.plans.find(item => item.id === id)
        if (!plan) throw error('Este plano não está mais disponível.', 'conflict')
        return this.save('plans', { ...plan, deleted: true }, { expectedVersion })
      }
      if (kind === 'buckets' && [...data.tasks, ...data.routines].some(item => item.bucketId === id)) {
        throw error('Mova as demandas e rotinas deste bucket antes de excluí-lo.', 'planner-bucket-in-use')
      }
      try {
        return await runTransaction(db, async transaction => {
          const previous = await transaction.get(ref)
          const actor = requireSession()
          if (!previous.exists()) throw error('Este registro já foi excluído.', 'conflict')
          if (!Number.isInteger(expectedVersion) || previous.data().version !== expectedVersion) throw error('Este registro mudou. Abra novamente antes de excluir.', 'conflict')
          if (kind === 'events' && previous.data().source === 'google' && !actor.isAdmin) throw error('Somente um administrador pode remover eventos importados.', 'planner-admin-required')
          transaction.delete(ref)
        })
      } catch (cause) { throw readableError(cause) }
    },

    async saveCalendarConfig({ calendarId, sourceUrl }) {
      const actor = requireSession()
      if (!actor.isAdmin) throw error('Somente a administração pode alterar a agenda oficial.', 'planner-admin-required')
      if (typeof calendarId !== 'string' || !/^[-A-Za-z0-9_.@+]{1,250}$/.test(calendarId)
        || typeof sourceUrl !== 'string' || sourceUrl.length > 2000 || !sourceUrl.startsWith('https://calendar.google.com/calendar/')) {
        throw error('Informe um link público válido do Google Agenda.', 'planner-calendar-config-invalid')
      }
      try {
        await setDoc(doc(db, 'comissao_planner', 'main', 'config', 'calendar'), {
          calendarId, sourceUrl, updatedBy: actor.email, updatedAt: serverTimestamp()
        })
      } catch (cause) { throw readableError(cause) }
    },

    async connectGoogleCalendars() {
      const actor = requireSession()
      if (!actor.isAdmin) throw error('Somente um administrador pode disponibilizar agendas para a Comissão.', 'planner-admin-required')
      const provider = new GoogleAuthProvider()
      provider.addScope('https://www.googleapis.com/auth/calendar.calendarlist.readonly')
      provider.addScope('https://www.googleapis.com/auth/calendar.events.readonly')
      provider.setCustomParameters({ login_hint: actor.email })
      const currentSequence = sequence
      try {
        const result = await reauthenticateWithPopup(actor.user, provider)
        requireSession()
        if (sequence !== currentSequence || result.user.uid !== actor.user.uid) throw error('Sua sessão mudou. Conecte a agenda novamente.', 'planner-session-changed')
        const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken
        if (!token) throw error('O Google não forneceu acesso à agenda. Autorize a conexão novamente.', 'planner-google-token')
        return token
      } catch (cause) { throw readableError(cause) }
    }
  }
}

