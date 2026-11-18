import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_DESCRIPTORS, createMcpTools, calculateOverdue } from '../src/mcp-tools.js';
import { handleMcpHttp, handleMcpMessage } from '../src/mcp-http.js';
import { createHandler } from '../src/index.js';
import { AccessError } from '../src/auth.js';
const identity={email:'tester@example.com'};
const items=[
 {id:'t1',title:'Atrasada',dueDate:'2026-11-16',status:'todo',assignees:[{email:'tester@example.com'}]},
 {id:'t2',title:'Concluída',dueDate:'2026-11-01',status:'done'},
 {id:'t3',title:'Hoje',dueDate:'2026-11-18',status:'todo'},
 {id:'t4',title:'Excluída',dueDate:'2026-11-12',status:'doing',deleted:true},
 {id:'t5',title:'Outro membro',dueDate:'2026-11-03',status:'doing',assignees:[{email:'other@example.com'}]}
];
const list=async()=>({items,nextPageToken:null});
const clock=()=>new Date('2026-11-18T14:00:00Z');
const tools=createMcpTools({identity,list,preview:async()=>({persisted:false})});
const rpc=(method,params,id=1)=>({jsonrpc:'2.0',id,method,params});
const req=(data,other={})=>new Request('https://mcp.example/mcp',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json',...other},body:JSON.stringify(data)});
test('catálogo MCP não possui ferramentas de edição/exclusão/conclusão',()=>{
 assert.equal(TOOL_DESCRIPTORS.length,6);
 assert(!TOOL_DESCRIPTORS.some(t=>/editar|excluir|concluir|confirmar_criacao/.test(t.name)));
});
test('relatório filtra concluídas, excluídas e atrasadas',async()=>{
 const r=await calculateOverdue({list,identity,clock});
 assert.equal(r.hoje,'2026-11-18');assert.equal(r.quantidadeAtrasadas,2);
 assert.deepEqual(r.demandas.map(t=>t.id),['t1','t5']);
});
test('relatório minhas demandas respeita email autenticado',async()=>{
 const r=await calculateOverdue({list,identity,clock,options:{apenasMinhas:true}});
 assert.deepEqual(r.demandas.map(t=>t.id),['t1']);
});
test('limite de 20 páginas não produz total falso',async()=>{
 let n=0;
 const r=await calculateOverdue({list:async()=>({items:[{id:'x'+n++,dueDate:'2026-11-10',status:'todo'}],nextPageToken:'page'+n}),identity,clock});
 assert.equal(r.resultadoCompleto,false);
 assert.equal(r.quantidadeAtrasadasParcial,20);
});
test('prévia nunca grava, e não é possível confirmar pelo MCP',async()=>{
 let calls=0;
 const instance=createMcpTools({list,identity,preview:async()=>{calls++;return {persisted:false};}});
 const result=await instance.execute('preparar_criacao',{tipo:'plans',rascunho:{name:'Teste'},chaveIdempotencia:'uniqueOperationKey123'});
 assert.equal(calls,1);assert.equal(result.gravado,false);
 await assert.rejects(instance.execute('confirmar_criacao',{}),{code:'invalid_arguments'});
});
test('handshake, catálogo e consulta JSON-RPC',async()=>{
 const initialize=await handleMcpMessage(rpc('initialize',{}),{tools});
 assert.equal(initialize.result.protocolVersion,'2025-11-25');
 const catalog=await handleMcpMessage(rpc('tools/list',{}),{tools});
 assert.equal(catalog.result.tools.length,6);
 const result=await handleMcpHttp(req(rpc('tools/call',{name:'listar_planos',arguments:{}})),{tools});
 assert.equal(result.status,200);assert.equal((await result.json()).result.isError,false);
});
test('rejeita ferramentas inexistentes, lotes e origens externas',async()=>{
 const bad=await handleMcpMessage(rpc('tools/call',{name:'excluir_demanda',arguments:{}}),{tools});
 assert.equal(bad.error.code,-32602);
 assert.equal((await handleMcpHttp(req([rpc('ping')]),{tools})).status,400);
 assert.equal((await handleMcpHttp(req(rpc('ping'),{Origin:'https://evil.example'}),{tools})).status,403);
});
test('notificação não tem resposta e métodos ilegais são recusados',async()=>{
 assert.equal(await handleMcpMessage({jsonrpc:'2.0',method:'notifications/initialized'},{tools}),null);
 assert.equal((await handleMcpMessage(rpc('delete',{}),{tools})).error.code,-32601);
});

test('gateway MCP fica desligado por padrão',async()=>{
 const handler=createHandler({
  verifyToken:async()=>({uid:'u1',email:'tester@example.com'}),
  lookupMembership:async()=>({authorized:true})
 });
 const request=req(rpc('tools/list',{}));
 const response=await handler(request,{});
 assert.equal(response.status,404);
});
test('gateway experimental verifica Firebase e autorização a cada mensagem',async()=>{
 let membership=0,writes=0;
 const handler=createHandler({
  verifyToken:async()=>({uid:'u1',email:'tester@example.com'}),
  lookupMembership:async()=>{membership++;return {authorized:true};},
  listItems:async()=>({items:[],nextPageToken:null}),
  createRecord:async()=>{writes++;return {created:true};}
 });
 const original=req(rpc('tools/list',{}));
 const response=await handler(new Request(original.url,{
  method:'POST',headers:{...Object.fromEntries(original.headers),Authorization:'Bearer valid-token'},
  body:JSON.stringify(rpc('tools/list',{}))
 }),{MCP_FIREBASE_DEV_ONLY:'true'});
 assert.equal(response.status,200);
 assert.equal((await response.json()).result.tools.length,6);
 assert.equal(membership,1);
 assert.equal(writes,0);
});
test('gateway MCP recusa membro desativado e chamada sem login',async()=>{
 const handler=createHandler({
  verifyToken:async()=>({uid:'u1',email:'tester@example.com'}),
  lookupMembership:async()=>{throw new AccessError(403,'not_authorized');}
 });
 const noToken=await handler(req(rpc('tools/list',{})),{MCP_FIREBASE_DEV_ONLY:'true'});
 assert.equal(noToken.status,401);
 const raw=req(rpc('tools/list',{}));
 const bad=new Request(raw.url,{method:'POST',headers:{...Object.fromEntries(raw.headers),Authorization:'Bearer x'},body:JSON.stringify(rpc('tools/list',{}))});
 const denied=await handler(bad,{MCP_FIREBASE_DEV_ONLY:'true'});
 assert.equal(denied.status,403);
});
