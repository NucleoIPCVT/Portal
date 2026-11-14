import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js'
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged,
  signInWithPopup, signInWithCredential, signOut
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js'
import {
  getFirestore, collection, doc, getDoc, onSnapshot,
  setDoc, updateDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js'
import { createGoogleLogin } from './ipcvt-google-login.js?v=20261112-google-direto-02'
import { grantPanelEntry, clearPanelEntry } from './comissao-entrada.js?v=20261114-v1'

const firebaseConfig = {
  apiKey: 'AIzaSyAg9w5QohkcmXUFRgLfSI5Sh1chnCD1Owc',
  authDomain: 'repertorio-ipcvt.firebaseapp.com',
  projectId: 'repertorio-ipcvt',
  storageBucket: 'repertorio-ipcvt.firebasestorage.app',
  messagingSenderId: '774659782213',
  appId: '1:774659782213:web:5e9cbf88fec30eb382152c'
}

// Cada e-mail autorizado possui um documento com o próprio endereço como ID.
// A permissão real deve ser aplicada também nas regras de segurança do Firestore.
const ACCESS_COLLECTION = 'comissao_acessos'
const OWNER_EMAIL = 'hudsonamorim08@gmail.com'
const TOOL_ACCESS = {
  comissao: { collection: ACCESS_COLLECTION, hint: 'Acesso ao painel da Comissão.' },
  vaquinhas: { collection: 'vaquinhas_acessos', hint: 'Acesso à criação, edição e validação das vaquinhas.' },
  escala: { collection: 'escala_geral_acessos', hint: 'Acesso ao modo administrador, trocas, relatórios e equipes da Escala Geral.' },
  tatico: { collection: 'tatico_acessos', hint: 'Acesso ao Planejamento Estratégico para organizar integrantes e funções dos times.' }
}
const app = initializeApp(firebaseConfig, 'ipcvt-comissao')
const auth = getAuth(app)
const db = getFirestore(app)
const provider = new GoogleAuthProvider()
provider.setCustomParameters({ prompt: 'select_account' })
const googleLogin = createGoogleLogin({
  getAccounts: () => window.google?.accounts,
  credentialFromAccessToken: token => GoogleAuthProvider.credential(null, token),
  signInWithCredential,
  fallback: auth => signInWithPopup(auth, provider)
})

const ui = Object.fromEntries([
  'access-gate', 'google-login', 'auth-feedback', 'access-pending',
  'pending-email', 'switch-account', 'commission-panel', 'member-email',
  'logout-button', 'authorization-toggle', 'authorization-tool',
  'authorization-tool-hint', 'access-admin', 'member-form', 'new-member-email',
  'new-member-name', 'member-feedback', 'member-list', 'launch-feedback'
].map(id => [id, document.getElementById(id)]))

let stopOwnAccess = null
let stopMemberList = null
let sessionSequence = 0
let adminEmail = null
let watchedTool = ''
let dashboardReady = false

function clearListeners() {
  stopOwnAccess?.()
  stopMemberList?.()
  stopOwnAccess = null
  stopMemberList = null
  adminEmail = null
  watchedTool = ''
}

function showGate(message = '', pendingEmail = '') {
  dashboardReady = false
  clearPanelEntry()
  ui['commission-panel'].hidden = true
  ui['access-admin'].hidden = true
  ui['authorization-toggle'].hidden = true
  ui['authorization-toggle'].setAttribute('aria-expanded', 'false')
  ui['access-gate'].hidden = false
  ui['access-pending'].hidden = !pendingEmail
  ui['pending-email'].textContent = pendingEmail
  ui['google-login'].hidden = Boolean(pendingEmail)
  ui['auth-feedback'].textContent = message
}

function showDashboard(email, isAdmin) {
  dashboardReady = true
  ui['launch-feedback'].hidden = true
  ui['access-gate'].hidden = true
  ui['commission-panel'].hidden = false
  ui['member-email'].textContent = email
  const isOwner = isAdmin && email === OWNER_EMAIL
  ui['authorization-toggle'].hidden = !isOwner
  if (!isOwner) ui['access-admin'].hidden = true
  ui['authorization-toggle'].setAttribute('aria-expanded', String(isOwner && !ui['access-admin'].hidden))
  if (isOwner && !ui['access-admin'].hidden && (adminEmail !== email || watchedTool !== ui['authorization-tool'].value)) {
    watchMembers(email)
  }
  if (!isOwner && stopMemberList) {
    stopMemberList()
    stopMemberList = null
    adminEmail = null
    watchedTool = ''
  }
}

function authErrorMessage(error) {
  switch (error?.code) {
    case 'auth/popup-closed-by-user': return 'A aba do Google foi fechada antes de concluir o acesso. No tablet, abra a Comissão diretamente no Chrome e tente novamente.'
    case 'auth/popup-blocked': return 'O navegador bloqueou a aba do Google. Permita pop-ups e redirecionamentos para este site, ou abra diretamente no Chrome.'
    case 'auth/cancelled-popup-request': return 'Uma tentativa de login anterior foi interrompida. Toque novamente em Entrar com Google.'
    case 'auth/operation-not-supported-in-this-environment': return 'Este navegador não permite o login Google. Abra a Comissão no Chrome ou Firefox, fora de aplicativos.'
    case 'auth/web-storage-unsupported': return 'O armazenamento do navegador está bloqueado. Evite o modo anônimo e verifique as configurações de cookies.'
    case 'auth/network-request-failed': return 'Não foi possível comunicar com o Google. Confira sua conexão e tente novamente.'
    case 'auth/unauthorized-domain': return 'O endereço do portal precisa ser autorizado no Firebase.'
    case 'auth/operation-not-allowed': return 'O login pelo Google ainda precisa ser ativado no Firebase.'
    default: return 'Não foi possível entrar com Google' + (error?.code ? ' (' + error.code + ')' : '') + '. Tente novamente.'
  }
}

async function logout() {
  ++sessionSequence
  clearListeners()
  showGate('')
  try {
    await signOut(auth)
  } catch {
    showGate('Não foi possível encerrar a sessão. Feche esta aba e tente novamente.')
  }
}

ui['google-login'].addEventListener('click', async () => {
  ui['google-login'].disabled = true
  ui['auth-feedback'].textContent = 'Abrindo o Google...'
  try {
    await googleLogin(auth)
  } catch (error) {
    showGate(authErrorMessage(error))
  } finally {
    ui['google-login'].disabled = false
  }
})

ui['switch-account'].addEventListener('click', logout)
ui['logout-button'].addEventListener('click', logout)

// A ferramenta só é aberta depois de uma entrada iniciada no painel autenticado.
// Cada destino valida novamente a identidade e as permissões no Firebase.
document.querySelectorAll('.tool-card[data-tool]').forEach(card => {
  card.addEventListener('click', async event => {
    event.preventDefault()
    if (card.dataset.opening === 'true') return
    const tool = card.dataset.tool
    const user = auth.currentUser
    const feedback = ui['launch-feedback']
    if (!dashboardReady || !user?.uid) {
      feedback.textContent = 'Entre no Painel da Comissão para abrir esta ferramenta.'
      feedback.hidden = false
      return
    }
    card.dataset.opening = 'true'
    feedback.hidden = true
    try {
      if (tool === 'tatico') {
        // A autorização específica continua obrigatória para o Planejamento Estratégico.
        const email = (user.email || '').trim().toLowerCase()
        const access = await getDoc(doc(db, 'tatico_acessos', email))
        if (!access.exists() || access.data().ativo !== true) {
          throw new Error('Seu e-mail ainda não está autorizado no Planejamento Estratégico.')
        }
      }
      if (!dashboardReady || auth.currentUser?.uid !== user.uid) {
        throw new Error('Sua sessão mudou. Entre novamente pela Comissão.')
      }
      if (!grantPanelEntry(tool, user.uid)) {
        throw new Error('Não foi possível iniciar a ferramenta. Habilite o armazenamento desta aba.')
      }
      window.location.assign(card.href)
    } catch (error) {
      feedback.textContent = error.message || 'Não foi possível abrir a ferramenta.'
      feedback.hidden = false
      card.dataset.opening = 'false'
    }
  })
})

onAuthStateChanged(auth, async (user) => {
  const currentSequence = ++sessionSequence
  clearListeners()
  if (!user) {
    showGate('')
    return
  }
  showGate('Conferindo a permissão deste e-mail...')

  try {
    const token = await user.getIdTokenResult()
    if (currentSequence !== sessionSequence) return
    const loginProvider = token.claims.firebase?.sign_in_provider
    if (!user.email || !user.emailVerified || loginProvider !== 'google.com') {
      await logout()
      showGate('Use uma conta Google com e-mail verificado.')
      return
    }

    const email = user.email.trim().toLowerCase()
    stopOwnAccess = onSnapshot(doc(db, ACCESS_COLLECTION, email), (snapshot) => {
      if (currentSequence !== sessionSequence) return
      const access = snapshot.exists() ? snapshot.data() : null
      if (access?.ativo !== true) {
        if (stopMemberList) { stopMemberList(); stopMemberList = null; adminEmail = null }
        showGate('Acesso aguardando autorização da coordenação.', email)
        return
      }
      showDashboard(email, access.perfil === 'admin')
    }, (error) => {
      if (currentSequence !== sessionSequence) return
      showGate(error.code === 'permission-denied'
        ? 'Ainda falta configurar as permissões no Firebase.'
        : 'Não foi possível consultar as permissões. Tente novamente.')
    })
  } catch {
    if (currentSequence === sessionSequence) showGate('Não foi possível verificar sua conta Google.')
  }
})

function makeElement(tag, className, content = '') {
  const element = document.createElement(tag)
  if (className) element.className = className
  element.textContent = content
  return element
}

ui['authorization-toggle'].addEventListener('click', () => {
  if (auth.currentUser?.email?.trim().toLowerCase() !== OWNER_EMAIL) return
  const open = ui['access-admin'].hidden
  ui['access-admin'].hidden = !open
  ui['authorization-toggle'].setAttribute('aria-expanded', String(open))
  if (open) {
    watchMembers(OWNER_EMAIL)
    ui['access-admin'].scrollIntoView({ behavior: 'smooth', block: 'start' })
  } else {
    stopMemberList?.()
    stopMemberList = null
    watchedTool = ''
  }
})

ui['authorization-tool'].addEventListener('change', () => {
  if (adminEmail === OWNER_EMAIL) watchMembers(OWNER_EMAIL)
})

function renderMembers(members, loggedEmail, tool) {
  ui['member-list'].replaceChildren()
  if (!members.length) {
    ui['member-list'].append(makeElement('p', 'member-feedback', 'Nenhum e-mail cadastrado.'))
    return
  }
  for (const member of members.sort((a, b) => a.email.localeCompare(b.email, 'pt-BR'))) {
    const row = makeElement('div', 'member-row')
    const info = makeElement('div', 'member-info')
    info.append(makeElement('strong', '', member.nome || member.email))
    info.append(makeElement('span', '', member.email))
    const badges = makeElement('div', 'member-badges')
    if (tool === 'comissao') badges.append(makeElement('span', 'member-badge', member.perfil === 'admin' ? 'Administrador' : 'Membro'))
    badges.append(makeElement('span', 'member-badge' + (member.ativo ? '' : ' inactive'), member.ativo ? 'Ativo' : 'Suspenso'))

    const toggle = makeElement('button', 'member-action', member.ativo ? 'Suspender' : 'Reativar')
    toggle.type = 'button'
    toggle.disabled = member.email === loggedEmail && tool === 'comissao'
    if (toggle.disabled) toggle.title = 'Para sua segurança, suspenda sua conta pelo Firebase.'
    toggle.addEventListener('click', async () => {
      toggle.disabled = true
      ui['member-feedback'].textContent = 'Atualizando acesso...'
      try {
        await updateDoc(doc(db, TOOL_ACCESS[tool].collection, member.email), {
          ativo: !member.ativo, atualizadoEm: serverTimestamp(), atualizadoPor: loggedEmail
        })
        ui['member-feedback'].textContent = 'Permissão atualizada.'
      } catch {
        ui['member-feedback'].textContent = 'Não foi possível atualizar. Confira as permissões do Firebase.'
        toggle.disabled = false
      }
    })
    row.append(info, badges, toggle)
    ui['member-list'].append(row)
  }
}

function watchMembers(email) {
  stopMemberList?.()
  adminEmail = email
  const tool = ui['authorization-tool'].value
  watchedTool = tool
  const config = TOOL_ACCESS[tool]
  ui['authorization-tool-hint'].textContent = config.hint
  const nameField = ui['new-member-name']
  nameField.required = tool !== 'vaquinhas'
  nameField.parentElement.hidden = tool === 'vaquinhas'
  ui['member-feedback'].textContent = 'Carregando acessos...'
  stopMemberList = onSnapshot(collection(db, config.collection), (snapshot) => {
    const members = snapshot.docs.map(item => ({ ...item.data(), email: item.id }))
    renderMembers(members, email, tool)
    ui['member-feedback'].textContent = ''
  }, () => {
    ui['member-feedback'].textContent = 'A lista não pôde ser carregada. Verifique as regras do Firebase.'
  })
}

ui['member-form'].addEventListener('submit', async (event) => {
  event.preventDefault()
  if (adminEmail !== OWNER_EMAIL || auth.currentUser?.email?.trim().toLowerCase() !== OWNER_EMAIL) return
  const tool = ui['authorization-tool'].value
  const config = TOOL_ACCESS[tool]
  const email = ui['new-member-email'].value.trim().toLowerCase()
  const nome = ui['new-member-name'].value.trim()
  if (!email || (tool !== 'vaquinhas' && !nome) || !config) return

  const button = ui['member-form'].querySelector('[type="submit"]')
  button.disabled = true
  ui['member-feedback'].textContent = 'Salvando autorização...'
  try {
    const fields = {email, ativo: true, atualizadoEm: serverTimestamp(), atualizadoPor: adminEmail}
    if (tool !== 'vaquinhas') fields.nome = nome
    if (tool === 'comissao') fields.perfil = email === OWNER_EMAIL ? 'admin' : 'membro'
    await setDoc(doc(db, config.collection, email), fields, { merge: true })
    ui['member-form'].reset()
    ui['member-feedback'].textContent = `${email} foi autorizado.`
  } catch {
    ui['member-feedback'].textContent = 'Não foi possível autorizar. Confira as regras de segurança do Firebase.'
  } finally {
    button.disabled = false
  }
})
