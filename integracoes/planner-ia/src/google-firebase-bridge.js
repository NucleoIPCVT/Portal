// Troca uma credencial Google ID já obtida por OAuth seguro por um ID token
// do Firebase *existente*. Não implementa login nem aceita cabeçalhos ChatGPT
// como prova de identidade. NUNCA expor esta função diretamente como tool MCP.
import { AccessError, verifyFirebaseIdToken, readCommissionMembership } from './auth.js';

const GOOGLE_ID_TOKEN_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const FIREBASE_API_KEY_RE = /^[A-Za-z0-9_-]{20,100}$/;

export async function exchangeGoogleIdForFirebase(
  googleIdToken,
  { firebaseApiKey, fetchImpl = fetch,
    verifyToken = verifyFirebaseIdToken,
    checkMembership = readCommissionMembership } = {}
) {
  // O Google ID token deve vir de callback OAuth concluído pelo servidor.
  // O componente responsável pelo OAuth deve validar state, nonce, PKCE
  // (quando aplicável), redirect_uri e o cliente autorizado.
  if (typeof googleIdToken !== 'string' || googleIdToken.length > 8192
      || !GOOGLE_ID_TOKEN_RE.test(googleIdToken)) {
    throw new AccessError(401, 'invalid_google_credential');
  }
  if (typeof firebaseApiKey !== 'string' || !FIREBASE_API_KEY_RE.test(firebaseApiKey)) {
    throw new AccessError(503, 'firebase_bridge_not_configured');
  }

  const endpoint = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key='
    + encodeURIComponent(firebaseApiKey);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        postBody: new URLSearchParams({ id_token: googleIdToken, providerId: 'google.com' }).toString(),
        // Para credencial IdP obtida separadamente, o Firebase permite
        // requestUri localhost. Isto NÃO é um redirecionamento do navegador.
        requestUri: 'http://localhost',
        returnSecureToken: true,
        returnIdpCredential: false,
        returnRefreshToken: false
      }),
      signal: AbortSignal.timeout(8000)
    });
  } catch { throw new AccessError(503, 'firebase_bridge_unavailable'); }

  if ([400,401,403].includes(response.status)) {
    throw new AccessError(401, 'invalid_google_credential');
  }
  if (!response.ok) throw new AccessError(503, 'firebase_bridge_unavailable');

  let data;
  try { data = await response.json(); }
  catch { throw new AccessError(503, 'firebase_bridge_unavailable'); }

  if (data?.providerId !== 'google.com' || typeof data.idToken !== 'string'
      || data.idToken.length > 8192 || data.idToken.length < 100
      || data.needConfirmation === true) {
    throw new AccessError(401, 'invalid_google_credential');
  }

  // Verificação independente: assinatura, projectId, email verificado,
  // provider Google, expiração e autorização existente em comissao_acessos.
  const identity = await verifyToken(data.idToken);
  await checkMembership(identity.email, data.idToken);

  // Somente para uso interno, com vida curta: não transmitir Firebase token
  // como resposta MCP, cookie público, fragmento ou query string.
  // Tokens de atualização recebidos do upstream nunca são persistidos aqui.
  return { identity, firebaseIdToken: data.idToken };
}
