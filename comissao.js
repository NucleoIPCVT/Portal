import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js'
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
  browserSessionPersistence
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js'

// Identificador público da conta da Comissão no Firebase Authentication.
// A senha NÃO deve ser colocada neste arquivo nem em outro código do site.
const COMMISSION_EMAIL = 'ipcvt.louvor@outlook.com'
const firebaseConfig = {
  apiKey: 'AIzaSyAg9w5QohkcmXUFRgLfSI5Sh1chnCD1Owc',
  authDomain: 'repertorio-ipcvt.firebaseapp.com',
  projectId: 'repertorio-ipcvt',
  storageBucket: 'repertorio-ipcvt.firebasestorage.app',
  messagingSenderId: '774659782213',
  appId: '1:774659782213:web:5e9cbf88fec30eb382152c'
}

const firebaseApp = initializeApp(firebaseConfig, 'ipcvt-comissao')
const auth = getAuth(firebaseApp)
const accessGate = document.getElementById('access-gate')
const accessForm = document.getElementById('access-form')
const passwordField = document.getElementById('access-password')
const accessError = document.getElementById('access-error')
const accessSubmit = document.getElementById('access-submit')
const commissionPanel = document.getElementById('commission-panel')
const logoutButton = document.getElementById('logout-button')
const togglePassword = document.getElementById('toggle-password')

let submitting = false

function showPanel(granted) {
  accessGate.hidden = granted
  commissionPanel.hidden = !granted
  if (granted) {
    passwordField.value = ''
    accessError.textContent = ''
  }
}

function setSubmitting(value) {
  submitting = value
  accessSubmit.disabled = value
  accessSubmit.setAttribute('aria-busy', String(value))
}

onAuthStateChanged(auth, (user) => {
  showPanel(Boolean(user && !user.isAnonymous && user.email?.toLowerCase() === COMMISSION_EMAIL))
  setSubmitting(false)
}, () => {
  accessError.textContent = 'Não foi possível conectar ao serviço de autenticação.'
  showPanel(false)
  setSubmitting(false)
})

accessForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (submitting || !passwordField.value) return
  accessError.textContent = ''
  setSubmitting(true)
  try {
    await setPersistence(auth, browserSessionPersistence)
    const { user } = await signInWithEmailAndPassword(auth, COMMISSION_EMAIL, passwordField.value)
    if (user.isAnonymous || user.email?.toLowerCase() !== COMMISSION_EMAIL) {
      await signOut(auth)
      throw new Error('not-authorized')
    }
    showPanel(true)
  } catch (error) {
    accessError.textContent = error.code === 'auth/too-many-requests'
      ? 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
      : 'Acesso não autorizado. Verifique a senha ou peça ajuda à coordenação.'
    showPanel(false)
    passwordField.select()
  } finally {
    setSubmitting(false)
  }
})

togglePassword.addEventListener('click', () => {
  const visible = passwordField.type === 'password'
  passwordField.type = visible ? 'text' : 'password'
  togglePassword.setAttribute('aria-pressed', String(visible))
  togglePassword.setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha')
  togglePassword.innerHTML = visible
    ? '<i class="ph ph-eye-slash" aria-hidden="true"></i>'
    : '<i class="ph ph-eye" aria-hidden="true"></i>'
})

logoutButton.addEventListener('click', async () => {
  showPanel(false)
  try {
    await signOut(auth)
    passwordField.focus()
  } catch {
    accessError.textContent = 'Não foi possível encerrar a sessão. Feche esta aba para sair.'
  }
})
