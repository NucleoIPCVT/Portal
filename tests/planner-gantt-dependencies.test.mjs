import test from 'node:test'
import assert from 'node:assert/strict'
import { setTaskRecurrence } from '../planner-recurrence.js'
import { resolveGanttDependencies } from '../planner-gantt-dependencies.js'

const task=(id,date,dependencies=[])=>({
  id,planId:'plano',bucketId:'',title:'Preparar projeção',
  startDate:date,dueDate:date,status:'todo',deleted:false,
  dependencyIds:dependencies,assignees:[],priority:'normal'
})
const originalA=setTaskRecurrence(task('A0','2026-11-16'),{interval:1,unit:'week'})
const originalB=setTaskRecurrence(task('B0','2026-11-18',['A0']),{interval:1,unit:'week'})
const occurrence=(original,id,date)=>({
  ...original,id,startDate:date,dueDate:date,
  cycleKey:date,sourceTaskId:original.id
})
const A1=occurrence(originalA,'A1','2026-11-23')
const B1=occurrence(originalB,'B1','2026-11-25')
const A2=occurrence(originalA,'A2','2026-11-30')
const B2=occurrence(originalB,'B2','2026-12-02')
const all=[originalA,originalB,A1,B1,A2,B2]

test('A demanda original mantém seu vínculo pelo ID, independentemente do estado',()=>{
  const result=resolveGanttDependencies(all,[originalA,originalB])
  assert.deepEqual(result.links.map(link=>[link.from,link.to]),[['A0','B0']])
  assert.equal(result.links[0].dateAligned,false)
})

test('Demandas geradas semanalmente apontam apenas para a ocorrência correspondente',()=>{
  const second=resolveGanttDependencies(all,[A1,B1])
  const third=resolveGanttDependencies(all,[A2,B2])
  assert.deepEqual(second.links.map(link=>[link.from,link.to]),[['A1','B1']])
  assert.deepEqual(third.links.map(link=>[link.from,link.to]),[['A2','B2']])
  assert.equal(second.links[0].dateAligned,true)
})

test('Reabrir tarefa antiga não redireciona setas para a nova ocorrência',()=>{
  const reopened={...originalA,status:'doing',dueDate:'2026-12-09'}
  const changed=[reopened,originalB,A1,B1,A2,B2]
  const old=resolveGanttDependencies(changed,[reopened,originalB])
  const newCycle=resolveGanttDependencies(changed,[A1,B1])
  assert.deepEqual(old.links.map(link=>[link.from,link.to]),[['A0','B0']])
  assert.deepEqual(newCycle.links.map(link=>[link.from,link.to]),[['A1','B1']])
})

test('Sem ocorrência da semana correspondente não liga na tarefa de semana anterior',()=>{
  const noA2=all.filter(task=>task.id!=='A2')
  const result=resolveGanttDependencies(noA2,[A1,B2])
  assert.equal(result.links.length,0)
  assert.equal(result.missing.length,1)
  assert.match(result.missing[0].reason,/ocorrência correspondente/)
})

test('Dependência explícita de uma demanda não recorrente não muda com a data',()=>{
  const manual=task('manual','2026-12-05',['A0'])
  const result=resolveGanttDependencies([...all,manual],[originalA,A1,A2,manual])
  assert.deepEqual(result.links.map(link=>[link.from,link.to]),[['A0','manual']])
})

test('Dependência histórica fora da janela é registrada, não substituída',()=>{
  const result=resolveGanttDependencies(all,[originalB])
  assert.equal(result.links.length,0)
  assert.deepEqual(result.outOfView.map(link=>link.from),['A0'])
})

test('A identidade da ocorrência não é inferida pelo título da demanda',()=>{
  const unrelated=task('outra','2026-11-23')
  const result=resolveGanttDependencies([...all,unrelated],[unrelated,B1])
  assert.equal(result.links.length,0)
  assert.equal(result.outOfView[0].from,'A1')
})

test('Repetições mensais mantêm associação em fevereiro e março',()=>{
  const a=setTaskRecurrence(task('MA','2027-01-31'),{interval:1,unit:'month'})
  const b=setTaskRecurrence(task('MB','2027-02-01',['MA']),{interval:1,unit:'month'})
  const aFeb=occurrence(a,'MA-Feb','2027-02-28')
  const bMar=occurrence(b,'MB-Mar','2027-03-01')
  const result=resolveGanttDependencies([a,b,aFeb,bMar],[aFeb,bMar])
  assert.deepEqual(result.links.map(link=>[link.from,link.to]),[['MA-Feb','MB-Mar']])
})

test('Nunca cria seta para a própria ocorrência',()=>{
  const self={...B1,dependencyIds:['B1']}
  const result=resolveGanttDependencies([...all.filter(task=>task.id!=='B1'),self],[self])
  assert.equal(result.links.length,0)
})
