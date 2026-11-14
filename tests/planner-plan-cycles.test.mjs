import test from 'node:test'
import assert from 'node:assert/strict'
import {
  planCycleConfigRecord,parsePlanCycleConfig,currentPlanCycle,nextPlanCycle,
  planCycleDates,missingPlanCycleTasks,cycleForPlanTask
} from '../planner-plan-cycles.js'

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
