import test from 'node:test'
import assert from 'node:assert/strict'
import { ganttLinkRoutes } from '../planner-gantt-links.js'

const nodes = [
  { id:'a',title:'Planejamento',left:20,right:100,y:100 },
  { id:'b',title:'Execução',left:190,right:260,y:150 },
  { id:'c',title:'Revisão',left:80,right:150,y:200 }
]
const links = [{from:'a',to:'b'},{from:'b',to:'c'},{from:'a',to:'c'}]

test('um vínculo progressivo usa conector ortogonal com canto arredondado',()=>{
  const result=ganttLinkRoutes(nodes,[links[0]],{width:350})
  assert.equal(result.total,1)
  assert.equal(result.routes[0].backward,false)
  assert.match(result.routes[0].d,/^M /)
  assert.match(result.routes[0].d,/ Q /)
  assert.equal(result.routes[0].title,'Planejamento → Execução')
})

test('vínculos regressivos são separados e identificados',()=>{
  const result=ganttLinkRoutes(nodes,[links[1]],{width:350})
  assert.equal(result.routes.length,1)
  assert.equal(result.routes[0].backward,true)
  assert.match(result.routes[0].d,/ V /)
})

test('mais de seis vínculos exibem apenas as relações de uma tarefa',()=>{
  const crowded=Array.from({length:8},(_,index)=>({from:'a',to:'x'+index}))
  const tasks=[...nodes,...crowded.map((link,i)=>({
    id:link.to,title:'Demanda '+i,left:160,right:240,y:280+i*34
  }))]
  const initial=ganttLinkRoutes(tasks,crowded,{width:350})
  assert.equal(initial.total,8)
  assert.equal(initial.dense,true)
  assert.equal(initial.visible,0)
  const selected=ganttLinkRoutes(tasks,crowded,{width:350,focusedId:'x4'})
  assert.equal(selected.visible,1)
  assert.equal(selected.routes[0].to,'x4')
  assert.equal(selected.routes[0].active,true)
  const all=ganttLinkRoutes(tasks,crowded,{width:350,showAll:true})
  assert.equal(all.visible,8)
})

test('relacionamentos repetidos, inexistentes e autorreferências não criam setas extras',()=>{
  const result=ganttLinkRoutes(nodes,[links[0],links[0],
    {from:'missing',to:'b'},{from:'a',to:'a'}],{width:350})
  assert.equal(result.total,1)
})

test('entradas múltiplas são deslocadas para não sobrepor exatamente a ponta das setas',()=>{
  const input=[
    {id:'p1',left:20,right:75,y:90},
    {id:'p2',left:20,right:75,y:120},
    {id:'p3',left:20,right:75,y:150},
    {id:'destination',left:250,right:320,y:230}
  ]
  const result=ganttLinkRoutes(input,['p1','p2','p3'].map(from=>({
    from,to:'destination'
  })),{width:350})
  assert.equal(result.routes.length,3)
  assert.equal(new Set(result.routes.map(route=>route.d.match(/ H (243(?:\.\d+)?)/)?.[1]||route.d)).size,3)
})

test('vínculos perto da borda direita permanecem dentro da largura do gráfico',()=>{
  const right=[
    {id:'a',left:650,right:715,y:100},
    {id:'b',left:708,right:718,y:130}
  ]
  const result=ganttLinkRoutes(right,[{from:'a',to:'b'}],{width:720})
  assert.equal(result.routes[0].backward,true)
  assert.doesNotMatch(result.routes[0].d,/\b72[0-9]\b/)
})
