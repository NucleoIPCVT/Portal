// Leitura conjunta de agendas públicas para o Planner. Não altera a interface visual.
// A fonte principal continua a mesma; fontes adicionais seguem a Agenda Anual.
import { publicCalendar, readPublicCalendar, parseCalendarSourceUrl } from './planner-public.js?v=20261116-multi-source-ids-v1';
import { officialIpbEvents2026 } from './agenda-ipb-2026.js?v=20261116-v1';

const BRAZIL_ID = 'pt.brazilian#holiday@group.v.calendar.google.com';
const IPB_ID = 'ipb:official-2026';
const BRAZIL = { id:'brasil', kind:'google', calendarId:BRAZIL_ID, name:'Datas comemorativas do Brasil' };
const IPB = { id:'ipb', kind:'ipb', calendarId:IPB_ID, name:'Datas comemorativas presbiterianas · IPB 2026' };

export function plannerPublicSources(config={}) {
  const primary = { id:'ipcvt', kind:'google',
    calendarId:config.calendarId||publicCalendar.id,
    name:config.calendarId===publicCalendar.id||!config.calendarId?publicCalendar.name:config.calendarId };
  const removed = new Set(Array.isArray(config.removedSourceIds)?config.removedSourceIds:[]);
  const sources = [primary,...[BRAZIL,IPB].filter(source=>!removed.has(source.id))];
  const used = new Set(sources.map(source=>source.calendarId));
  const additional=Array.isArray(config.additionalSources)?config.additionalSources:[];
  for(const candidate of additional){
    if(!candidate||typeof candidate.sourceUrl!=='string'||typeof candidate.calendarId!=='string')continue;
    try{
      const parsed=parseCalendarSourceUrl(candidate.sourceUrl);
      if(parsed.calendarId!==candidate.calendarId||used.has(candidate.calendarId))continue;
      used.add(candidate.calendarId);
      sources.push({id:'google:'+candidate.calendarId,kind:'google',calendarId:candidate.calendarId,
        name:String(candidate.name||candidate.calendarId).trim().slice(0,100)});
    }catch{ /* A configuração inválida não interrompe as fontes oficiais. */ }
  }
  return sources;
}

async function officialPresbyterianEvents(){
  const events=officialIpbEvents2026();
  return Promise.all(events.map(async event=>{
    // Identificador permanente de 64 caracteres, compatível com as demandas
    // vinculadas a eventos oficiais no Planner.
    const bytes=new TextEncoder().encode('ipb:official-2026:'+event.sourceEventId);
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    const id=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
    return {...event,id,source:'google',sourceCalendarId:IPB_ID,
      sourceKey:'public-ipb:2026:'+event.sourceEventId,
      calendarName:IPB.name};
  }));
}

export async function readPlannerPublicSources(config={}, {previousEvents=[]}={}) {
  const sources=plannerPublicSources(config);
  const result=await Promise.allSettled(sources.map(async source=>{
    if(source.kind==='ipb')return {events:await officialPresbyterianEvents(),sourceKind:'official-pdf'};
    const snapshot=await readPublicCalendar({calendarId:source.calendarId});
    return {...snapshot,events:snapshot.events.map(event=>({
      ...event,calendarName:source.id==='ipcvt'
        ? (event.calendarName||snapshot.calendarName||source.name)
        : source.name
    }))};
  }));

  const loadedCalendarIds=[];
  const failedCalendarIds=[];
  const warnings=[];
  const all=[];
  let mainName=sources[0]?.name||publicCalendar.name;
  let direct=true;
  let completed=0;

  result.forEach((outcome,index)=>{
    const source=sources[index];
    if(outcome.status==='fulfilled'){
      completed++;
      const response=outcome.value;
      loadedCalendarIds.push(source.calendarId);
      all.push(...response.events);
      if(source.id==='ipcvt')mainName=response.calendarName||mainName;
      if(response.sourceKind==='github-backup'||response.sourceKind==='github-snapshot')direct=false;
      if(response.warning)warnings.push(source.name+': '+response.warning);
    }else{
      direct=false;
      failedCalendarIds.push(source.calendarId);
      warnings.push(source.name+': '+(outcome.reason?.message||'fonte indisponível'));
      // Falha temporária não equivale à exclusão de um evento.
      all.push(...previousEvents.filter(event=>event.sourceCalendarId===source.calendarId));
    }
  });
  if(!completed&&!all.length)throw new Error('Não foi possível consultar nenhuma das fontes públicas.');
  const events=[...new Map(all.filter(event=>event?.id&&event.startDate)
    .map(event=>[event.id,event])).values()]
    .sort((a,b)=>a.startDate.localeCompare(b.startDate)
      ||(a.startAt||'').localeCompare(b.startAt||'')
      ||a.title.localeCompare(b.title,'pt-BR'));
  return {
    calendarId:config.calendarId||publicCalendar.id,
    calendarName:mainName,
    sourceKind:direct?'google-api':'multi-source',
    generatedAt:new Date().toISOString(),
    events,loadedCalendarIds,failedCalendarIds,
    warning:warnings.join(' | '),
    sourceCount:sources.length
  };
}
