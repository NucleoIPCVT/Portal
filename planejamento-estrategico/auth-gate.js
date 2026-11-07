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
  themeIcon: document.getElementById('gate-theme-icon'),
  themeText: document.getElementById('gate-theme-text'),
}

let sequence = 0
let unsubscribePermission = null
let loaded = false
let wasAuthorized = false

function showGate(message = '', { email = '', canLogin = false, canSwitch = false, status = 'ready' } = {}) {
  if (wasAuthorized) {
    // Uma suspensão ou saída descarrega o quadro que já estava aberto.
    window.location.reload()
    return
  }
  ui.gate.hidden = false
  ui.root.hidden = true
  document.body.classList.add('gate-active')
  ui.feedback.textContent = message
  ui.feedback.dataset.state = status
  ui.login.hidden = !canLogin
  ui.switch.hidden = !canSwitch
  ui.pending.hidden = !email
  ui.email.textContent = email
}

function signInError(error) {
  switch (error?.code) {
    case 'auth/popup-blocked': return 'O navegador bloqueou a janela do Google. Permita pop-ups e tente novamente.'
    case 'auth/popup-closed-by-user': return 'O login foi cancelado. Tente novamente quando quiser.'
    case 'auth/unauthorized-domain': return 'O endereço do portal precisa ser autorizado no Firebase.'
    case 'auth/operation-not-allowed': return 'O login pelo Google precisa ser ativado no Firebase.'
    default: return 'Não foi possível entrar com Google. Tente novamente.'
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
  ui.feedback.dataset.state = 'checking'
  try {
    // Abre o pop-up diretamente no clique (como no Planner), inclusive em celulares.
    const googleLogin = signInWithPopup(auth, provider)
    await Promise.all([googleLogin, setPersistence(auth, browserLocalPersistence)])
  } catch (error) {
    showGate(signInError(error), { canLogin: true, status: 'error' })
  } finally {
    ui.login.disabled = false
  }
})

ui.switch.addEventListener('click', async () => {
  ui.switch.disabled = true
  try {
    await signOut(auth)
  } catch {
    showGate('Não foi possível trocar de conta. Tente novamente.', { canSwitch: true, status: 'error' })
  } finally {
    ui.switch.disabled = false
  }
})

onAuthStateChanged(auth, async (user) => {
  const current = ++sequence
  unsubscribePermission?.()
  unsubscribePermission = null

  if (!user) {
    showGate('Entre com sua conta Google para continuar.', { canLogin: true })
    return
  }

  showGate('Conferindo a permissão deste e-mail…', { status: 'checking' })
  try {
    const token = await user.getIdTokenResult()
    if (current !== sequence) return
    // Mesmos critérios de identidade usados pela Comissão e pelo Planner.
    if (!user.email || !user.emailVerified || token.claims.firebase?.sign_in_provider !== 'google.com' || token.claims.email_verified !== true) {
      showGate('Use uma conta Google com e-mail verificado.', { canSwitch: true, status: 'error' })
      return
    }

    const email = user.email.trim().toLowerCase()
    unsubscribePermission = onSnapshot(doc(db, 'tatico_acessos', email), (snapshot) => {
      if (current !== sequence) return
      if (snapshot.exists() && snapshot.data().ativo === true) {
        void enterPlanning()
      } else {
        showGate('Acesso aguardando autorização da coordenação.', { email, canSwitch: true, status: 'pending' })
      }
    }, (error) => {
      if (current !== sequence) return
      showGate(error.code === 'permission-denied'
        ? 'Ainda falta configurar as permissões no Firebase.'
        : 'Não foi possível consultar as permissões. Atualize a página e tente novamente.', { canSwitch: true, status: 'error' })
    })
  } catch {
    if (current === sequence) showGate('Não foi possível verificar sua conta Google.', { canSwitch: true, status: 'error' })
  }
})

// Tema apenas para a tela de login; o painel tem botão de modo escuro próprio.
ui.theme.addEventListener('click', () => {
  const dark = document.body.classList.toggle('gate-dark')
  ui.themeIcon.textContent = dark ? '☀' : '☾'
  ui.themeText.textContent = dark ? 'Modo claro' : 'Modo noturno'
  ui.theme.setAttribute('aria-label', dark ? 'Ativar modo claro' : 'Ativar modo noturno')
})
