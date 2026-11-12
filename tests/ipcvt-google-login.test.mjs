import test from 'node:test'
import assert from 'node:assert/strict'
import { createGoogleLogin, GOOGLE_LOGIN_SCOPES } from '../ipcvt-google-login.js'

function setup(overrides = {}) {
  let options, requested = false
  const calls = []
  const dependencies = {
    getAccounts: () => ({ oauth2: { initTokenClient(config) {
      options = config
      return { requestAccessToken(config) { requested = true; calls.push(['open', config]) } }
    } } }),
    credentialFromAccessToken: token => ({ token }),
    signInWithCredential: async (auth, credential) => { calls.push(['firebase', auth, credential]); return { user: { uid: 'verified-user' } } },
    fallback: async auth => { calls.push(['fallback', auth]); return { user: { uid: 'existing-flow' } } },
    ...overrides
  }
  return { login: createGoogleLogin(dependencies), calls, get options() { return options }, get requested() { return requested } }
}

test('abre a escolha de conta no mesmo gesto e solicita apenas os dados básicos já usados', async () => {
  const env = setup()
  const auth = {}
  const pending = env.login(auth)
  assert.equal(env.requested, true)
  assert.equal(env.options.scope, GOOGLE_LOGIN_SCOPES)
  assert.equal(env.options.include_granted_scopes, false)
  assert.equal(env.options.prompt, 'select_account')
  assert.ok(!env.options.scope.includes('calendar'))
  env.options.callback({ access_token: 'test-only-token' })
  const result = await pending
  assert.equal(result.user.uid, 'verified-user')
  assert.deepEqual(env.calls[1], ['firebase', auth, { token: 'test-only-token' }])
})

test('mantém o login existente quando o SDK do Google está indisponível', async () => {
  const env = setup({ getAccounts: () => undefined })
  assert.equal((await env.login({})).user.uid, 'existing-flow')
  assert.equal(env.calls[0][0], 'fallback')
})

for (const [type, code] of [['popup_failed_to_open', 'auth/popup-blocked'], ['popup_closed', 'auth/popup-closed-by-user']]) {
  test('permite tentar novamente após ' + type, async () => {
    const env = setup()
    const pending = env.login({})
    env.options.error_callback({ type })
    await assert.rejects(pending, { code })
    assert.equal(env.calls.length, 1)
  })
}

test('não cria sessão quando o Google recusa o acesso ou omite a credencial', async () => {
  for (const response of [{ error: 'access_denied' }, {}]) {
    const env = setup()
    const pending = env.login({})
    env.options.callback(response)
    await assert.rejects(pending)
    assert.ok(env.calls.every(([name]) => name !== 'firebase'))
  }
})

test('só libera a sessão depois da validação do Firebase e preserva seus erros', async () => {
  const env = setup({ signInWithCredential: async () => { throw Object.assign(new Error('Teste'), { code: 'auth/invalid-credential' }) } })
  const pending = env.login({})
  env.options.callback({ access_token: 'test-only-token' })
  await assert.rejects(pending, { code: 'auth/invalid-credential' })
})

test('descarta respostas tardias depois de fechar a janela', async () => {
  const env = setup()
  const pending = env.login({})
  env.options.error_callback({ type: 'popup_closed' })
  env.options.callback({ access_token: 'test-only-token' })
  await assert.rejects(pending)
  assert.ok(env.calls.every(([name]) => name !== 'firebase'))
})
