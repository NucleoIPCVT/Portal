/**
 * Team icon metadata saved as a hidden Planner task.
 * Uses only the existing Firestore task schema and access rules.
 */
export const TEAM_METADATA_PREFIX = 'team_meta_v1_'
export const TEAM_ICON_PRESETS = [
  ['team','Pessoas'],['music','Música'],['screen','Projeção'],
  ['church','Culto'],['checklist','Checklist'],['resource','Equipamento'],
  ['document','Documentos'],['calendar','Agenda'],
  ['flag','Coordenação'],['plan','Planejamento'],['clock','Horários'],
  ['theater','Teatro']
]
export const DEFAULT_TEAM_NAMES =
  ['Louvor','Litúrgico','Técnica','Mídia','Comunicação','Comissão']
export const normalizedTeamName = value => String(value||'')
  .normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('pt-BR')

export function parseTeamMetadata(record) {
  if (!record?.deleted || !String(record.id||'').startsWith(TEAM_METADATA_PREFIX))return null
  if(typeof record.team!=='string'||!record.team.trim()||record.team.length>80)return null
  let data
  try{data=JSON.parse(record.description||'')}catch{return null}
  if(data?.v!==1||!data.icon||!['preset','svg'].includes(data.icon.type))return null
  if(typeof data.icon.value!=='string')return null
  if(data.icon.type==='preset'&&!TEAM_ICON_PRESETS.some(([id])=>id===data.icon.value))return null
  if(data.icon.type==='svg'&&(data.icon.value.length>8500||!data.icon.value.startsWith('<svg')))return null
  return {name:record.team,icon:{type:data.icon.type,value:data.icon.value},record}
}

export function teamMetadataTask(name,icon,planId,id,previous=null) {
  const clean=String(name||'').normalize('NFC').trim().replace(/\s+/g,' ')
  if(!clean||clean.length>80)throw new Error('O nome da equipe deve ter entre 1 e 80 caracteres.')
  if(!id||!id.startsWith(TEAM_METADATA_PREFIX)||id.length>200)throw new Error('Identificador inválido da equipe.')
  if(!planId)throw new Error('É necessário um plano ativo para salvar a equipe.')
  if(!icon||!['preset','svg'].includes(icon.type))throw new Error('Escolha um ícone válido.')
  if(icon.type==='preset'&&!TEAM_ICON_PRESETS.some(([value])=>value===icon.value))throw new Error('Ícone predefinido inválido.')
  if(icon.type==='svg'&&(typeof icon.value!=='string'||!icon.value.startsWith('<svg')||icon.value.length>8500))throw new Error('O SVG ultrapassa o limite permitido.')
  const description=JSON.stringify({v:1,icon})
  if(description.length>10000)throw new Error('O SVG é grande demais para o cadastro da equipe.')
  return {
    ...(previous||{}),id,planId,
    bucketId:'',title:'Equipe: '+clean,description,team:clean,
    assignees:[],startDate:'',dueDate:'',status:'todo',priority:'normal',
    checklist:[],dependencyIds:[],eventId:'',dateMode:'manual',
    dueOffsetDays:null,deleted:true
  }
}

export async function teamMetadataId(name) {
  const normalized=normalizedTeamName(name)
  const data=new TextEncoder().encode(normalized)
  const bytes=await crypto.subtle.digest('SHA-256',data)
  return TEAM_METADATA_PREFIX+Array.from(new Uint8Array(bytes))
    .map(n=>n.toString(16).padStart(2,'0')).join('')
}

/** Reject active SVG features rather than merely hiding them. */
export function sanitizeTeamSvg(raw) {
  if(typeof raw!=='string'||raw.length>9000)throw new Error('Escolha um SVG de até 9 KB.')
  if(/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(raw))throw new Error('O SVG contém recursos não permitidos.')
  const documentSvg=new DOMParser().parseFromString(raw,'image/svg+xml')
  const root=documentSvg.documentElement
  const ns='http://www.w3.org/2000/svg'
  if(root?.localName!=='svg'||root.namespaceURI!==ns||
    documentSvg.querySelector('parsererror'))throw new Error('Não foi possível ler o arquivo SVG.')
  const shapes=new Set(['svg','g','path','circle','rect','ellipse','line','polygon','polyline'])
  const attrs=new Set([
    'xmlns','viewBox','width','height','d','fill','stroke','stroke-width',
    'stroke-linecap','stroke-linejoin','stroke-miterlimit','fill-rule',
    'opacity','fill-opacity','stroke-opacity','cx','cy','r','rx','ry',
    'x','y','x1','y1','x2','y2','points','transform'
  ])
  let nodes=0
  const check=element=>{
    nodes++
    if(nodes>120||!shapes.has(element.localName)||element.namespaceURI!==ns)
      throw new Error('O SVG contém elementos não permitidos. Use um ícone vetorial simples.')
    for(const attr of element.attributes){
      if(!attrs.has(attr.name)||attr.namespaceURI&&attr.namespaceURI!==ns&&attr.name!=='xmlns'||
        /url\s*\(|javascript:|data:|expression\s*\(|@import|[<>]/i.test(attr.value))
        throw new Error('O SVG contém estilos, links ou instruções não permitidas.')
      if(attr.value.length>6000)throw new Error('O SVG contém um atributo grande demais.')
    }
    for(const child of element.childNodes){
      if(child.nodeType===1)check(child)
      else if(child.nodeType===3&&!child.textContent.trim())continue
      else throw new Error('O SVG deve conter somente formas vetoriais.')
    }
  }
  check(root)
  const safe=documentSvg.documentElement
  safe.setAttribute('xmlns',ns)
  if(!safe.getAttribute('viewBox')){
    const w=Number(safe.getAttribute('width')||24),h=Number(safe.getAttribute('height')||24)
    if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0||w>10000||h>10000)
      throw new Error('O SVG precisa ter dimensões válidas.')
    safe.setAttribute('viewBox','0 0 '+w+' '+h)
  }
  const serialized=new XMLSerializer().serializeToString(safe)
  if(serialized.length>8500)throw new Error('O SVG ultrapassa 8,5 KB após a validação.')
  return serialized
}

export function teamSvgUrl(safeSvg){
  return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(safeSvg)
}