import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
const req=(path,method='GET')=>new Request('https://worker.example'+path,{method});
test('health informa apenas disponibilidade',async()=>{
  const response=await worker.fetch(req('/health'));
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'),null);
  assert.deepEqual(await response.json(),{
    service:'ipcvt-planner-ia',status:'auth-development',
    firestoreConnected:false,capabilitiesEnabled:[]
  });
});
test('nenhuma rota de dados ou MCP foi habilitada',async()=>{
  for(const path of ['/','/plans','/tasks','/mcp','/api/plans','/api/tasks']){
    assert.equal((await worker.fetch(req(path))).status,404,path);
  }
});
test('metodos de escrita permanecem bloqueados',async()=>{
  for(const method of ['POST','PUT','PATCH','DELETE'])
    assert.equal((await worker.fetch(req('/api/plans',method))).status,404,method);
});
