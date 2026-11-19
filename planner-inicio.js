const claudeKey = 'ipcvt:planner:claude-geral'
const claudeRequest = /^#ipcvt-claude-geral=([A-Za-z0-9_-]{43})$/.exec(location.hash)
let claudePending
try {
  if (claudeRequest) sessionStorage.setItem(claudeKey, JSON.stringify({id:claudeRequest[1],until:Date.now()+600000}))
  claudePending = JSON.parse(sessionStorage.getItem(claudeKey))
  if (claudePending?.until <= Date.now()) {
    sessionStorage.removeItem(claudeKey)
    claudePending = null
  }
} catch { /* armazenamento indisponível */ }
async function authorizeClaude(record) {
  history.replaceState(null,'',location.pathname + location.search)
  const {hasPanelEntry,clearPanelEntry} = await import('./comissao-entrada.js?v=20261114-v1')
  if (!hasPanelEntry('planner')) return location.replace('comissao.html')
  const {createPlannerStore} = await import('./planner-store.js?v=20261118-session-only-v1')
  const {consentGoogle}=await import('./planner-piloto-ia.js?v=20261119-acoes')
  const store = createPlannerStore({sessionOnly:true,onSession(session) {
    if (session.status === 'checking') return
    if (session.status !== 'authorized' || !hasPanelEntry('planner',session.user?.uid)) {
      clearPanelEntry('planner')
      location.replace('comissao.html')
      return
    }
    const dialog = document.getElementById('confirm-dialog')
    const accept = document.getElementById('confirm-accept')
    const cancel = document.getElementById('confirm-cancel')
    document.getElementById('planner-app').hidden = false
    document.getElementById('confirm-title').textContent = 'Autorizar o Claude?'
    document.getElementById('confirm-message').textContent = 'Vínculo renovável para consultar o Planner, criar após confirmação no chat e concluir demandas atribuídas a você. Você pode remover a conexão no Claude. Conta da Comissão: '+session.email
    accept.textContent = 'Vincular minha conta'
    cancel.textContent = 'Cancelar'
    cancel.hidden = false
    cancel.onclick = dialog.oncancel = () => {sessionStorage.removeItem(claudeKey); location.replace('comissao.html')}
    accept.onclick = async () => {
      accept.disabled = true
      try {
        const google=await consentGoogle(session.email)
        const token = await session.user.getIdToken()
        if (store.session.status !== 'authorized' || store.session.user?.uid !== session.user.uid || record.until <= Date.now() || !hasPanelEntry('planner',session.user.uid)) throw Error()
        const form = document.createElement('form')
        form.method = 'post'
        form.action = 'https://ipcvt-planner-claude.hudsonamorim08.workers.dev/confirm-geral'
        for (const [name,value] of Object.entries({state:record.id,id_token:token,google})) {
          const input = document.createElement('input')
          input.type = 'hidden'
          input.name = name
          input.value = value
          form.append(input)
        }
        sessionStorage.removeItem(claudeKey)
        document.body.append(form)
        form.submit()
      } catch { document.getElementById('confirm-message').textContent = 'Reinicie a conexão pelo Claude para confirmar a sessão.' }
    }
    if (!dialog.open) dialog.showModal()
  }})
}

// A navegação ordinária carrega o mesmo módulo principal e as mesmas visões do Planner.
let pending = false
try { pending = Boolean(sessionStorage.getItem('ipcvt:planner:piloto-ia')) } catch { /* armazenamento indisponível */ }
if (claudePending && window.top === window.self && !location.hash.startsWith('#ipcvt-ia')) {
  await authorizeClaude(claudePending)
} else if (/^#ipcvt-ia(?:$|[-=])/.test(location.hash) || pending) {
  const { startPilot } = await import('./planner-piloto-ia.js?v=20261119-acoes')
  await startPilot(() => import('./planner.js?v=20261117-mobile-v6'))
} else {
  await import('./planner.js?v=20261117-mobile-v6')
}
