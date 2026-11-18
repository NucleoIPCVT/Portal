import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {AccessError,firebaseBearerToken,verifyFirebaseIdToken,readCommissionMembership,PROJECT_ID} from '../src/auth.js';
import {createHandler} from '../src/index.js';

const b64url=input=>Buffer.from(JSON.stringify(input)).toString('base64url');
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256',use:'sig'};
const time=1800000000;
const claims={
  aud:PROJECT_ID,iss:'https://securetoken.google.com/'+PROJECT_ID,
  sub:'firebase-user-123',email:'Tester@Example.com',email_verified:true,
  firebase:{sign_in_provider:'google.com'},
  iat:time-10,exp:time+3500,auth_time:time-3600
};
const createToken=(payload=claims,header={alg:'RS256',kid:'test-key',typ:'JWT'})=>{
  const message=b64url(header)+'.'+b64url(payload);
  return message+'.'+sign('RSA-SHA256',Buffer.from(message),privateKey).toString('base64url');
};
const verifier=(token,{getJwks=async()=>[jwk]}={})=>verifyFirebaseIdToken(token,{getJwks,now:()=>time});
const req=(path,method='GET',token)=>new Request('https://worker.example'+path,{
  method,headers:token?{Authorization:'Bearer '+token}:{}
});
test('token Firebase valido assinado por chave confiavel',async()=>{
  assert.deepEqual(await verifier(createToken()),{uid:'firebase-user-123',email:'tester@example.com'});
});
test('rejeita token adulterado',async()=>{
  const parts=createToken().split('.');
  const tampered=parts[0]+'.'+b64url({...claims,sub:'another'})+'.'+parts[2];
  await assert.rejects(verifier(tampered),{status:401});
});
test('rejeita issuer, audiencia, vencimento, provedor e email incorretos',async()=>{
  for(const changed of [
    {iss:'https://securetoken.google.com/other'},{aud:'other'},
    {exp:time-1},{iat:time+1},{auth_time:time+1},
    {email_verified:false},{firebase:{sign_in_provider:'password'}}
  ])await assert.rejects(verifier(createToken({...claims,...changed})),{status:401});
});
test('rejeita alg inseguro e chave desconhecida',async()=>{
  await assert.rejects(verifier(createToken(claims,{alg:'none',kid:'test-key'})),{status:401});
  await assert.rejects(verifier(createToken(),{getJwks:async()=>[]}),{status:401});
});
test('exige Bearer Firebase',()=>{
  assert.throws(()=>firebaseBearerToken(req('/api/session')),{status:401});
  assert.throws(()=>firebaseBearerToken(new Request('https://worker.example',{
    headers:{Authorization:'Basic abc'}
  })),{status:401});
});
test('consulta autorizacao com token do usuario e nao credencial admin',async()=>{
  let called=false;
  const result=await readCommissionMembership('tester@example.com','fake-token',{
    fetchImpl:async(url,opts)=>{
      called=true;
      assert.match(url,/comissao_acessos\/tester%40example.com$/);
      assert.equal(opts.headers.Authorization,'Bearer fake-token');
      return new Response(JSON.stringify({fields:{ativo:{booleanValue:true}}}),{status:200});
    }
  });
  assert.ok(called);
  assert.deepEqual(result,{authorized:true});
});
test('bloqueia membro inativo, inexistente ou proibido',async()=>{
  for(const response of [
    new Response(JSON.stringify({fields:{ativo:{booleanValue:false}}}),{status:200}),
    new Response('',{status:404}),new Response('',{status:403})
  ])await assert.rejects(readCommissionMembership('tester@example.com','x',{
    fetchImpl:async()=>response
  }),{status:403});
});
test('sessao apenas depois de token valido e autorizacao',async()=>{
  const handle=createHandler({
    verifyToken:token=>verifier(token),
    lookupMembership:async email=>assert.equal(email,'tester@example.com')
  });
  const response=await handle(req('/api/session','GET',createToken()));
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{
    authenticated:true,authorized:true,uid:'firebase-user-123',
    email:'tester@example.com',capabilities:['read']
  });
  assert.equal(response.headers.get('access-control-allow-origin'),null);
});
test('bloqueia login ausente, escrita e outras rotas',async()=>{
  const handle=createHandler();
  assert.equal((await handle(req('/api/session'))).status,401);
  for(const method of ['POST','PUT','PATCH','DELETE'])
    assert.equal((await handle(req('/api/session',method))).status,405);
  for(const path of ['/api/plans','/api/tasks'])
    assert.equal((await handle(req(path))).status,401);
  for(const path of ['/mcp','/'])
    assert.equal((await handle(req(path))).status,404);
});
test('sessao recusa membro sem autorizacao',async()=>{
  const handle=createHandler({
    verifyToken:token=>verifier(token),
    lookupMembership:async()=>{throw new AccessError(403,'not_authorized');}
  });
  const response=await handle(req('/api/session','GET',createToken()));
  assert.equal(response.status,403);
  assert.deepEqual(await response.json(),{error:'not_authorized'});
});
