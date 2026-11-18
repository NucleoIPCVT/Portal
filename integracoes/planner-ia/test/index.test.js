import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
const req=(path,method='GET')=>new Request('https://worker.example'+path,{method});
test('health informa somente disponibilidade em desenvolvimento',async()=>{
  const response=await worker.fetch(req('/health'));
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'),null);
  assert.deepEqual(await response.json(),{
    service:'ipcvt-planner-ia',status:'creation-development',
    firestoreConnected:false,capabilitiesEnabled:[]
  });
});
test('rotas de consulta exigem autenticação e MCP não foi habilitado',async()=>{
  for(const path of ['/','/plans','/tasks','/mcp'])
    assert.equal((await worker.fetch(req(path))).status,404,path);
  for(const path of ['/api/plans','/api/buckets','/api/tasks','/api/events','/api/routines','/api/activity'])
    assert.equal((await worker.fetch(req(path))).status,401,path);
});
test('métodos de escrita continuam proibidos',async()=>{
  for(const method of ['POST','PUT','PATCH','DELETE'])
    assert.equal((await worker.fetch(req('/api/plans',method))).status,405,method);
});
