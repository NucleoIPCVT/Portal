// Fontes adicionais da Agenda Anual. Mantém a agenda principal compartilhada com o Planner.
import { publicCalendar, readPublicCalendar, parseCalendarSourceUrl, calendarWebUrl } from './planner-public.js?v=20261116-calendar-source-name-v5';
import { officialIpbEvents2026 } from './agenda-ipb-2026.js?v=20261116-v1';

const BRAZIL_ID = 'pt.brazilian#holiday@group.v.calendar.google.com';
const IPB_URL = 'https://www.ipb.org.br/content/Downloads/Calendario_2026.pdf';
const SETTINGS_KEY = 'ipcvt:agenda:fontes:preferencias:v2';
const MAIN = { id:'ipcvt', kind:'google', name:'IPCVT Calendário', color:'#668e74', fixed:true };
const BRAZIL = { id:'brasil', kind:'google', name:'Datas comemorativas do Brasil', color:'#c89659', calendarId:BRAZIL_ID,
  sourceUrl:'https://calendar.google.com/calendar/ical/pt.brazilian%23holiday%40group.v.calendar.google.com/public/basic.ics', fixed:true };
const IPB = { id:'ipb', kind:'ipb', name:'Datas comemorativas presbiterianas · IPB 2026', color:'#718ab9',
  sourceUrl:IPB_URL, fixed:true };
const clone = value => JSON.parse(JSON.stringify(value));
const validColor = value => /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#78977a';
const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[^a-zA-Z0-9]+/g,' ').trim().toLowerCase();

function getSaved() {
  try {
    const data=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}');
    return {
      enabled:typeof data.enabled==='object' && data.enabled ? data.enabled : {},
      colors:typeof data.colors==='object' && data.colors ? data.colors : {},
      extras:Array.isArray(data.extras)?data.extras:[],
      merge: data.merge!==false
    };
  } catch { return {enabled:{},colors:{},extras:[],merge:true}; }
}
function element(tag, className='', content='') {
  const item=document.createElement(tag);
  if(className)item.className=className;
  if(content)item.textContent=content;
  return item;
}
function sanitizeExtra(value) {
  if(!value || typeof value!=='object' || typeof value.sourceUrl!=='string')return null;
  try{
    const parsed=parseCalendarSourceUrl(value.sourceUrl);
    if(parsed.calendarId!==value.calendarId)return null;
    return {
      id:'google:'+parsed.calendarId,kind:'google',calendarId:parsed.calendarId,sourceUrl:parsed.sourceUrl,
      name:String(value.name || parsed.calendarId).trim().slice(0,100),
      color:validColor(value.color),fixed:false
    };
  }catch{return null;}
}
function decorate(event,source) {
  return {...event,sourceId:source.id,sourceIds:[source.id],calendarName:source.name};
}

