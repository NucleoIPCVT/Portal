import test from 'node:test'
import assert from 'node:assert/strict'
import {
  setTaskRecurrence,taskRecurrence,rotationConfigRecord,parseRotationConfig,
  rotationAssigneesForDate,recurrenceDateAt,recurrenceOccurrenceAt,
  scheduledUpcomingDates,nextRecurringTask
} from '../planner-recurrence.js'

const people=['João','Liliane','Lucas','Amanda'].map(name=>({name,email:''}))
const task=setTaskRecurrence({
  id:'serie',planId:'p',bucketId:'a',title:'Conferir projeção',
  description:'',team:'Mídia',assignees:[people[0]],
  dueDate:'2026-11-15',startDate:'2026-11-14',status:'todo',
  priority:'normal',checklist:[],dependencyIds:[],eventId:'',
  dateMode:'manual',dueOffsetDays:null,deleted:false
},{unit:'week',interval:1})

test('individual rotation uses the occurrence index, not completion order',()=>{
  const config=parseRotationConfig(rotationConfigRecord(task,{
    mode:'individual',advance:'scheduled',people:people.slice(0,3),groups:[0,1,2]
  }))
  assert.deepEqual(Array.from({length:6},(_,index)=>{
    const date=recurrenceDateAt(taskRecurrence(task),index)
    return rotationAssigneesForDate(task,config,date)[0]?.name
  }),['João','Liliane','Lucas','João','Liliane','Lucas'])
})
test('custom group membership alternates two groups of two people',()=>{
  const config=parseRotationConfig(rotationConfigRecord(task,{
    mode:'groups',advance:'scheduled',people,groups:[0,0,1,1]
  }))
  assert.deepEqual(Array.from({length:3},(_,index)=>{
    const date=recurrenceDateAt(taskRecurrence(task),index)
    return rotationAssigneesForDate(task,config,date).map(person=>person.name)
  }),[['João','Liliane'],['Lucas','Amanda'],['João','Liliane']])
})
test('scheduled occurrence does not depend on previous completion, and remains deterministic',()=>{
  const config=parseRotationConfig(rotationConfigRecord(task,{
    mode:'individual',advance:'scheduled',people,groups:[0,1,2,3]
  }))
  assert.equal(nextRecurringTask({...task,status:'done'},[],config),null)
  const upcoming=scheduledUpcomingDates(task,'2026-11-13')
  assert.deepEqual(upcoming,[
    '2026-11-22','2026-11-29','2026-12-06','2026-12-13'
  ])
  const occurrence=recurrenceOccurrenceAt(task,'2026-11-29',config)
  assert.equal(occurrence.assignees[0].name,'Lucas')
  assert.equal(occurrence.id,'repeat_serie_2026-11-29')
  assert.equal(occurrence.startDate,'2026-11-28')
  assert.equal(occurrence.status,'todo')
  assert.deepEqual(occurrence,recurrenceOccurrenceAt(task,'2026-11-29',config))
})
test('completion-based rotation creates exactly the next person',()=>{
  const config=parseRotationConfig(rotationConfigRecord(task,{
    mode:'individual',advance:'completion',people,groups:[0,1,2,3]
  }))
  const next=nextRecurringTask({...task,status:'done'},[],config)
  assert.equal(next.dueDate,'2026-11-22')
  assert.deepEqual(next.assignees,[people[1]])
})
test('monthly dates preserve calendar anchor through short months',()=>{
  const month=setTaskRecurrence({...task,dueDate:'2027-01-31'},
    {unit:'month',interval:1})
  assert.equal(recurrenceDateAt(taskRecurrence(month),1),'2027-02-28')
  assert.equal(recurrenceDateAt(taskRecurrence(month),2),'2027-03-31')
})
test('invalid rotations are rejected before writing any Firestore record',()=>{
  assert.throws(()=>rotationConfigRecord(task,{
    mode:'groups',advance:'scheduled',people,groups:[0,0,0,0]
  }),/dois grupos/)
  assert.throws(()=>rotationConfigRecord(task,{
    mode:'individual',advance:'scheduled',people:people.slice(0,1),groups:[0]
  }),/duas pessoas/)
  assert.throws(()=>rotationConfigRecord(task,{
    mode:'individual',advance:'scheduled',people,groups:[0,1]
  }),/grupo/)
})

test('a fixed supervisor can participate in every individual or group rotation',()=>{
  for(const [mode,groups] of [['individual',[-1,0,1,2]],['groups',[-1,0,0,1]]]){
    const config=parseRotationConfig(rotationConfigRecord(task,{
      mode,advance:'scheduled',people,groups
    }))
    for(let i=0;i<4;i++){
      const date=recurrenceDateAt(taskRecurrence(task),i)
      const assignees=rotationAssigneesForDate(task,config,date).map(person=>person.name)
      assert.ok(assignees.includes('João'))
      assert.equal(assignees.length,mode==='individual'?2:(i%2===0?3:2))
    }
  }
})
