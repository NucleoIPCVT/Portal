import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js'
import {
  browserLocalPersistence, getAuth, GoogleAuthProvider, onAuthStateChanged,
  setPersistence, signInWithPopup, signOut,
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js'
import { doc, getFirestore, onSnapshot } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js'

const config = {
  apiKey: 'AIzaSyAg9w5QohkcmXUFRgLfSI5Sh1chnCD1Owc',
  authDomain: 'repertorio-ipcvt.firebaseapp.com',
  projectId: 'repertorio-ipcvt',
  appId: '1:774659782213:web:79a4590ad0caf6a282152c',
}

// O nome da aplicação também é utilizado pelo SDK do quadro de planejamento.
const app = getApps().find((candidate) => candidate.name === 'ipcvt-planner')
  ?? initializeApp(config, 'ipcvt-planner')
const auth = getAuth(app)
const db = getFirestore(app)
const provider = new GoogleAuthProvider()
provider.setCustomParameters({ prompt: 'select_account' })

const ui = {
  gate: document.getElementById('access-gate'),
  root: document.getElementById('root'),
  login: document.getElementById('gate-google-login'),
  switch: document.getElementById('gate-switch-account'),
  feedback: document.getElementById('gate-feedback'),
  pending: document.getElementById('gate-pending'),
  email: document.getElementById('gate-email'),
  theme: document.getElementById('gate-theme'),
}

let sequence = 0
let unsubscribePermission = null
let loaded = false
let wasAuthorized = false

function showGate(message = '', { email = '', canLogin = false, canSwitch = false } = {}) {
  if (wasAuthorized) {
    // Uma suspensão ou saída descarrega o quadro que já estava aberto.
    window.location.reload()
    return
  }
  ui.gate.hidden = false
  ui.root.hidden = true
  document.body.classList.add('gate-active')
  ui.feedback.textContent = message
  ui.login.hidden = !canLogin
  ui.switch.hidden = !canSwitch
  ui.pending.hidden = !email
  ui.email.textContent = email
}

function signInError(error) {
  switch (error?.code) {
    case 'auth/popup-blocked': return 'O navegador bloqueou a janela do Google. Habilite pop-ups e tente novamente.'
    case 'auth/popup-closed-by-user': return 'O login foi cancelado.'
    case 'auth/unauthorized-domain': return 'É necessário autorizar nucleoipcvt.github.io no Firebase Authentication.'
    case 'auth/operation-not-allowed': return 'O login Google precisa ser habilitado no Firebase.'
    default: return 'Falha no login Google. Tente novamente.'
  }
}

async function enterPlanning() {
  if (loaded) return
  wasAuthorized = true
  loaded = true
  ui.gate.hidden = true
  ui.root.hidden = false
  document.body.classList.remove('gate-active', 'gate-dark')
  try {
    await import('./assets/index-C8auUyjE.js')
  } catch (error) {
    console.error('Falha ao carregar o Planejamento Estratégico:', error)
    loaded = false
    wasAuthorized = false
    showGate('Não foi possível carregar o quadro. Atualize a página e tente novamente.', { canSwitch: true })
  }
}

ui.login.addEventListener('click', async () => {
  ui.login.disabled = true
  ui.feedback.textContent = 'Abrindo o Google…'
  try {
    await setPersistence(auth, browserLocalPersistence)
    await signInWithPopup(auth, provider)
  } catch (error) {
    showGate(signInError(error), { canLogin: true })
  } finally {
    ui.login.disabled = false
  }
})

ui.switch.addEventListener('click', async () => {
  ui.switch.disabled = true
  try {
    await signOut(auth)
  } catch {
    showGate('Não foi possível sair da conta. Tente novamente.', { canSwitch: true })
  } finally {
    ui.switch.disabled = false
  }
})

onAuthStateChanged(auth, async (user) => {
  const current = ++sequence
  unsubscribePermission?.()
  unsubscribePermission = null

  if (!user) {
    showGate('Entre com sua conta Google autorizada pela Comissão.', { canLogin: true })
    return
  }

  showGate('Conferindo sua autorização…')
  try {
    const token = await user.getIdTokenResult()
    if (current !== sequence) return
    if (!user.email || !user.emailVerified || token.claims.firebase?.sign_in_provider !== 'google.com') {
      showGate('Use uma conta Google com e-mail verificado.', { canSwitch: true })
      return
    }

    const email = user.email.trim().toLowerCase()
    unsubscribePermission = onSnapshot(doc(db, 'tatico_acessos', email), (snapshot) => {
      if (current !== sequence) return
      if (snapshot.exists() && snapshot.data().ativo === true) {
        void enterPlanning()
      } else {
        showGate('Este e-mail ainda não está liberado para o Planejamento Estratégico.', { email, canSwitch: true })
      }
    }, (error) => {
      if (current !== sequence) return
      showGate(error.code === 'permission-denied'
        ? 'Falta permitir a leitura das autorizações nas regras do Firebase.'
        : 'Não foi possível conferir seu acesso. Atualize a página e tente novamente.', { canSwitch: true })
    })
  } catch {
    if (current === sequence) showGate('Falha ao validar a conta Google.', { canSwitch: true })
  }
})

// Tema apenas para a tela de login; o painel tem botão de modo escuro próprio.
ui.theme.addEventListener('click', () => {
  const dark = document.body.classList.toggle('gate-dark')
  ui.theme.textContent = dark ? '☀ Modo claro' : '☾ Modo noturno'
  ui.theme.setAttribute('aria-label', dark ? 'Ativar modo claro' : 'Ativar modo noturno')
})
