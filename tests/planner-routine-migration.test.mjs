import test from 'node:test'
import assert from 'node:assert/strict'
import { routineMigrationPlan } from '../planner-routine-migration.js'
import { taskRecurrence,setTaskRecurrence } from '../planner-recurrence.js'

const routine={
  id:'r1',title:'Conferir transmissão',planId:'p1',bucketId:'todo',
  weekday:0,team:'Mídia',priority:'normal',active:true,
  assignees:[{name:'Lucas',email:'lucas@example.test'}]
}
const existing=(id,date,status='todo')=>({
  id,planId:routine.planId,bucketId:routine.bucketId,
  title:routine.title,team:routine.team,assignees:routine.assignees,
  dueDate:date,startDate:date,status,
  checklist:[{id:'check',text:'Revisar câmera',done:status==='done'}],
  dependencyIds:[],eventId:'',dateMode:'manual',dueOffsetDays:null,
  routineId:routine.id,cycleKey:'2026-11-09',version:3
})

test('usa a ocorrência já cadastrada, sem gerar um novo ID ou perder seu histórico',()=>{
  const past=existing('routine_r1_2026-11-02','2026-11-08','done')
  const next=existing('routine_r1_2026-11-09','2026-11-15','todo')
  const migrated=routineMigrationPlan(routine,[past,next],'2026-11-13')
  assert.equal(migrated.mode,'reuse')
  assert.equal(migrated.template.id,next.id)
  assert.equal(migrated.template.version,3)
  assert.equal(migrated.template.status,'todo')
  assert.equal(migrated.template.checklist[0].text,'Revisar câmera')
  assert.equal(taskRecurrence(migrated.template).anchor,'2026-11-15')
  assert.equal(migrated.legacyCount,2)
})

test('rotina sem tarefas cria somente a primeira ocorrência no dia correto',()=>{
  const migrated=routineMigrationPlan({...routine,id:'nova'},[],'2026-11-13')
  assert.equal(migrated.mode,'create')
  assert.equal(migrated.template.dueDate,'2026-11-15')
  assert.equal(migrated.template.status,'todo')
  assert.equal(migrated.template.routineId,'nova')
})

test('a conversão é retomável depois de salvar a nova série',()=>{
  const first=routineMigrationPlan(routine,[], '2026-11-13')
  const again=routineMigrationPlan(routine,[first.template],'2026-11-13')
  assert.equal(again.mode,'already')
  assert.equal(again.template.id,first.template.id)
})

test('rotinas desativadas não são convertidas e ficam arquivadas',()=>{
  assert.equal(routineMigrationPlan({...routine,active:false},[], '2026-11-13'),null)
})

test('não altera ocorrência antiga se já existir uma futura elegível',()=>{
  const past=existing('past','2026-11-08','done')
  const next=existing('future','2026-11-15','todo')
  const migrated=routineMigrationPlan(routine,[past,next],'2026-11-13')
  assert.equal(migrated.template.id,'future')
  assert.equal(past.status,'done')
})


test('selecionar outro dia da semana realinha a âncora da repetição explicitamente',()=>{
  const first=setTaskRecurrence({
    id:'x',title:'Conferir equipe',dueDate:'2026-11-15',
    dateMode:'manual'
  },{unit:'week',interval:1})
  const changed=setTaskRecurrence({...first,dueDate:'2026-11-18'},
    {unit:'week',interval:1,resetAnchor:true})
  assert.equal(taskRecurrence(changed).anchor,'2026-11-18')
  const withoutReset=setTaskRecurrence({...first,dueDate:'2026-11-18'},
    {unit:'week',interval:1})
  assert.equal(taskRecurrence(withoutReset).anchor,'2026-11-15')
})
