import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js'
import {
  browserSessionPersistence, getAuth, onAuthStateChanged, setPersistence, updateCurrentUser
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js'
import { doc, getDoc, getFirestore, onSnapshot } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js'
import { hasPanelEntry, clearPanelEntry } from '../comissao-entrada.js?v=20261114-v1'

const firebaseBase = {
  apiKey: 'AIzaSyAg9w5QohkcmXUFRgLfSI5Sh1chnCD1Owc',
  authDomain: 'repertorio-ipcvt.firebaseapp.com',
  projectId: 'repertorio-ipcvt'
}

// O painel e o Planner usam ipcvt-comissao. O quadro estratégico compilado
// usa ipcvt-planner: espelhamos a identidade validada sem abrir outro Google.
const panelApp = getApps().find(app => app.name === 'ipcvt-comissao')
  ?? initializeApp({ ...firebaseBase, appId: '1:774659782213:web:5e9cbf88fec30eb382152c' }, 'ipcvt-comissao')
const boardApp = getApps().find(app => app.name === 'ipcvt-planner')
  ?? initializeApp({ ...firebaseBase, appId: '1:774659782213:web:79a4590ad0caf6a282152c' }, 'ipcvt-planner')
const panelAuth = getAuth(panelApp)
const boardAuth = getAuth(boardApp)
const db = getFirestore(panelApp)
const loader = document.getElementById('commission-entry-loading')
const root = document.getElementById('root')

let sequence = 0
let entered = false
let permissionUnsubscribes = []

function returnToPanel() {
  clearPanelEntry('tatico')
  window.location.replace('../comissao.html')
}

function loadingError(message) {
  loader.textContent = message
  loader.style.display = 'flex'
  loader.style.flexDirection = 'column'
  loader.style.gap = '14px'
  const back = document.createElement('a')
  back.href = '../comissao.html'
  back.textContent = 'Voltar ao Painel da Comissão'
  back.style.color = '#315f46'
  loader.append(back)
}

async function openBoard() {
  if (entered) return
  entered = true
  document.body.classList.remove('gate-active', 'gate-dark')
  root.hidden = false
  try {
    await import('./assets/index-C8auUyjE.js')
    loader.hidden = true
    loader.style.display = 'none'
  } catch (error) {
    console.error('Falha ao abrir Planejamento Estratégico:', error)
    entered = false
    root.hidden = true
    loadingError('Não foi possível carregar o quadro. Confira sua conexão e volte ao painel.')
  }
}

// O controle de origem evita a navegação casual por link. É um controle visual;
// a autorização real dos dados permanece no Firebase Authentication/Firestore.
if (!hasPanelEntry('tatico')) {
  returnToPanel()
} else {
  onAuthStateChanged(panelAuth, async user => {
    const current = ++sequence
    permissionUnsubscribes.forEach(stop => stop())
    permissionUnsubscribes = []

    if (!user || !hasPanelEntry('tatico', user.uid)) {
      returnToPanel()
      return
    }

    try {
      const token = await user.getIdTokenResult()
      if (current !== sequence) return
      if (!user.email || !user.emailVerified || token.claims.email_verified !== true
          || token.claims.firebase?.sign_in_provider !== 'google.com') {
        returnToPanel()
        return
      }

      const email = user.email.trim().toLowerCase()
      const [commission, toolAccess] = await Promise.all([
        getDoc(doc(db, 'comissao_acessos', email)),
        getDoc(doc(db, 'tatico_acessos', email))
      ])
      if (current !== sequence) return
      if (!commission.exists() || commission.data().ativo !== true
          || !toolAccess.exists() || toolAccess.data().ativo !== true) {
        returnToPanel()
        return
      }

      // Permite ao Firestore do quadro usar a mesma pessoa já validada pelo painel.
      // A sessão desse segundo app expira ao fechar a aba, sem pedir novo login.
      await setPersistence(boardAuth, browserSessionPersistence)
      await updateCurrentUser(boardAuth, user)
      if (current !== sequence) return

      for (const name of ['comissao_acessos', 'tatico_acessos']) {
        permissionUnsubscribes.push(onSnapshot(doc(db, name, email), snapshot => {
          if (current !== sequence) return
          if (!snapshot.exists() || snapshot.data().ativo !== true) returnToPanel()
        }, () => { if (current === sequence) returnToPanel() }))
      }
      await openBoard()
    } catch (error) {
      if (current !== sequence) return
      console.error('Falha na validação de acesso à Comissão:', error)
      loadingError('Não foi possível validar a sessão. Volte ao painel e tente novamente.')
    }
  })
}
