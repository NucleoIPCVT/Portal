import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDraft,normalizeDraft,draftHash,stableDocumentId,createPlannerDocument} from '../src/create.js';
import {verifyApprovalReceipt} from '../src/approval.js';
import {createHandler} from '../src/index.js';
import {AccessError} from '../src/auth.js';

const identity={uid:'uid123',email:'user@example.com'};
const key='operationKey123456789';
const secret='test_only_a_very_long_unique_secret_for_approval';
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const request=(path,body)=>new Request('https://worker.example'+path,{
  method:'POST',headers:{Authorization:'Bearer valid-token','Content-Type':'application/json'},
  body:JSON.stringify(body)
});
const deps={
  verifyToken:async()=>identity,
  lookupMembership:async()=>({authorized:true})
};
async function receipt(kind,normalized,changes={}){
  const time=Math.floor(Date.now()/1000);
  const body={iss:'ipcvt-human-approval',aud:'ipcvt-planner-create-v1',
    uid:identity.uid,email:identity.email,kind,idempotencyKey:key,
    draftHash:await draftHash(normalized),iat:time-5,exp:time+300,...changes};
  const payload=b64(body);
  const hmac=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=await crypto.subtle.sign('HMAC',hmac,new TextEncoder().encode(payload));
  return payload+'.'+Buffer.from(signature).toString('base64url');
}
test('valida dados dos planos sem exigir nova regra Firebase',()=>{
  assert.deepEqual(validateDraft('plans',{name:' Culto de Acao de Gracas ',dueDate:'2026-11-26'}),{
    name:'Culto de Acao de Gracas',kind:'project',description:'',startDate:'',dueDate:'2026-11-26',deleted:false
  });
});
test('impede status concluido, recorrencia e metadados falsos',()=>{
  for(const [kind,draft] of [
    ['plans',{name:'X',ownerEmail:'fake@example.com'}],
    ['plans',{name:'X',kind:'recurring'}],
    ['plans',{name:'X',dueDate:'2026-02-29'}],
    ['tasks',{planId:'plan-1',title:'X',status:'done'}],
    ['tasks',{planId:'plan-1',title:'X',checklist:[{text:'X',done:true}]}],
    ['buckets',{planId:'plan-1',name:'X',order:-1}]
  ])assert.throws(()=>validateDraft(kind,draft),{status:400});
});
test('checklist e identificadores nao duplicam em repeticoes',async()=>{
  const draft={planId:'plan-1',title:'Comprar materiais',checklist:[{text:'Comprar cabos'}]};
  const once=await normalizeDraft('tasks',draft,key),twice=await normalizeDraft('tasks',draft,key);
  assert.deepEqual(once,twice);
  assert.equal(once.status,'todo');assert.equal(once.checklist[0].done,false);
  assert.equal(await stableDocumentId(identity.uid,'plans',key),await stableDocumentId(identity.uid,'plans',key));
  assert.notEqual(await stableDocumentId(identity.uid,'plans',key),await stableDocumentId('another','plans',key));
});
test('aprovacao vinculada a conta, conteudo e prazo',async()=>{
  const draft=await normalizeDraft('plans',{name:'Teste'},key);
  const context={...identity,kind:'plans',idempotencyKey:key,draftHash:await draftHash(draft)};
  const proof=await receipt('plans',draft);
  assert.equal(await verifyApprovalReceipt(proof,context,secret),true);
  await assert.rejects(verifyApprovalReceipt(proof,{...context,uid:'attacker'},secret),{status:403});
  await assert.rejects(verifyApprovalReceipt(proof,{...context,draftHash:'changed'},secret),{status:403});
  await assert.rejects(verifyApprovalReceipt(proof,context,undefined),{status:503});
  await assert.rejects(verifyApprovalReceipt(proof+'garbage',context,secret),{status:403});
});
test('preview autenticado nao realiza escrita',async()=>{
  let writes=0;
  const handler=createHandler({...deps,createRecord:async()=>{writes++;}});
  const response=await handler(request('/api/preview/plans',{idempotencyKey:key,draft:{name:'Teste'}}));
  assert.equal(response.status,200);
  assert.equal((await response.json()).requiresHumanApproval,true);
  assert.equal(writes,0);
});
test('criacao sem assinante humano configurado e impossivel',async()=>{
  let writes=0;
  const handler=createHandler({...deps,createRecord:async()=>{writes++;}});
  const response=await handler(request('/api/create/plans',{idempotencyKey:key,draft:{name:'Teste'}}));
  assert.equal(response.status,503);
  assert.equal(writes,0);
});
test('registro e auditoria vao juntos em um commit atomicamente',async()=>{
  const normalized=await normalizeDraft('plans',{name:'Teste'},key);
  let count=0;
  const result=await createPlannerDocument('plans',normalized,identity,key,'auth-token',{
    fetchImpl:async(url,opts)=>{
      count++;
      assert.match(url,/\/documents:commit$/);
      const body=JSON.parse(opts.body);
      assert.equal(body.writes.length,2);
      assert.equal(body.writes[0].currentDocument.exists,false);
      assert.equal(body.writes[1].currentDocument.exists,false);
      assert.equal(body.writes[0].update.fields.createdBy.stringValue,identity.email);
      assert.equal(body.writes[0].updateTransforms[0].setToServerValue,'REQUEST_TIME');
      assert.equal(body.writes[1].update.fields.action.stringValue,'created');
      return new Response('{}',{status:200});
    }
  });
  assert.equal(result.created,true);assert.equal(count,1);
  await assert.rejects(createPlannerDocument('plans',normalized,identity,key,'auth-token',{
    fetchImpl:async()=>new Response('{}',{status:409})
  }),{status:409});
});
test('sem autorizacao Google nenhuma escrita acontece',async()=>{
  let writes=0;
  const handler=createHandler({...deps,
    lookupMembership:async()=>{throw new AccessError(403,'not_authorized');},
    createRecord:async()=>{writes++;}
  });
  const response=await handler(request('/api/create/plans',{idempotencyKey:key,draft:{name:'Teste'}}));
  assert.equal(response.status,403);assert.equal(writes,0);
});
test('nenhuma rota para editar, excluir ou concluir',async()=>{
  const handler=createHandler(deps);
  for(const route of ['/api/edit/tasks','/api/delete/tasks','/api/complete/tasks']){
    assert.equal((await handler(request(route,{}))).status,404,route);
  }
});
