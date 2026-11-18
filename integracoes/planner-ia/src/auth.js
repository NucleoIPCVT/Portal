// Validacao do Firebase ID token existente; sem criar um novo login.
export const PROJECT_ID = 'repertorio-ipcvt';
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
export class AccessError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
function decodeBase64Url(input) {
  if(typeof input !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(input)) throw new AccessError(401,'invalid_token');
  const rem=input.length%4;
  if(rem===1) throw new AccessError(401,'invalid_token');
  try {
    return Uint8Array.from(atob(input.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-rem)%4)),c=>c.charCodeAt(0));
  }catch{throw new AccessError(401,'invalid_token');}
}
function parseSection(part) {
  try{
    const obj=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decodeBase64Url(part)));
    if(!obj||typeof obj!=='object'||Array.isArray(obj)) throw Error('invalid');
    return obj;
  }catch{throw new AccessError(401,'invalid_token');}
}
let keyCache={keys:null,until:0};
async function loadGoogleJwks(force=false) {
  const now=Date.now();
  if(!force&&keyCache.keys&&now<keyCache.until)return keyCache.keys;
  let response;
  try{
    response=await fetch(GOOGLE_JWKS_URL,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(5000)});
  }catch{throw new AccessError(503,'identity_provider_unavailable');}
  if(!response.ok)throw new AccessError(503,'identity_provider_unavailable');
  let json;
  try{json=await response.json();}catch{throw new AccessError(503,'identity_provider_unavailable');}
  if(!Array.isArray(json?.keys)||json.keys.length===0||json.keys.length>30)throw new AccessError(503,'identity_provider_unavailable');
  const maxAge=Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/i)?.[1]||300);
  keyCache={keys:json.keys,until:now+Math.min(Math.max(maxAge,30),3600)*1000};
  return json.keys;
}
export function firebaseBearerToken(request){
  const value=request.headers.get('authorization');
  if(!value||!/^Bearer [A-Za-z0-9._-]+$/.test(value))throw new AccessError(401,'authentication_required');
  const token=value.slice(7);
  if(token.length>8192)throw new AccessError(401,'invalid_token');
  return token;
}
export async function verifyFirebaseIdToken(token,{getJwks=loadGoogleJwks,now=()=>Math.floor(Date.now()/1000)}={}){
  if(typeof token!=='string'||token.length>8192||token.length<100)throw new AccessError(401,'invalid_token');
  const parts=token.split('.');
  if(parts.length!==3)throw new AccessError(401,'invalid_token');
  const [first,second,third]=parts;
  const header=parseSection(first),p=parseSection(second),current=now();
  if(header.alg!=='RS256'||typeof header.kid!=='string'||!header.kid||header.kid.length>200
    ||p.iss!=='https://securetoken.google.com/'+PROJECT_ID||p.aud!==PROJECT_ID
    ||typeof p.sub!=='string'||!p.sub||p.sub.length>128
    ||!Number.isInteger(p.iat)||p.iat<=0||p.iat>current
    ||!Number.isInteger(p.exp)||p.exp<=current
    ||!Number.isInteger(p.auth_time)||p.auth_time<=0||p.auth_time>current
    ||typeof p.email!=='string'||p.email.length>254
    ||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)
    ||p.email_verified!==true||p.firebase?.sign_in_provider!=='google.com')
    throw new AccessError(401,'invalid_token');
  const keys=await getJwks(false);
  let jwk=keys.find(k=>k.kid===header.kid);
  if(!jwk)jwk=(await getJwks(true)).find(k=>k.kid===header.kid);
  if(!jwk||jwk.kty!=='RSA'||typeof jwk.n!=='string'||typeof jwk.e!=='string'
    ||jwk.d!==undefined||(jwk.alg&&jwk.alg!=='RS256')||(jwk.use&&jwk.use!=='sig'))
    throw new AccessError(401,'invalid_token');
  try{
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decodeBase64Url(third),new TextEncoder().encode(first+'.'+second));
    if(!valid)throw Error('bad_signature');
  }catch{throw new AccessError(401,'invalid_token');}
  return {uid:p.sub,email:p.email.toLowerCase()};
}
export async function readCommissionMembership(email,token,{fetchImpl=fetch}={}){
  const url='https://firestore.googleapis.com/v1/projects/'+PROJECT_ID+'/databases/(default)/documents/comissao_acessos/'+encodeURIComponent(email);
  let response;
  try{
    response=await fetchImpl(url,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(5000)});
  }catch{throw new AccessError(503,'authorization_unavailable');}
  if([401,403,404].includes(response.status))throw new AccessError(403,'not_authorized');
  if(!response.ok)throw new AccessError(503,'authorization_unavailable');
  let data;
  try{data=await response.json();}catch{throw new AccessError(503,'authorization_unavailable');}
  if(data?.fields?.ativo?.booleanValue!==true)throw new AccessError(403,'not_authorized');
  return {authorized:true};
}
