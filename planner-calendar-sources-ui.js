// Gerenciador de fontes públicas no menu de conta do Planner.
// Usa a mesma configuração do Firebase e o mesmo armazenamento local da Agenda Anual.
import { publicCalendar, parseCalendarSourceUrl, readPublicCalendar, calendarWebUrl } from './planner-public.js?v=20261116-multi-source-ids-v1';

const STORAGE_KEY='ipcvt:agenda:fontes:preferencias:v2';
const DEFAULTS=[
 {id:'brasil',kind:'google',name:'Datas comemorativas do Brasil',
  calendarId:'pt.brazilian#holiday@group.v.calendar.google.com',color:'#c89659'},
 {id:'ipb',kind:'ipb',name:'Datas comemorativas presbiterianas · IPB 2026',
  calendarId:'ipb:official-2026',color:'#718ab9'}
];
const IPB_URL='https://www.ipb.org.br/content/Downloads/Calendario_2026.pdf';
const $=id=>document.getElementById(id);
const icon=()=>'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
const validColor=x=>/^#[0-9a-fA-F]{6}$/.test(x||'')?x:'#78977a';
const make=(tag,cls='',txt='')=>{const el=document.createElement(tag);if(cls)el.className=cls;if(txt)el.textContent=txt;return el;};
function preferences(){
  try{
    const data=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');
    return {
      enabled:data.enabled&&typeof data.enabled==='object'?data.enabled:{},
      colors:data.colors&&typeof data.colors==='object'?data.colors:{},
      extras:Array.isArray(data.extras)?data.extras:[],
      removedLocalIds:Array.isArray(data.removedLocalIds)?data.removedLocalIds:[],
      merge:data.merge!==false
    };
  }catch{return {enabled:{},colors:{},extras:[],removedLocalIds:[],merge:true};}
}
function storePreferences(prefs){
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(prefs));}
  catch{throw new Error('Não foi possível salvar as preferências neste navegador.');}
}
function cleanSource(item){
  if(!item||typeof item.sourceUrl!=='string')return null;
  try{
    const parsed=parseCalendarSourceUrl(item.sourceUrl);
    if(parsed.calendarId!==item.calendarId)return null;
    return {id:'google:'+parsed.calendarId,kind:'google',
      calendarId:parsed.calendarId,sourceUrl:parsed.sourceUrl,
      name:String(item.name||parsed.calendarId).trim().slice(0,100),
      color:validColor(item.color),fixed:false};
  }catch{return null;}
}
export function setupPlannerCalendarSources({getConfig,getSession,saveShared,onLocalChange,onEditPrimary}){
  const dialog=$('pm-calendar-sources-dialog');
  const list=$('pm-calendar-sources-list');
  const feedback=$('pm-calendar-sources-feedback');
  const form=$('pm-calendar-sources-form');
  let busy=false;

  function notify(message='',bad=false){
    feedback.textContent=message;
    feedback.classList.toggle('is-error',Boolean(bad));
  }
  function entries(){
    const config=getConfig();
    const prefs=preferences();
    const main={id:'ipcvt',kind:'google',name:publicCalendar.name,
      calendarId:config.calendarId||publicCalendar.id,sourceUrl:config.sourceUrl||publicCalendar.sourceUrl,
      color:'#668e74',fixed:true};
    const removed=new Set(Array.isArray(config.removedSourceIds)?config.removedSourceIds:[]);
    const activeDefaults=DEFAULTS.filter(x=>!removed.has(x.id)&&!prefs.removedLocalIds.includes(x.id))
      .map(x=>({...x,fixed:true}));
    const used=new Set([main.calendarId,...activeDefaults.map(x=>x.calendarId)]);
    const sources=[main,...activeDefaults];
    const shared=new Set((Array.isArray(config.additionalSources)?config.additionalSources:[]).map(x=>x.calendarId));
    for(const raw of [...(Array.isArray(config.additionalSources)?config.additionalSources:[]),...prefs.extras]){
      const item=cleanSource(raw);
      if(!item||used.has(item.calendarId))continue;
      used.add(item.calendarId);
      sources.push(item);
    }
    return {sources:sources.map(x=>({...x,enabled:x.id==='ipcvt'||prefs.enabled[x.id]!==false,
      color:validColor(prefs.colors[x.id]||x.color),shared:shared.has(x.calendarId)})),
      prefs,config,removed,admin:Boolean(getSession()?.isAdmin)};
  }
  function render(){
    if(!dialog)return;
    const {sources,prefs,config,removed,admin}=entries();
    list.replaceChildren();
    for(const source of sources){
      const row=make('div','pm-source-row'+(!source.enabled?' pm-source-muted':''));
      const label=make('label','pm-source-toggle');
      const input=make('input');input.type='checkbox';input.checked=source.enabled;
      input.disabled=busy||source.id==='ipcvt';
      input.setAttribute('aria-label','Exibir '+source.name);
      input.addEventListener('change',()=>{
        const local=preferences();local.enabled[source.id]=input.checked;
        try{storePreferences(local);notify('Preferência de exibição salva.');onLocalChange();render();}
        catch(error){notify(error.message,true);render();}
      });
      const name=make('span','pm-source-name',source.name);
      const details=make('small','pm-source-subtitle',source.id==='ipcvt'
        ?'Fonte principal · mantida no Planner'
        :source.kind==='ipb'?'Calendário oficial IPB · publicação de 2026'
        :source.shared?'Google Agenda · compartilhada com a Comissão'
        :'Google Agenda · fonte pública');
      const copy=make('span','pm-source-copy');copy.append(name,details);
      label.append(input,copy);row.append(label);
      const actions=make('div','pm-source-actions');
      const color=make('input');color.type='color';color.value=source.color;
      color.disabled=busy;color.title='Cor de identificação';color.setAttribute('aria-label','Cor de '+source.name);
      color.addEventListener('input',()=>{
        const local=preferences();local.colors[source.id]=validColor(color.value);
        try{storePreferences(local);onLocalChange();}
        catch(error){notify(error.message,true);}
      });
      actions.append(color);
      const link=make('a','pm-source-open','↗');
      link.href=source.kind==='ipb'?IPB_URL:calendarWebUrl(source.calendarId);
      link.target='_blank';link.rel='noopener noreferrer';link.title='Abrir fonte pública';
      link.setAttribute('aria-label','Abrir '+source.name+' no site de origem');
      actions.append(link);
      if(source.id!=='ipcvt'){
        const canRemove=admin || !source.shared;
        const trash=make('button','pm-source-trash');
        trash.type='button';trash.innerHTML=icon();
        trash.disabled=busy||!canRemove;
        trash.title=canRemove?'Remover '+source.name:'Somente administrador pode remover fontes compartilhadas';
        trash.setAttribute('aria-label','Remover fonte '+source.name);
        trash.addEventListener('click',async()=>{
          if(busy)return;
          const global=admin&&(source.fixed||source.shared);
          if(!window.confirm('Remover “'+source.name+'” '+(global?'da Agenda Anual e do Planner para todos?':'deste navegador?')))return;
          busy=true;render();
          try{
            if(source.fixed&&admin){
              await saveShared({removedSourceIds:[...new Set([...(config.removedSourceIds||[]),source.id])]});
            }else if(source.fixed){
              const local=preferences();
              local.removedLocalIds=[...new Set([...local.removedLocalIds,source.id])];
              storePreferences(local);onLocalChange();
            }else if(source.shared&&admin){
              await saveShared({additionalSources:(config.additionalSources||[]).filter(x=>x.calendarId!==source.calendarId)});
            }else{
              const local=preferences();
              local.extras=local.extras.filter(x=>x.calendarId!==source.calendarId);
              delete local.enabled[source.id];delete local.colors[source.id];
              storePreferences(local);onLocalChange();
            }
            notify('Fonte removida.');
          }catch(error){notify(error.message||'Não foi possível remover.',true);}
          finally{busy=false;render();}
        });
        actions.append(trash);
      }
      row.append(actions);list.append(row);
    }
    for(const source of DEFAULTS.filter(x=>removed.has(x.id)||(prefs.removedLocalIds||[]).includes(x.id))){
      const row=make('div','pm-source-row pm-source-muted');
      const copy=make('span','pm-source-copy');
      copy.append(make('span','pm-source-name',source.name),
        make('small','pm-source-subtitle','Fonte removida · disponível para restaurar'));
      row.append(copy);
      const restore=make('button','pm-source-restore','Restaurar');
      restore.type='button';
      restore.disabled=busy||(!admin&&removed.has(source.id));
      restore.addEventListener('click',async()=>{
        if(busy)return;
        busy=true;render();
        try{
          if((prefs.removedLocalIds||[]).includes(source.id)){
            const local=preferences();
            local.removedLocalIds=local.removedLocalIds.filter(id=>id!==source.id);
            storePreferences(local);onLocalChange();
          }else if(admin){
            await saveShared({removedSourceIds:(config.removedSourceIds||[]).filter(id=>id!==source.id)});
          }
          notify('Fonte restaurada.');
        }catch(error){notify(error.message||'Falha ao restaurar.',true);}
        finally{busy=false;render();}
      });
      row.append(restore);list.append(row);
    }
    const note=$('pm-calendar-sources-note');
    note.textContent=admin
      ?'Fontes adicionadas aqui serão compartilhadas com a Agenda Anual. As opções de exibição e cores são pessoais deste navegador.'
      :'Você pode adicionar fontes apenas neste navegador. A remoção de fontes compartilhadas exige permissão de administrador.';
    $('pm-calendar-primary-edit').hidden=!admin;
    $('pm-calendar-source-submit').disabled=busy;
  }
  $('pm-calendars').addEventListener('click',()=>{
    if(getSession()?.status!=='authorized')return;
    $('pm-more').open=false;
    notify('');render();dialog.showModal();
  });
  $('pm-calendar-sources-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  $('pm-calendar-primary-edit').addEventListener('click',()=>{
    dialog.close();
    onEditPrimary();
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(busy)return;
    busy=true;render();notify('Verificando a fonte pública no Google…');
    try{
      const name=$('pm-calendar-source-name').value.trim();
      const parsed=parseCalendarSourceUrl($('pm-calendar-source-url').value.trim());
      if(!name)throw new Error('Informe o nome da fonte.');
      const {sources,config,admin}=entries();
      if(sources.some(x=>x.calendarId===parsed.calendarId)||
        (config.additionalSources||[]).some(x=>x.calendarId===parsed.calendarId))throw new Error('Esta agenda já está cadastrada.');
      const checked=await readPublicCalendar({calendarId:parsed.calendarId});
      if(checked.calendarId!==parsed.calendarId)throw new Error('O Google retornou outra agenda.');
      const extra={id:'google:'+parsed.calendarId,kind:'google',calendarId:parsed.calendarId,
        sourceUrl:parsed.sourceUrl,name:name.slice(0,100),color:validColor($('pm-calendar-source-color').value)};
      if(admin){
        await saveShared({additionalSources:[...(config.additionalSources||[]),extra]});
        notify('Fonte compartilhada adicionada. A Agenda Anual também poderá exibi-la.');
      }else{
        const local=preferences();local.extras.push(extra);
        storePreferences(local);onLocalChange();
        notify('Fonte adicionada neste navegador.');
      }
      form.reset();
    }catch(error){notify(error.message||'Não foi possível adicionar o calendário.',true);}
    finally{busy=false;render();}
  });
  return {render};
}
