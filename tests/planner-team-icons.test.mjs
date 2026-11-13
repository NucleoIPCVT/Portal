import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TEAM_METADATA_PREFIX,TEAM_ICON_PRESETS,normalizedTeamName,
  teamMetadataTask,parseTeamMetadata
} from '../planner-team-icons.js'

const name='Fotografia e Vídeo'
const icon={type:'preset',value:'screen'}
const id=TEAM_METADATA_PREFIX+'abcd1234'

test('grava equipe em registro técnico sem criar uma demanda visível',()=>{
  const record=teamMetadataTask(name,icon,'plano',id)
  assert.equal(record.deleted,true)
  assert.equal(record.team,name)
  assert.equal(record.planId,'plano')
  assert.equal(record.dueDate,'')
  assert.deepEqual(record.assignees,[])
  const restored=parseTeamMetadata(record)
  assert.equal(restored.name,name)
  assert.deepEqual(restored.icon,icon)
})
test('preserva a versão existente e aceita mudança de ícone',()=>{
  const first=teamMetadataTask(name,icon,'plano',id)
  const older={...first,version:4,createdBy:'admin@example.test'}
  const second=teamMetadataTask(name,{type:'preset',value:'music'},'plano',id,older)
  assert.equal(second.version,4)
  assert.equal(second.createdBy,'admin@example.test')
  assert.equal(parseTeamMetadata(second).icon.value,'music')
})
test('os presets possuem nomes únicos e incluem música, pessoas e projeção',()=>{
  assert.equal(TEAM_ICON_PRESETS.length,new Set(TEAM_ICON_PRESETS.map(([id])=>id)).size)
  for(const kind of ['team','music','screen'])assert.ok(TEAM_ICON_PRESETS.some(([id])=>id===kind))
})
test('normalização de nomes impede duplicação por espaços ou maiúsculas',()=>{
  assert.equal(normalizedTeamName('  FOTOGRAFIA   E  Vídeo '),normalizedTeamName('fotografia e vídeo'))
})
test('rejeita ícone desconhecido, dados excessivos e nome vazio',()=>{
  assert.throws(()=>teamMetadataTask(name,{type:'preset',value:'javascript'},'plano',id),/inválido/)
  assert.throws(()=>teamMetadataTask(name,{type:'svg',value:'<svg'+'.'.repeat(9000)},'plano',id),/limite/)
  assert.throws(()=>teamMetadataTask(' ',icon,'plano',id),/nome/)
  assert.throws(()=>teamMetadataTask(name,icon,'',id),/plano ativo/)
})
test('registros comuns e outras configurações ocultas não viram equipes',()=>{
  const record=teamMetadataTask(name,icon,'plano',id)
  assert.equal(parseTeamMetadata({...record,deleted:false}),null)
  assert.equal(parseTeamMetadata({...record,id:'rotation_v1_abc'}),null)
  assert.equal(parseTeamMetadata({...record,description:'texto'}),null)
})
