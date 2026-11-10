// Keep creation in the same event and plan as the place where the user clicked.
// An explicit empty eventId is an independent task, even in a filtered view.
export function taskCreationContext({ plans = [], buckets = [], tasks = [], planId = '', eventId = '', defaults = {} } = {}) {
  const active = plans.filter(plan => !plan.deleted)
  const linkedEventId = Object.hasOwn(defaults, 'eventId')
    ? defaults.eventId
    : eventId === '__independent__' ? '' : eventId
  const relatedPlan = tasks.find(task => !task.deleted && task.eventId === linkedEventId
    && linkedEventId && active.some(plan => plan.id === task.planId))?.planId
  const chosenPlan = [defaults.planId, planId, relatedPlan,
    linkedEventId ? 'ipcvt-preparacao-eventos' : 'ipcvt-demandas-independentes']
    .find(id => active.some(plan => plan.id === id)) || active[0]?.id || ''
  const firstBucket = buckets.filter(bucket => !bucket.deleted && bucket.planId === chosenPlan)
    .sort((a, b) => a.order - b.order)[0]?.id || ''
  return {
    ...defaults,
    planId: chosenPlan,
    bucketId: Object.hasOwn(defaults, 'bucketId') ? defaults.bucketId : firstBucket,
    eventId: linkedEventId || ''
  }
}
