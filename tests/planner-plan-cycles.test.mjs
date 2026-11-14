import test from 'node:test'
import assert from 'node:assert/strict'
import {
  planCycleConfigRecord,parsePlanCycleConfig,currentPlanCycle,nextPlanCycle,previousPlanCycle,
  planCycleDates,missingPlanCycleTasks,cycleForPlanTask
} from '../planner-plan-cycles.js'
import {rotationConfigRecord,rotationAssigneesForDate} from '../planner-recurrence.js'

const plan={id:'plano-domingo',name:'Rotina Dominical'}
const config=parsePlanCycleConfig(planCycleConfigRecord(plan,{
  unit:'week',interval:1,anchor:'2026-11-15'
}))
const task=(id,title,dueDate,more={})=>({
  id,planId:plan.id,bucketId:'bucket-a',title,description:'',
  startDate:dueDate,dueDate,status:'todo',priority:'normal',
  assignees:[],checklist:[],dependencyIds:[],...more
})
const buckets=[{id:'bucket-a',planId:plan.id,name:'A fazer'}]

test('plano recorrente calcula ciclos em novos anos sem alterar datas históricas',()=>{
  assert.ok(config)
  assert.equal(currentPlanCycle(config,'2026-11-11'),'2026-11-15')
  assert.equal(nextPlanCycle(config,'2026-12-27'),'2027-01-03')
  assert.deepEqual(planCycleDates({...config,anchor:'2026-12-27'},'2026-12-28',3),
    ['2027-01-03','2027-01-10','2027-01-17'])
})
test('o ciclo anterior continua concluído e o próximo reinicia os checklists',()=>{
  const original=task('a','Definir repertório','2026-11-12',{
    status:'done',checklist:[{id:'c',text:'Confirmar músicos',done:true}]
  })
  const before=structuredClone(original)
  const drafts=missingPlanCycleTasks(config,[original],buckets,'2026-11-13')
  assert.equal(drafts.length,1)
  assert.equal(drafts[0].cycleKey,'2026-11-22')
  assert.equal(drafts[0].dueDate,'2026-11-19')
  assert.equal(drafts[0].status,'todo')
  assert.equal(drafts[0].checklist[0].done,false)
  assert.deepEqual(original,before)
})
test('uma mesma geração não cria a ocorrência duas vezes',()=>{
  const first=[task('a','Repertório','2026-11-12')]
  const additions=missingPlanCycleTasks(config,first,buckets,'2026-11-13')
  assert.equal(additions.length,1)
  assert.deepEqual(missingPlanCycleTasks(config,[...first,...additions],buckets,'2026-11-13'),[])
})
test('identifica ocorrências antigas das tarefas recorrentes sem duplicar',()=>{
  const root=task('repertorio','Repertório','2026-11-12',{
    recurrenceId:'repeat-v1:repertorio:week:1:2026-11-12'
  })
  const existing=task('repeat_repertorio_2026-11-19','Repertório','2026-11-19',{
    sourceTaskId:'repertorio',recurrenceId:root.recurrenceId
  })
  assert.equal(missingPlanCycleTasks(config,[root,existing],buckets,'2026-11-13').length,0)
})
test('dependências A + B para C são vinculadas ao mesmo ciclo',()=>{
  const initial=[
    task('a','A','2026-11-11'),
    task('b','B','2026-11-12'),
    task('c','C','2026-11-13',{dependencyIds:['a','b']})
  ]
  const next=missingPlanCycleTasks(config,initial,buckets,'2026-11-13')
  const byTitle=new Map(next.map(item=>[item.title,item]))
  assert.equal(next.length,3)
  assert.deepEqual(byTitle.get('C').dependencyIds,
    [byTitle.get('A').id,byTitle.get('B').id])
})
test('último dia do mês é ajustado sem quebrar fevereiro',()=>{
  const monthly=parsePlanCycleConfig(planCycleConfigRecord(plan,{
    unit:'month',interval:1,anchor:'2026-01-31'
  }))
  assert.deepEqual(planCycleDates(monthly,'2026-02-01',3),
    ['2026-02-28','2026-03-31','2026-04-30'])
})
test('uma fonte excluída não volta a gerar demandas',()=>{
  const deleted=task('a','A','2026-11-12',{deleted:true})
  const old=task('old-a','A','2026-11-19',{sourceTaskId:'a'})
  assert.deepEqual(missingPlanCycleTasks(config,[deleted,old],buckets,'2026-11-13'),[])
})
test('ciclos já gerados usam o identificador de seu período mesmo após alteração de prazo',()=>{
  const t=task('g','A','2026-11-25',{
    sourceTaskId:'a',cycleKey:'2026-11-22',templateKey:'plan-instance-v1'
  })
  assert.equal(cycleForPlanTask(config,t),'2026-11-22')
})

