import test from 'node:test';
import assert from 'node:assert/strict';
import {AccessError,PROJECT_ID} from '../src/auth.js';
import {listPlannerDocuments,deserializeDocument,parseReadOptions} from '../src/firestore-read.js';
import {createHandler} from '../src/index.js';
const prefix=(kind,id)=>`projects/${PROJECT_ID}/databases/(default)/documents/comissao_planner/main/${kind}/${id}`;
const doc=(kind,id,fields)=>({name:prefix(kind,id),fields});
const request=(path,method='GET',token='ok')=>new Request('https://worker.example'+path,{method,headers:token?{Authorization:'Bearer '+token}:{}});
const member={verifyToken:async()=>({uid:'u1',email:'member@example.com'}),lookupMembership:async()=>({authorized:true})};
test('converte os tipos do Firestore sem alterar estrutura de tarefas',()=>{
 const task=deserializeDocument(doc('tasks','task-1',{
  title:{stringValue:'Organizar ensaio'},done:{booleanValue:false},status:{stringValue:'doing'},
  version:{integerValue:'3'},dueDate:{stringValue:'2026-11-10'},
  createdAt:{timestampValue:'2026-11-01T00:00:00Z'},
  checklist:{arrayValue:{values:[{mapValue:{fields:{text:{stringValue:'Ajustar som'},done:{booleanValue:false}}}}]}},
  unused:{nullValue:null},arr:{arrayValue:{}},nested:{mapValue:{fields:{deep:{stringValue:'ok'}}}}
 }),'tasks');
 assert.deepEqual(JSON.parse(JSON.stringify(task)),{id:'task-1',title:'Organizar ensaio',done:false,status:'doing',version:3,dueDate:'2026-11-10',createdAt:'2026-11-01T00:00:00Z',checklist:[{text:'Ajustar som',done:false}],unused:null,arr:[],nested:{deep:'ok'}});
});
test('paginação limitada e cursor enviado somente ao Firestore autorizado',async()=>{
 let count=0;
 const result=await listPlannerDocuments('tasks','valid-token',new URLSearchParams('pageSize=2&pageToken=abc%2F%2B%3D'),{fetchImpl:async(url,opts)=>{
  count++;
  assert.match(url,/comissao_planner\/main\/tasks\?/);
  const parsed=new URL(url);assert.equal(parsed.searchParams.get('pageToken'),'abc/+=');
  assert.equal(parsed.searchParams.get('pageSize'),'2');
  assert.equal(opts.headers.Authorization,'Bearer valid-token');
  return new Response(JSON.stringify({documents:[doc('tasks','t1',{status:{stringValue:'todo'}})],nextPageToken:'next-page'}),{status:200});
 }});
 assert.equal(count,1);assert.deepEqual(result,{kind:'tasks',pageSize:2,items:[{id:'t1',status:'todo'}],nextPageToken:'next-page',hasMore:true});
});
test('lista vazia sem token final',async()=>{
 const value=await listPlannerDocuments('plans','t',new URLSearchParams(),{fetchImpl:async()=>new Response('{}',{status:200})});
 assert.deepEqual(value,{kind:'plans',items:[],pageSize:25,nextPageToken:null,hasMore:false});
});
test('recusa paginação malformada, cursor grande e filtros arbitrários',()=>{
 for(const query of ['pageSize=0','pageSize=51','pageSize=-1','pageSize=3.1','pageSize=1&pageSize=2','foo=bar','pageToken='+('a'.repeat(2049))])
  assert.throws(()=>parseReadOptions(new URLSearchParams(query)),AccessError);
});
test('recusa documentos fora da coleção pedida',()=>{
 assert.throws(()=>deserializeDocument(doc('plans','p1',{}),'tasks'),{status:503});
});
test('bloqueia Firestore negado e falha indisponível sem detalhes do banco',async()=>{
 for(const status of [401,403])await assert.rejects(listPlannerDocuments('plans','tok',new URLSearchParams(),{fetchImpl:async()=>new Response('{}',{status})}),{status:403});
 await assert.rejects(listPlannerDocuments('plans','tok',new URLSearchParams(),{fetchImpl:async()=>{throw Error('sensitive detail');}}),{status:503});
});
test('somente membros ativos têm acesso às consultas',async()=>{
 const hit=[];
 const handler=createHandler({...member,listItems:async(kind,token,params)=>{hit.push(kind);return {kind,items:[],hasMore:false,pageSize:25,nextPageToken:null};}});
 for(const kind of ['plans','buckets','tasks','events','routines','activity']){
  const response=await handler(request('/api/'+kind)); assert.equal(response.status,200,kind);
  assert.equal((await response.json()).kind,kind);
  assert.equal(response.headers.get('access-control-allow-origin'),null);
 }
 assert.equal(hit.length,6);
 const denied=createHandler({...member,lookupMembership:async()=>{throw new AccessError(403,'not_authorized');},listItems:async()=>{throw Error('should not execute');}});
 assert.equal((await denied(request('/api/tasks'))).status,403);
 assert.equal((await handler(request('/api/tasks','GET',null))).status,401);
});
test('sem escrita, conclusão, exclusão ou acesso a rotas desconhecidas',async()=>{
 const handler=createHandler({...member});
 for(const method of ['POST','PUT','PATCH','DELETE'])for(const path of ['/api/plans','/api/tasks','/api/activity','/api/session'])
  assert.equal((await handler(request(path,method))).status,405,method+' '+path);
 for(const path of ['/mcp','/api/unknown','/api/tasks/t1','/api/overdue'])
  assert.equal((await handler(request(path))).status,404,path);
});
