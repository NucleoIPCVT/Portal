// Google Identity Services abre a escolha de conta diretamente.
// A credencial continua sendo validada pelo Firebase; não altera autorizações.
export const GOOGLE_CLIENT_ID = '774659782213-7bvortfkfrr9af5opk9mmtat9l695o64.apps.googleusercontent.com'
export const GOOGLE_LOGIN_SCOPES = 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile'

const authError = code => Object.assign(new Error('Não foi possível concluir o acesso com Google.'), { code })

export function createGoogleLogin({ getAccounts, credentialFromAccessToken, signInWithCredential, fallback }) {
  return function login(auth) {
    const accounts = getAccounts()
    // A indisponibilidade do novo SDK não elimina o fluxo já existente.
    if (!accounts?.oauth2?.initTokenClient) return fallback(auth)
    return new Promise((resolve, reject) => {
      let settled = false
      const fail = code => {
        if (settled) return
        settled = true
        reject(authError(code))
      }
      try {
        const client = accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: GOOGLE_LOGIN_SCOPES,
          include_granted_scopes: false,
          prompt: 'select_account',
          callback: response => {
            if (settled) return
            if (response.error || !response.access_token) {
              fail(response.error === 'access_denied' ? 'auth/cancelled-popup-request' : 'auth/invalid-credential')
              return
            }
            // O token só permanece na memória até sua troca por uma sessão Firebase.
            settled = true
            try {
              const credential = credentialFromAccessToken(response.access_token)
              Promise.resolve(signInWithCredential(auth, credential)).then(resolve, reject)
            } catch (error) { reject(error) }
          },
          error_callback: error => fail({
            popup_failed_to_open: 'auth/popup-blocked',
            popup_closed: 'auth/popup-closed-by-user'
          }[error?.type] || 'auth/internal-error')
        })
        // Executa no próprio clique, sem esperar rede, persistência ou outro await.
        client.requestAccessToken({ prompt: 'select_account' })
      } catch (error) { settled = true; reject(error) }
    })
  }
}
