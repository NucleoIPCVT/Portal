import test from 'node:test';
import assert from 'node:assert/strict';
import { exchangeGoogleIdForFirebase } from '../src/google-firebase-bridge.js';
import { AccessError } from '../src/auth.js';
import { createHandler } from '../src/index.js';

const googleIdToken = 'a'.repeat(120)+'.'+'b'.repeat(120)+'.'+'c'.repeat(120);
const firebaseToken = 'firebase-id-token-do-projeto-'+('X'.repeat(150));
const firebaseApiKey = 'AIza1234567890ABCDEFGHIJKLMNOPQRSTUVW';
const identity = { uid: 'uid-preexistente', email: 'membro@example.com' };

test('troca credencial Google validada pelo Firebase e confere membro ativo', async()=>{
  let requests=0,verified=0,authorized=0;
  const actual=await exchangeGoogleIdForFirebase(googleIdToken,{
    firebaseApiKey,
    fetchImpl:async (url,init)=>{
      requests++;
      assert.equal(init.method,'POST');
      assert.match(url,/identitytoolkit\.googleapis\.com\/v1\/accounts:signInWithIdp/);
      const body=JSON.parse(init.body);
      assert.equal(new URLSearchParams(body.postBody).get('providerId'),'google.com');
      assert.equal(new URLSearchParams(body.postBody).get('id_token'),googleIdToken);
      assert.equal(body.returnRefreshToken,false);
      assert.equal(body.returnIdpCredential,false);
      assert.equal(body.requestUri,'http://localhost');
      return new Response(JSON.stringify({
        providerId:'google.com',idToken:firebaseToken,
        refreshToken:'should-not-escape'
      }),{status:200});
    },
    verifyToken:async token=>{verified++;assert.equal(token,firebaseToken);return identity;},
    checkMembership:async (email,token)=>{
      authorized++;assert.equal(email,identity.email);assert.equal(token,firebaseToken);
    }
  });
  assert.equal(requests,1);assert.equal(verified,1);assert.equal(authorized,1);
  assert.deepEqual(actual,{identity,firebaseIdToken:firebaseToken});
  assert(!JSON.stringify(actual).includes('should-not-escape'));
});
test('recusa ID Google malformado antes de contactar a rede',async()=>{
  for(const value of ['','not-a-jwt','a.b.c','a/'.repeat(200),null]){
    await assert.rejects(exchangeGoogleIdForFirebase(value,{
      firebaseApiKey,fetchImpl:async()=>{throw Error('never call');}
    }),{status:401});
  }
});
test('sem configuração OAuth/Firebase não tenta autenticar',async()=>{
  await assert.rejects(exchangeGoogleIdForFirebase(googleIdToken,{}),{status:503});
});
test('falhas do Firebase não vazam credenciais ou mensagens internas',async()=>{
  for(const status of [400,401,403,500]){
    const result=exchangeGoogleIdForFirebase(googleIdToken,{
      firebaseApiKey,
      fetchImpl:async()=>new Response(JSON.stringify({error:{message:'SECRET KEY'}}),{status})
    });
    await assert.rejects(result,{status:status>=500?503:401});
  }
});
test('mesmo Google sem autorização da Comissão continua bloqueado',async()=>{
  let calls=0;
  await assert.rejects(exchangeGoogleIdForFirebase(googleIdToken,{
    firebaseApiKey,fetchImpl:async()=>new Response(JSON.stringify({providerId:'google.com',idToken:firebaseToken}),{status:200}),
    verifyToken:async()=>identity,
    checkMembership:async()=>{calls++;throw new AccessError(403,'not_authorized');}
  }),{status:403});
  assert.equal(calls,1);
});
test('e-mail enviado por Sites não substitui o token Firebase',async()=>{
  const h=createHandler({verifyToken:async()=>{throw Error('should not verify');}});
  const request=new Request('https://worker.example/api/plans',{
    headers:{'oai-authenticated-user-email':'membro@example.com'}
  });
  const result=await h(request);
  assert.equal(result.status,401);
  assert.deepEqual(await result.json(),{error:'authentication_required'});
});
