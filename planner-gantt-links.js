/**
 * Rotas de dependência do Gantt IPCVT.
 *
 * Cada vínculo mantém os IDs reais das ocorrências. Quando A e B são
 * pré-requisitos de C, suas linhas convergem em um único tronco e
 * somente UMA ponta de seta alcança C.
 */
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v))
const round=value=>Number(value.toFixed(1))
const spread=(i,total)=>total<=1?0:(i-(total-1)/2)*Math.min(4,10/(total-1))

export function ganttLinkRoutes(nodes,dependencies,{
  width=720,focusedId='',showAll=false,denseLimit=6
}={}){
  const byId=new Map(nodes.map(node=>[node.id,node]))
  const seen=new Set()
  const all=(dependencies||[]).filter(link=>{
    const key=link.from+'→'+link.to
    if(link.from===link.to||!byId.has(link.from)||!byId.has(link.to)||seen.has(key))return false
    seen.add(key);return true
  }).sort((a,b)=>byId.get(a.to).y-byId.get(b.to).y||
      byId.get(a.from).y-byId.get(b.from).y||a.from.localeCompare(b.from))
  const dense=all.length>denseLimit
  const included=!showAll&&dense
    ? all.filter(link=>focusedId&&(link.from===focusedId||link.to===focusedId))
    : all
  const outgoing=new Map(),incoming=new Map()
  for(const link of included){
    if(!outgoing.has(link.from))outgoing.set(link.from,[])
    if(!incoming.has(link.to))incoming.set(link.to,[])
    outgoing.get(link.from).push(link);incoming.get(link.to).push(link)
  }
  const ranks=new Map()
  for(const links of outgoing.values()){
    links.sort((a,b)=>byId.get(a.to).y-byId.get(b.to).y)
    links.forEach((link,i)=>{
      const key=link.from+'→'+link.to
      ranks.set(key,{...(ranks.get(key)||{}),out:spread(i,links.length)})
    })
  }
  for(const links of incoming.values()){
    links.sort((a,b)=>byId.get(a.from).y-byId.get(b.from).y)
    links.forEach((link,i)=>{
      const key=link.from+'→'+link.to
      ranks.set(key,{...(ranks.get(key)||{}),into:spread(i,links.length)})
    })
  }
  const routes=included.map((link,index)=>{
    const from=byId.get(link.from),to=byId.get(link.to)
    const key=link.from+'→'+link.to
    const offsets=ranks.get(key)||{}
    const y1=round(from.y+(offsets.out||0)),y2=round(to.y+(offsets.into||0))
    const x1=round(clamp(from.right+3,2,width-2))
    const x2=round(clamp(to.left-7,2,width-2))
    const forward=to.left-from.right>=24
    let d
    if(forward){
      const gap=to.left-from.right
      const x=round(clamp(from.right+gap*.5+((index%5)-2)*3,
        from.right+8,to.left-9))
      if(Math.abs(y2-y1)<2)d='M '+x1+' '+y1+' H '+x2
      else {
        const sign=Math.sign(y2-y1)
        const radius=round(Math.max(0,Math.min(4,Math.abs(y2-y1)/2,
          Math.abs(x-x1)/2,Math.abs(x2-x)/2)))
        d=radius>0
          ? 'M '+x1+' '+y1+' H '+round(x-radius)+
            ' Q '+x+' '+y1+' '+x+' '+round(y1+sign*radius)+
            ' V '+round(y2-sign*radius)+
            ' Q '+x+' '+y2+' '+round(x+radius)+' '+y2+' H '+x2
          : 'M '+x1+' '+y1+' H '+x+' V '+y2+' H '+x2
      }
    }else{
      const lane=round(Math.min(width-3,Math.max(x1+2,
        Math.max(from.right,to.right)+12+(index%4)*6)))
      const exit=round(clamp(to.right+4,2,width-2))
      // Relações regressivas conectam ao lado DIREITO da demanda C,
      // sem atravessar o seu cartão horizontalmente.
      d='M '+x1+' '+y1+' H '+lane+' V '+y2+' H '+exit
    }
    return {
      ...link,d,backward:!forward,
      active:Boolean(focusedId&&(link.from===focusedId||link.to===focusedId)),
      title:(from.title||'Demanda')+' → '+(to.title||'Demanda'),
      markerEnd:true,bundled:false
    }
  })
  const bundles=[]
  for(const [targetId,group] of incoming){
    if(group.length<2)continue
    const target=byId.get(targetId)
    const sources=group.map(link=>byId.get(link.from))
    const maxRight=Math.max(...sources.map(node=>node.right))
    const forward=maxRight+24<target.left
    const join=forward
      ? round(clamp(maxRight+Math.min(22,(target.left-maxRight)/2),
        maxRight+7,target.left-11))
      : round(Math.min(width-5,Math.max(maxRight,target.right)+15))
    const entry=forward?round(clamp(target.left-7,2,width-2))
      :round(clamp(target.right+5,2,width-2))
    const involved=routes.filter(link=>link.to===targetId)
    for(const route of involved){
      const source=byId.get(route.from)
      const key=route.from+'→'+route.to
      const delta=ranks.get(key)||{}
      const y=round(source.y+(delta.out||0))
      const fromX=round(clamp(source.right+3,2,width-2))
      route.d='M '+fromX+' '+y+' H '+join
      route.markerEnd=false
      route.bundled=true
      route.backward=!forward
    }
    const allYs=[target.y,...involved.map(route=>{
      const delta=ranks.get(route.from+'→'+route.to)||{}
      return byId.get(route.from).y+(delta.out||0)
    })]
    const minY=round(Math.min(...allYs)),maxY=round(Math.max(...allYs))
    const trunk='M '+join+' '+minY+' V '+maxY
    const exit='M '+join+' '+round(target.y)+' H '+entry
    bundles.push({
      target:targetId,
      sources:group.map(link=>link.from),
      d:trunk+' '+exit,trunk,exit,backward:!forward,markerEnd:true,
      active:Boolean(focusedId&&[targetId,...group.map(link=>link.from)].includes(focusedId)),
      title:group.length+' pré-requisitos → '+(target.title||'Demanda')
    })
  }
  return {routes,bundles,total:all.length,dense,visible:included.length}
}