test('uma ocorrência individual excluída não reaparece ao converter o plano',()=>{
  const root=task('a','Rotina','2026-11-12')
  const deleted=task('repeat-a-2026-11-19','Rotina','2026-11-19',{
    sourceTaskId:'a',deleted:true
  })
  assert.deepEqual(missingPlanCycleTasks(config,[root,deleted],buckets,'2026-11-13'),[])
})

test('navegação anterior retorna ao domingo precedente ou ao mês anterior',()=>{
  assert.equal(previousPlanCycle(config,'2026-11-22'),'2026-11-15')
  assert.equal(previousPlanCycle(config,'2027-01-03'),'2026-12-27')
  const monthly=parsePlanCycleConfig(planCycleConfigRecord(plan,{
    unit:'month',interval:1,anchor:'2026-01-31'
  }))
  assert.equal(previousPlanCycle(monthly,'2026-03-31'),'2026-02-28')
})

test('rodízio individual avança por domingo sem repetição na demanda',()=>{
  const members=[{name:'Ana',email:''},{name:'Bruno',email:''},{name:'Carlos',email:''}]
  const source=task('escala','Operar som','2026-11-12',{assignees:[members[0]]})
  const rotation=rotationConfigRecord(source,{
    sourceId:source.id,mode:'individual',advance:'scheduled',people:members,groups:[0,1,2]
  })
  const drafts=missingPlanCycleTasks(config,[source,rotation],buckets,'2026-11-13')
  assert.equal(drafts.length,1)
  assert.equal(drafts[0].cycleKey,'2026-11-22')
  assert.deepEqual(drafts[0].assignees,[members[1]])
})
test('rodízio por grupos preserva participante fixo em todos os ciclos',()=>{
  const members=[
    {name:'Coordenador',email:''},
    {name:'Ana',email:''},{name:'Bruno',email:''},{name:'Carlos',email:''}
  ]
  const source=task('equipe','Escala de projeção','2026-11-12',{assignees:[members[0],members[1],members[2]]})
  const rotation=rotationConfigRecord(source,{
    sourceId:source.id,mode:'groups',advance:'scheduled',people:members,groups:[-1,0,0,1]
  })
  const next=missingPlanCycleTasks(config,[source,rotation],buckets,'2026-11-13')
  assert.equal(next.length,1)
  assert.deepEqual(next[0].assignees,[members[0],members[3]])
})
test('rodízio legado com repetição individual mantém a ordem após conversão do plano',()=>{
  const original=task('som','Operar mesa','2026-11-12',{
    recurrenceId:'repeat-v1:som:week:1:2026-11-12'
  })
  const settings={mode:'individual',advance:'scheduled',
    people:[{name:'Ana',email:''},{name:'Bruno',email:''}],groups:[0,1]}
  const rotation=rotationConfigRecord(original,settings)
  const next=missingPlanCycleTasks(config,[original,rotation],buckets,'2026-11-13')
  assert.equal(next.length,1)
  assert.equal(next[0].assignees[0].name,'Bruno')
  assert.equal(rotationAssigneesForDate(original,settings,'2026-11-19')[0].name,'Bruno')
})
test('rodízio segue depois da virada do ano',()=>{
  const winterConfig=parsePlanCycleConfig(planCycleConfigRecord(plan,{
    unit:'week',interval:1,anchor:'2026-12-27'
  }))
  const people=[{name:'Ana',email:''},{name:'Bruno',email:''}]
  const source=task('virada','Transmissão','2026-12-27')
  const rotation=rotationConfigRecord(source,{
    sourceId:source.id,mode:'individual',advance:'scheduled',people,groups:[0,1]
  })
  const next=missingPlanCycleTasks(winterConfig,[source,rotation],buckets,'2026-12-28')
  assert.equal(next.length,2)
  assert.equal(next[0].cycleKey,'2027-01-03')
  assert.equal(next[0].assignees[0].name,'Bruno')
  assert.equal(next[1].cycleKey,'2027-01-10')
  assert.equal(next[1].assignees[0].name,'Ana')
})
