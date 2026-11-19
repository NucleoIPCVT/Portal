import {GOOGLE_CLIENT_ID,GOOGLE_LOGIN_SCOPES} from './ipcvt-google-login.js?v=20261112-google-direto-02'
export function consentGoogle(email){
  return new Promise((resolve,reject)=>{
    const client=window.google.accounts.oauth2.initTokenClient({
      client_id:GOOGLE_CLIENT_ID,scope:GOOGLE_LOGIN_SCOPES,login_hint:email,include_granted_scopes:false,
      callback:r=>r.access_token?resolve(r.access_token):reject(Error('Conta não confirmada')),
      error_callback:reject
    })
    client.requestAccessToken({prompt:'select_account'})
  })
}
import { hasPanelEntry, clearPanelEntry } from './comissao-entrada.js?v=20261114-v1'

const connector = 'https://planner-ipcvt-integracao-ia.hudsonamorim.chatgpt.site'
const key = 'ipcvt:planner:piloto-ia'
const lifetime = 15 * 60 * 1000
const validState = /^[A-Za-z0-9_-]{43}$/
const reports = {
  pronto: 'Conexão autorizada. Volte ao ChatGPT para consultar o Planner ou preparar uma prévia.',
  encerrado: 'Esta vinculação foi encerrada.',
  expirado: 'O vínculo expirou ou o navegador não reconheceu a sessão. Abra o link de vinculação de novo, nesta mesma janela.',
  sessao: 'A sessão não pôde ser confirmada. Entre no Work e na Comissão com as contas usadas no teste.',
  'sem-acesso': 'Esta conta Google precisa de autorização ativa na Comissão.',
  falha: 'Não foi possível concluir a consulta. Volte ao chat para conferir o estado do teste.',
  armazenamento: 'Permita o armazenamento desta aba para confirmar a sua conta.',
  cancelado: 'Você cancelou a vinculação.'
}
function forget() {
  try { sessionStorage.removeItem(key) } catch { /* já indisponível */ }
}
function dialog(title, message, action, accept, cancel, cancelLabel = 'Cancelar') {
  const el = document.getElementById('confirm-dialog')
  const yes = document.getElementById('confirm-accept')
  const no = document.getElementById('confirm-cancel')
  document.getElementById('confirm-title').textContent = title
  document.getElementById('confirm-message').textContent = message
  yes.className = 'button button-primary'
  yes.textContent = action
  yes.disabled = false
  yes.onclick = () => { yes.disabled = true; accept() }
  no.textContent = cancelLabel
  no.hidden = !cancel
  no.onclick = cancel || null
  el.oncancel = event => { event.preventDefault(); (cancel || accept)() }
  if (!el.open) el.showModal()
}
function finish(kind) {
  forget()
  if (kind === 'expirado') {
    return dialog('Vínculo expirado', 'Reinicie o vínculo para autorizar as consultas do Planner com a sua sessão atual.',
      'Reiniciar vínculo', () => location.replace(connector+'/vincular-geral'),
      () => location.replace('comissao.html'), 'Voltar à Comissão')
  }
  dialog('Vinculação com o ChatGPT', reports[kind] || reports.falha, 'Voltar à Comissão', () => location.replace('comissao.html'))
}
function submit(path, state, token) {
  const form = document.createElement('form')
  form.method = 'post'
  form.action = connector + path
  form.hidden = true
  for (const [name,value] of Object.entries(token ? {state,id_token:token} : {state})) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.append(input)
  }
  document.body.append(form)
  form.submit()
  form.remove()
}
export async function startPilot(openPlanner) {
  const fragment = location.hash
  const requested = fragment.startsWith('#ipcvt-ia')
  if (requested) history.replaceState(null,'',location.pathname + location.search)
  if (window.top !== window.self) {
    if (requested) return finish('sessao')
    return openPlanner()
  }
  if (fragment === '#ipcvt-ia') {
    forget()
    location.replace(connector + '/vincular-geral')
    return
  }
  let record
  try { record = JSON.parse(sessionStorage.getItem(key) || 'null') }
  catch { if (!requested) return finish('expirado') }
  if (record && (!validState.test(record.state) || !(record.until > Date.now()) || record.until > Date.now()+lifetime)) {
    record = null
    forget()
    if (!requested) return finish('expirado')
  }
  const request = /^#ipcvt-ia-pedido=([A-Za-z0-9_-]{43})$/.exec(fragment)
  const callback = /^#ipcvt-ia-confirmar=([A-Za-z0-9_-]{43})$/.exec(fragment)
  if (request) {
    record = {state:request[1], until:Date.now()+lifetime}
    try { sessionStorage.setItem(key,JSON.stringify(record)) } catch { return finish('armazenamento') }
  } else if (callback) {
    if (!record?.uid || record.state !== callback[1]) return finish('expirado')
  } else if (requested) {
    return finish(fragment.slice('#ipcvt-ia-'.length))
  } else if (!record) {
    return openPlanner()
  }
  if (!hasPanelEntry('planner')) {
    location.replace('comissao.html')
    return
  }
  const {createPlannerStore} = await import('./planner-store.js?v=20261118-session-only-v1')
  let verifying = false
  const store = createPlannerStore({sessionOnly:true,onSession(session) {
    if (session.status === 'checking') return
    if (['signed-out','pending','error'].includes(session.status) || !hasPanelEntry('planner',session.user?.uid)) {
      if (callback || record.uid) return finish('sessao')
      clearPanelEntry('planner')
      location.replace('comissao.html')
      return
    }
    if (session.status !== 'authorized' || verifying) return
    if (callback) {
      if (record.uid !== session.user.uid) return finish('sessao')
      verifying = true
      void (async () => {
        try {
          const token = await session.user.getIdToken()
          const current = store.session
          if (current.status!=='authorized' || current.user?.uid!==record.uid || !hasPanelEntry('planner',record.uid) || record.until<=Date.now()) return finish('expirado')
          forget()
          submit('/vinculo-geral/confirmar',record.state,token)
        } catch { finish('sessao') }
      })()
      return
    }
    document.getElementById('planner-app').hidden = false
    dialog('Vincular o ChatGPT ao Planner?', 'A conta '+session.email+' permitirá consultas contínuas, criação após confirmação no chat e conclusão das demandas atribuídas a você. Para revogar, abra o conector em /desvincular.',
      'Vincular minha conta', async () => {
        let google
        try { google=await consentGoogle(session.email) } catch { return finish('sessao') }
        dialog('Confirmar conta do Work', 'Finalize o vínculo desta conta Google com seu ChatGPT.', 'Finalizar vínculo', () => {
        if (store.session.user?.uid!==session.user.uid || store.session.status!=='authorized' || record.until<=Date.now()) return finish('expirado')
        record.uid = session.user.uid
        try { sessionStorage.setItem(key,JSON.stringify(record)) } catch { return finish('armazenamento') }
        const popup = window.open(connector+'/vinculo-geral/ponte#'+record.state,'_blank','popup,width=480,height=360')
        if (!popup) return finish('falha')
        let sent = false
        const timer = setInterval(() => {
          if (popup.closed || Date.now()>=record.until) complete('falha')
        },1000)
        function complete(result) {
          clearInterval(timer)
          window.removeEventListener('message',receive)
          popup.close()
          finish(result)
        }
        async function receive(event) {
          if (event.origin!==connector || event.source!==popup || event.data?.state!==record.state) return
          if (sent && ['pronto','falha'].includes(event.data.result)) return complete(event.data.result)
          if (sent || event.data.ready!==true) return
          sent = true
          try {
            const token = await session.user.getIdToken()
            if (store.session.status!=='authorized' || store.session.user?.uid!==record.uid || Date.now()>=record.until) return complete('expirado')
            popup.postMessage({state:record.state,token,google},connector)
          } catch { complete('sessao') }
        }
        window.addEventListener('message',receive)
        }, () => finish('cancelado'))
      }, () => finish('cancelado'))
  }})
}
