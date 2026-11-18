import { AccessError } from './auth.js';

function b64(input) {
  if (typeof input !== 'string' || !/^[A-Za-z0-9_-]+$/.test(input) || input.length > 4096) throw new AccessError(403, 'approval_required');
  const padding = '='.repeat((4 - input.length % 4) % 4);
  try { return Uint8Array.from(atob(input.replace(/-/g,'+').replace(/_/g,'/') + padding), c => c.charCodeAt(0)); }
  catch { throw new AccessError(403, 'approval_required'); }
}
export async function verifyApprovalReceipt(receipt, context, secret, { now = () => Math.floor(Date.now()/1000) } = {}) {
  // A IA nao pode emitir receipts. Um fluxo separado, com clique humano no navegador
  // e identidade verificada, sera necessario na etapa MCP/OAuth.
  if (typeof secret !== 'string' || new TextEncoder().encode(secret).length < 32)
    throw new AccessError(503, 'approval_not_configured');
  if (typeof receipt !== 'string' || receipt.length > 6000) throw new AccessError(403,'approval_required');
  const parts = receipt.split('.');
  if (parts.length !== 2) throw new AccessError(403,'approval_required');
  let claims;
  try { claims = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b64(parts[0]))); }
  catch { throw new AccessError(403,'approval_required'); }
  const moment = now();
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)
      || claims.iss !== 'ipcvt-human-approval' || claims.aud !== 'ipcvt-planner-create-v1'
      || claims.uid !== context.uid || claims.email !== context.email || claims.kind !== context.kind
      || claims.idempotencyKey !== context.idempotencyKey || claims.draftHash !== context.draftHash
      || !Number.isInteger(claims.iat) || claims.iat > moment || !Number.isInteger(claims.exp)
      || claims.exp <= moment || claims.exp > moment + 600 || claims.exp > claims.iat + 600)
    throw new AccessError(403,'approval_required');
  try {
    const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{ name: 'HMAC', hash: 'SHA-256' },false,['verify']);
    const ok = await crypto.subtle.verify('HMAC',key,b64(parts[1]),new TextEncoder().encode(parts[0]));
    if (!ok) throw new Error('invalid_signature');
  } catch { throw new AccessError(403,'approval_required'); }
  return true;
}