export function createAgendaSources({getPrimary,onChange}) {
  const state=getSaved();
  let shared=[];
  let isAdmin=false;
  let persistShared=null;
  const dialog=document.getElementById('agenda-fontes-dialog');
  const openButton=document.getElementById('agenda-settings-button');
  const list=document.getElementById('agenda-fontes-list');
  const form=document.getElementById('agenda-add-source-form');
  const feedback=document.getElementById('agenda-fontes-feedback');
  const checkbox=document.getElementById('agenda-merge-duplicates');
  const primaryButton=document.getElementById('agenda-edit-primary');
  let saving=false;

  function saveLocal(){
    try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(state));}catch(e){console.warn('Preferências não salvas neste navegador.',e);}
  }
  function all(){
    const primary=getPrimary()||{};
    const primarySource={...MAIN,calendarId:primary.calendarId||publicCalendar.id,
      sourceUrl:primary.sourceUrl||publicCalendar.sourceUrl};
    const values=[primarySource,BRAZIL,IPB];
    const used=new Set([primarySource.calendarId,BRAZIL_ID]);
    for(const raw of [...shared,...state.extras]){
      const source=sanitizeExtra(raw);
      if(!source||used.has(source.calendarId))continue;
      used.add(source.calendarId);values.push(source);
    }
    return values.map(source=>({...source,color:validColor(state.colors[source.id]||source.color),
      enabled:state.enabled[source.id]!==false}));
  }
  function active(){return all().filter(source=>source.enabled);}
  function info(sourceId){return all().find(source=>source.id===sourceId)||null;}
  function mergeDuplicates(){return state.merge;}

  function show(message,bad=false) {
    feedback.textContent=message;
    feedback.classList.toggle('is-error',Boolean(bad));
  }
  function render(){
    list.replaceChildren();
    for(const source of all()){
      const row=element('div','agenda-source-row'+(!source.enabled?' is-disabled':''));
      const toggle=element('label','agenda-source-toggle');
      const check=document.createElement('input');
      check.type='checkbox';check.checked=source.enabled;
      check.setAttribute('aria-label','Exibir '+source.name);
      check.addEventListener('change',()=>{
        state.enabled[source.id]=check.checked;
        saveLocal();render();onChange();
      });
      const name=element('span','agenda-source-title',source.name);
      const meta=element('small','agenda-source-meta',
        source.kind==='ipb' ? 'IPB · publicação oficial de 2026' :
        source.id==='ipcvt' ? 'Google Agenda · fonte principal do Planner' : 'Google Agenda · calendário público');
      const text=element('span','agenda-source-copy');
      text.append(name,meta);
      toggle.append(check,text);
      row.append(toggle);
      const options=element('div','agenda-source-options');
      const color=document.createElement('input');
      color.type='color'; color.value=source.color;
      color.setAttribute('aria-label','Cor para '+source.name);
      color.title='Cor de marcação no calendário';
      color.addEventListener('input',()=>{
        state.colors[source.id]=validColor(color.value);
        saveLocal(); onChange();
      });
      options.append(color);
      const link=document.createElement('a');
      link.href=source.kind==='ipb'?IPB_URL:calendarWebUrl(source.calendarId);
      link.target='_blank';link.rel='noopener noreferrer';
      link.title='Abrir a fonte pública';link.textContent='↗';
      options.append(link);
      if(!source.fixed){
        const remove=element('button','agenda-source-remove','Remover');
        remove.type='button';remove.title='Remover esta fonte';
        remove.disabled=saving || (shared.some(item=>item.calendarId===source.calendarId)&&!isAdmin);
        remove.addEventListener('click',async()=>{
          if(saving)return;
          const isShared=shared.some(item=>item.calendarId===source.calendarId);
          try {
            saving=true;render();
            if(isShared){
              if(!isAdmin || !persistShared)throw new Error('Somente um administrador pode remover fontes compartilhadas.');
              await persistShared(shared.filter(item=>item.calendarId!==source.calendarId));
            }else state.extras=state.extras.filter(item=>item.calendarId!==source.calendarId);
            delete state.enabled[source.id];delete state.colors[source.id];
            saveLocal();show('Fonte removida.');onChange();
          } catch(error){show(error.message||'Não foi possível remover a fonte.',true);}
          finally{saving=false;render();}
        });
        options.append(remove);
      }
      row.append(options);
      list.append(row);
    }
    checkbox.checked=state.merge;
    const mode=document.getElementById('agenda-fontes-sharing-note');
    if(mode)mode.textContent=isAdmin
      ? 'Novas fontes são compartilhadas com todos os visitantes do Portal. Ativação, cores e união de datas são preferências deste navegador.'
      : 'Você pode adicionar fontes particulares neste navegador. Fontes públicas para todos os visitantes são administradas pela Comissão.';
    primaryButton.hidden=!isAdmin;
  }
  async function readAll(){
    const enabled=active();
    const results=await Promise.allSettled(enabled.map(async source=>{
      if(source.kind==='ipb')return {source,events:officialIpbEvents2026(),kind:'official-pdf-2026'};
      const snapshot=await readPublicCalendar({calendarId:source.calendarId});
      return {source,events:snapshot.events,kind:snapshot.sourceKind,warning:snapshot.warning};
    }));
    const events=[];
    const warnings=[];
    let direct=true;
    let successes=0;
    results.forEach((result,index)=>{
      const source=enabled[index];
      if(result.status==='rejected'){
        direct=false;
        warnings.push(source.name+': '+(result.reason?.message||'fonte indisponível'));
        return;
      }
      const value=result.value;
      successes++;
      if(source.kind==='google'&&value.kind!=='google-api')direct=false;
      if(value.warning)warnings.push(source.name+': '+value.warning);
      for(const event of value.events||[])events.push(decorate(event,source));
    });
    if(enabled.length && !successes)throw new Error('Não foi possível consultar nenhuma fonte habilitada. '+warnings.join(' | '));
    const merged=[];
    const keys=new Map();
    for(const event of events) {
      const key=norm(event.title)+'|'+event.startDate+'|'+event.endDate+'|'+(event.startAt||'')+'|'+(event.endAt||'');
      if(!state.merge || !keys.has(key)) {
        keys.set(key,merged.length);
        merged.push(event);
      } else {
        const existing=merged[keys.get(key)];
        existing.sourceIds=[...new Set([...(existing.sourceIds||[]),...(event.sourceIds||[])])];
      }
    }
    merged.sort((a,b)=>a.startDate.localeCompare(b.startDate)||(a.startAt||'').localeCompare(b.startAt||'')||
      a.title.localeCompare(b.title,'pt-BR'));
    return {
      calendarId:getPrimary()?.calendarId||publicCalendar.id,
      calendarName:'Agendas integradas IPCVT',
      generatedAt:new Date().toISOString(),
      events:merged,
      sourceKind:direct?'google-api':'multi-source',
      warnings,
      activeSources:enabled.length,
      rawCount:events.length,
      mergedCount:events.length-merged.length
    };
  }

  function setSharedSources(items) {
    const next=(Array.isArray(items)?items:[]).map(sanitizeExtra).filter(Boolean);
    if(JSON.stringify(next)===JSON.stringify(shared))return;
    shared=next;
    render();
    onChange();
  }
  function setAdmin(allowed,save){
    isAdmin=Boolean(allowed);
    persistShared=isAdmin?save:null;
    render();
  }

  checkbox.addEventListener('change',()=>{
    state.merge=checkbox.checked;saveLocal();onChange();
  });
  openButton.addEventListener('click',()=>{show('');render();dialog.showModal();});
  document.getElementById('agenda-fontes-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  primaryButton.addEventListener('click',()=>{
    dialog.close();
    document.getElementById('agenda-config-button').click();
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(saving)return;
    const name=document.getElementById('agenda-source-new-name').value.trim();
    const url=document.getElementById('agenda-source-new-url').value.trim();
    const color=validColor(document.getElementById('agenda-source-new-color').value);
    let parsed;
    try{
      parsed=parseCalendarSourceUrl(url);
      if(!name)throw new Error('Informe um nome para a agenda.');
      if(all().some(source=>source.calendarId===parsed.calendarId))
        throw new Error('Esta agenda já está cadastrada.');
      saving=true;show('Verificando se o calendário é público…');
      // A validação garante que não seja apenas um link com formato correto.
      await readPublicCalendar({calendarId:parsed.calendarId});
      const extra={id:'google:'+parsed.calendarId,kind:'google',calendarId:parsed.calendarId,
        sourceUrl:parsed.sourceUrl,name:name.slice(0,100),color};
      if(isAdmin && persistShared){
        await persistShared([...shared,extra]);
        show('Fonte compartilhada salva. Ela aparecerá para os outros visitantes.');
      }else{
        state.extras.push(extra);
        saveLocal();
        show('Fonte adicionada neste navegador.');
      }
      form.reset();render();onChange();
    }catch(error){show(error.message||'Não foi possível adicionar a agenda.',true);}
    finally{saving=false;}
  });

  render();
  return {all,active,info,mergeDuplicates,readAll,setSharedSources,setAdmin,render};
}
