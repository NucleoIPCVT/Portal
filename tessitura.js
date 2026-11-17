import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, onSnapshot, addDoc, updateDoc, deleteDoc,
  runTransaction, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { hasPanelEntry } from './comissao-entrada.js?v=20261117-tessitura-v1';
import { createNotePicker } from './tessitura-notes.js?v=20261117-v1';
import {
  NOTE_LABELS, KEY_LABELS, VOICE_TYPES, midiLabel, hasRange,
  comfortRange, normalizePerson, calculateTones, suggestVoiceSection
} from './tessitura-core.js?v=20261117-v1';

const app = initializeApp({
  apiKey: 'AIzaSyAg9w5QohkcmXUFRgLfSI5Sh1chnCD1Owc',
  authDomain: 'repertorio-ipcvt.firebaseapp.com',
  projectId: 'repertorio-ipcvt',
  storageBucket: 'repertorio-ipcvt.firebasestorage.app',
  messagingSenderId: '774659782213',
  appId: '1:774659782213:web:5e9cbf88fec30eb382152c'
}, 'ipcvt-comissao');
const auth = getAuth(app);
const db = getFirestore(app);
const COLLECTION = 'comissao_tessitura';
const LOCAL_KEY = 'ipcvt:tessitura:teste-local';
const $ = id => document.getElementById(id);
const dom = (tag, cls = '', txt = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.textContent = txt;
  return e;
};
let singers = [], signedEmail = '', editId = null, selectedResult = null;
let stopAccess = null, stopSingers = null, sessionCounter = 0;
let authorized = false, mode = 'none', initialized = false;

function setTheme() {
  const dark = document.documentElement.getAttribute('data-portal-theme') === 'dark';
  const toggle = $('voice-theme-toggle');
  toggle.setAttribute('aria-label', dark ? 'Ativar modo claro' : 'Ativar modo escuro');
  toggle.title = toggle.getAttribute('aria-label');
  toggle.setAttribute('aria-pressed', String(dark));
  toggle.querySelector('i').className = dark ? 'ph ph-sun' : 'ph ph-moon-stars';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#303234' : '#f6ede3';
}
$('voice-theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-portal-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-portal-theme', next);
  try { localStorage.setItem('ipcvt-portal-theme', next); } catch (_) {}
  setTheme();
});
setTheme();

function message(text) { $('page-feedback').textContent = text; }
function lockActions(locked) {
  $('add-singer').disabled = locked;
  $('import-scale').disabled = locked;
  $('tone-form').querySelector('button[type="submit"]').disabled = locked;
}
function gate(text) {
  $('voice-gate').hidden = false;
  $('gate-message').textContent = text;
  $('voice-app').hidden = true;
}
function reveal() {
  $('voice-gate').hidden = true;
  $('voice-app').hidden = false;
  if (!initialized) { initialized = true; setupControls(); }
}
function cloudWarning(text, demo = true) {
  $('cloud-alert').hidden = false;
  $('cloud-message').textContent = text;
  $('demo-button').hidden = !demo;
}
function clearSubscriptions() {
  stopAccess?.(); stopSingers?.();
  stopAccess = null; stopSingers = null;
}
function startCloud() {
  if (!authorized) return;
  stopSingers?.();
  mode = 'none';
  bootstrapped = false;
  lockActions(true);
  cloudWarning('Carregando cadastro na nuvem...', false);
  stopSingers = onSnapshot(collection(db, COLLECTION), snapshot => {
    if (!authorized) return;
    mode = 'cloud';
    singers = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    $('cloud-alert').hidden = true;
    lockActions(false);
    renderDirectory();
    // Sincroniza somente após a leitura confirmada do servidor.
    // Um primeiro snapshot vazio do cache local não significa cadastro vazio na nuvem.
    if (!bootstrapped && !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) {
      bootstrapped = true;
      void importScale(true);
    }
  }, error => {
    if (!authorized) return;
    mode = 'none';
    singers = [];
    renderDirectory();
    lockActions(true);
    cloudWarning(error.code === 'permission-denied'
      ? 'A tela está pronta, mas é necessário publicar as novas regras do Firestore para salvar dados na nuvem.'
      : 'Erro de conexão com a nuvem. Você pode testar a interface localmente sem gravar na nuvem.');
  });
}
onAuthStateChanged(auth, async user => {
  const session = ++sessionCounter;
  clearSubscriptions();
  authorized = false; mode = 'none'; singers = []; signedEmail = '';
  lockActions(true);
  gate('Conferindo sua sessão...');
  if (!user) {
    gate('Entre no Painel da Comissão e abra esta ferramenta por lá.');
    return;
  }
  try {
    const token = await user.getIdTokenResult();
    if (session !== sessionCounter) return;
    signedEmail = (user.email || '').trim().toLowerCase();
    if (!user.emailVerified || token.claims.firebase?.sign_in_provider !== 'google.com' || !signedEmail) {
      gate('Esta ferramenta exige uma conta Google verificada e autorizada pela Comissão.');
      return;
    }
    if (!hasPanelEntry('tessitura', user.uid)) {
      gate('Para iniciar a ferramenta, abra-a pelo Painel da Comissão.');
      return;
    }
    stopAccess = onSnapshot(doc(db, 'comissao_acessos', signedEmail), snap => {
      if (session !== sessionCounter) return;
      const allowed = snap.exists() && snap.data().ativo === true;
      if (!allowed) {
        authorized = false;
        stopSingers?.(); stopSingers = null;
        gate('Sua conta não está autorizada na Comissão. Solicite liberação à coordenação.');
        return;
      }
      if (!authorized) {
        authorized = true;
        reveal();
        startCloud();
      }
    }, () => gate('Não foi possível conferir a autorização no Firebase. Abra novamente a Comissão.'));
  } catch (_) {
    if (session === sessionCounter) gate('Não foi possível validar a sessão. Abra novamente o Painel da Comissão.');
  }
});


const NOTE_FIELDS = [
  ['grave','Nota mais grave · alcance máximo'],
  ['aguda','Nota mais aguda · alcance máximo'],
  ['confortoGrave','Nota grave · tessitura confortável'],
  ['confortoAguda','Nota aguda · tessitura confortável']
];
let draft = null;
let bootstrapped = false;

function setupControls() {
  for (const key of VOICE_TYPES) {
    $('singer-filter').add(new Option(key,key));
    $('tone-group').add(new Option(key,key));
  }
  const attachPicker = (id, settings = {}) => {
    const field = $(id);
    const parent = $(id + '-picker');
    const picker = createNotePicker({
      ...settings,
      ariaLabel: id === 'melody-low' ? 'Nota grave da melodia' :
        id === 'melody-high' ? 'Nota aguda da melodia' : 'Tom original da música',
      onChange(value) {
        field.value = value === null ? '' : String(value);
        $('calculation-output').hidden = true;
      }
    });
    parent.append(picker.element);
  };
  attachPicker('melody-low',{min:36,max:96});
  attachPicker('melody-high',{min:36,max:96});
  attachPicker('song-key',{octave:false});
  ['singer-search','singer-filter','show-inactive'].forEach(id =>
    $(id).addEventListener(id === 'singer-search' ? 'input' : 'change', renderDirectory));
  $('add-singer').addEventListener('click', () => openEditor());
  $('tone-form').addEventListener('submit', evaluate);
  $('import-scale').addEventListener('click', () => importScale(false));
  $('demo-button').addEventListener('click', enableLocalDemo);
  lockActions(mode === 'none');
  renderDirectory();
}

async function enableLocalDemo() {
  if (!authorized) return;
  stopSingers?.(); stopSingers = null;
  mode = 'local';
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
    singers = Array.isArray(raw) ? raw.filter(x => x && typeof x.nome === 'string') : [];
  } catch (_) { singers = []; }
  lockActions(false);
  cloudWarning('Modo de teste local: registros somente neste navegador, sem sincronização com o Firebase.', false);
  message('Modo de teste local ativado.');
  renderDirectory();
  if (!singers.length) await importScale(true);
}
function persistLocal() {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(singers)); }
  catch (_) { message('Não foi possível salvar neste navegador.'); }
}
function openEditor(person = null) {
  if (!authorized || mode === 'none') return;
  editId = person?.id || 'new';
  draft = {
    nome: person?.nome || '',
    classificacao: person?.classificacao || 'Não classificado',
    grave: Number.isInteger(person?.grave) ? person.grave : null,
    aguda: Number.isInteger(person?.aguda) ? person.aguda : null,
    confortoGrave: Number.isInteger(person?.confortoGrave) ? person.confortoGrave : null,
    confortoAguda: Number.isInteger(person?.confortoAguda) ? person.confortoAguda : null,
    ativo: person?.ativo !== false,
    observacoes: person?.observacoes || ''
  };
  if (editId === 'new') {
    $('singer-search').value = '';
    $('singer-filter').value = '';
  }
  renderDirectory();
  const open = document.querySelector('.vocal-inline-form');
  open?.scrollIntoView({behavior:'smooth',block:'nearest'});
  open?.querySelector('input[name="nome"]')?.focus({preventScroll:true});
}
function closeEditor() {
  editId = null;
  draft = null;
  renderDirectory();
}

function inlineEditor(person = null) {
  const box = dom('div','vocal-inline-box');
  const form = dom('form','vocal-inline-form');
  form.noValidate = true;
  const head = dom('div','inline-heading');
  const heading = dom('div');
  heading.append(dom('strong','',person ? 'Editar notas e dados de ' + person.nome : 'Adicionar cantor'));
  heading.append(dom('small','', 'Selecione a oitava e clique na nota: o botão selecionado ficará aceso.'));
  head.append(heading);
  const cancelTop = dom('button','inline-cancel-top','✕');
  cancelTop.type='button';cancelTop.title='Fechar edição';cancelTop.setAttribute('aria-label','Fechar edição');
  cancelTop.addEventListener('click',closeEditor);
  head.append(cancelTop);
  form.append(head);

  const basic = dom('div','inline-basics');
  const nameLabel=dom('label','','Nome do cantor');
  const name=dom('input');name.type='text';name.name='nome';name.maxLength=100;
  name.required=true;name.value=draft.nome;
  name.addEventListener('input',()=>{draft.nome=name.value;});
  nameLabel.append(name);
  const typeLabel=dom('label','','Classificação vocal');
  const type=dom('select');
  for(const v of VOICE_TYPES)type.add(new Option(v,v));
  type.value=draft.classificacao;
  typeLabel.append(type);
  const activeLabel=dom('label','inline-active');
  const active=dom('input');active.type='checkbox';active.checked=draft.ativo;
  active.addEventListener('change',()=>{draft.ativo=active.checked;});
  activeLabel.append(active,dom('span','','Cantor ativo'));
  basic.append(nameLabel,typeLabel,activeLabel);
  form.append(basic);

  // Apenas sugestão: a classificação final continua sob controle da equipe.
  const suggestion=dom('div','voice-suggestion');
  suggestion.setAttribute('aria-live','polite');
  const suggestionText=dom('div','voice-suggestion-text');
  const suggestionApply=dom('button','button subtle voice-suggestion-apply');
  suggestionApply.type='button';
  function refreshSuggestion(){
    const result=suggestVoiceSection(draft);
    suggestionApply.hidden=true;
    suggestionText.replaceChildren();
    if(!result){
      suggestionText.append(dom('strong','','Sugestão de naipe'));
      suggestionText.append(dom('span','',' · Preencha grave e agudo confortáveis para receber uma indicação.'));
      return;
    }
    const value=result.type;
    const caption=result.lowConfidence||result.outOfReference
      ? 'Indicação incerta; confirme timbre e região de passagem.'
      : 'Indicação aproximada; confirme com a avaliação vocal.';
    suggestionText.append(dom('strong','','Naipe sugerido: '+value));
    suggestionText.append(dom('span','',' · '+caption));
    if(result.lowConfidence&&result.alternate){
      suggestionText.append(dom('span','',' Alternativa possível: '+result.alternate+'.'));
    }
    if(value!==draft.classificacao){
      suggestionApply.hidden=false;
      suggestionApply.textContent='Usar '+value;
      suggestionApply.onclick=()=>{
        draft.classificacao=value;
        type.value=value;
        refreshSuggestion();
      };
    }
  }
  type.addEventListener('change',()=>{draft.classificacao=type.value;refreshSuggestion();});
  suggestion.append(suggestionText,suggestionApply);

  const rangeGrid=dom('div','inline-note-grid');
  for(const [field,label] of NOTE_FIELDS){
    const panel=dom('div','inline-note-field');
    panel.append(dom('div','note-field-title',label));
    const picker=createNotePicker({
      value:draft[field],min:24,max:96,ariaLabel:label+' de '+(person?.nome||'novo cantor'),
      onChange(value){draft[field]=value;if(field==='confortoGrave'||field==='confortoAguda')refreshSuggestion();}
    });
    panel.append(picker.element);
    rangeGrid.append(panel);
  }
  form.append(rangeGrid);
  form.append(suggestion);
  refreshSuggestion();
  const noteLabel=dom('label','inline-notes','Observações (opcional)');
  const notes=dom('textarea');notes.rows=2;notes.maxLength=600;notes.value=draft.observacoes;
  notes.placeholder='Data da avaliação, notas menos estáveis...';
  notes.addEventListener('input',()=>{draft.observacoes=notes.value;});
  noteLabel.append(notes);form.append(noteLabel);

  const helper=dom('p','field-hint','Os limites confortáveis devem estar dentro do alcance máximo. Deixe sem nota enquanto não houver avaliação.');
  const error=dom('p','form-error');
  error.setAttribute('role','alert');
  const actions=dom('div','inline-save-actions');
  const cancel=dom('button','button subtle','Cancelar');
  cancel.type='button';cancel.addEventListener('click',closeEditor);
  const save=dom('button','button primary','Salvar alterações');
  save.type='submit';save.prepend(dom('i','ph ph-check-circle'));
  actions.append(cancel,save);
  form.append(helper,error,actions);
  form.addEventListener('submit',e=>saveSinger(e,error,save));
  box.append(form);
  return box;
}

function noteCell(person,field){
  const td=dom('td','note-summary-cell');
  const captions={grave:'Grave máx.',aguda:'Agudo máx.',confortoGrave:'Grave confortável',confortoAguda:'Agudo confortável'};
  td.append(dom('span','note-mobile-label',captions[field]));
  const num=person[field];
  const btn=dom('button','inline-note-button'+(Number.isInteger(num)?' is-set':''),Number.isInteger(num)?midiLabel(num):'+');
  btn.type='button';
  btn.setAttribute('aria-label','Editar '+field+' de '+person.nome+(Number.isInteger(num)?' ('+midiLabel(num)+')':''));
  btn.title='Clique para selecionar uma nota na própria lista';
  btn.addEventListener('click',()=>openEditor(person));
  td.append(btn);
  return td;
}

function renderDirectory(){
  $('metric-total').textContent=singers.filter(p=>p.ativo!==false).length;
  $('metric-measured').textContent=singers.filter(p=>p.ativo!==false&&hasRange(p)).length;
  $('metric-types').textContent=new Set(singers.filter(p=>p.ativo!==false).map(p=>p.classificacao)).size;
  const search=normalizePerson($('singer-search').value);
  const filter=$('singer-filter').value;
  const visible=singers.filter(p=>
    ($('show-inactive').checked||p.ativo!==false) &&
    (!search||normalizePerson(p.nome).includes(search)) &&
    (!filter||p.classificacao===filter));
  $('directory-count').textContent=visible.length+(visible.length===1?' registro':' registros');
  const newArea=$('singer-new-entry');
  newArea.replaceChildren();
  newArea.hidden=editId!=='new'||!draft;
  if(!newArea.hidden)newArea.append(inlineEditor());
  const root=$('singers-list');
  root.replaceChildren();
  if(!visible.length){
    const empty=dom('div','empty');
    empty.append(dom('i','ph ph-users'),dom('strong','',singers.length?'Nenhum cantor encontrado.':'Nenhum cantor cadastrado.'));
    empty.append(dom('p','','Os cantores da Escala Geral são adicionados automaticamente quando a nuvem está disponível.'));
    root.append(empty);
    return;
  }
  for(const groupName of VOICE_TYPES){
    const people=visible.filter(p=>p.classificacao===groupName).sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
    if(!people.length)continue;
    const section=dom('section','singer-group');
    const heading=dom('div','singer-group-title');
    heading.append(dom('h3','',groupName),dom('span','group-count',String(people.length)));
    const scroll=dom('div','table-scroll');
    const table=dom('table','singer-table');
    const thead=dom('thead'),heads=dom('tr');
    ['Cantor','Grave máx.','Agudo máx.','Grave confortável','Agudo confortável','Situação','Ações']
      .forEach(str=>heads.append(dom('th','',str)));
    thead.append(heads);
    const tbody=dom('tbody');
    for(const p of people){
      const tr=dom('tr',editId===p.id?'is-editing':'');
      const name=dom('td');
      name.append(dom('strong','singer-name',p.nome));
      if(p.observacoes)name.append(dom('small','',p.observacoes.slice(0,80)));
      const hint=suggestVoiceSection(p);
      if(hint&&hint.type!==p.classificacao)
        name.append(dom('small','voice-suggestion-inline','Sugestão: '+hint.type+' · confirmar'));
      tr.append(name);
      for(const [field] of NOTE_FIELDS)tr.append(noteCell(p,field));
      const state=dom('td');
      const status=p.ativo===false?'Inativo':hasRange(p)?'Avaliado':'Pendente';
      state.append(dom('span','pill'+(status==='Avaliado'?'':' warning'),status));
      const comfort=Number.isInteger(p.confortoGrave)&&Number.isInteger(p.confortoAguda);
      if(hasRange(p)&&!comfort)state.append(dom('small','','Conforto não medido'));
      tr.append(state);
      const actions=dom('td'),buttons=dom('div','inline-actions');
      const edit=dom('button','icon-action');
      edit.type='button';edit.title='Editar nesta linha';edit.setAttribute('aria-label','Editar '+p.nome);
      edit.append(dom('i','ph ph-pencil-simple'));edit.addEventListener('click',()=>openEditor(p));
      const del=dom('button','icon-action delete');
      del.type='button';del.title='Excluir cantor';del.setAttribute('aria-label','Excluir '+p.nome);
      del.append(dom('i','ph ph-trash'));del.addEventListener('click',()=>removeSinger(p));
      buttons.append(edit,del);actions.append(buttons);tr.append(actions);
      tbody.append(tr);
      if(editId===p.id&&draft){
        const detail=dom('tr','expanded-singer-row');
        const cell=dom('td');cell.colSpan=7;
        cell.append(inlineEditor(p));
        detail.append(cell);tbody.append(detail);
      }
    }
    table.append(thead,tbody);scroll.append(table);section.append(heading,scroll);root.append(section);
  }
}

async function saveSinger(event,error,button){
  event.preventDefault();
  if(!authorized||mode==='none'||!draft)return;
  error.textContent='';
  const name=String(draft.nome).trim().replace(/\s+/g,' ');
  const type=draft.classificacao;
  const grave=draft.grave,aguda=draft.aguda;
  const cLow=draft.confortoGrave,cHigh=draft.confortoAguda;
  if(!name||name.length>100||!VOICE_TYPES.includes(type)){
    error.textContent='Informe o nome e o naipe do cantor.';return;
  }
  if(singers.some(p=>p.id!==editId&&normalizePerson(p.nome)===normalizePerson(name))){
    error.textContent='Esse cantor já existe. Abra o cadastro dele na lista.';return;
  }
  if((grave===null)!==(aguda===null)||(grave!==null&&grave>=aguda)){
    error.textContent='Preencha os dois extremos do alcance, do grave ao agudo.';return;
  }
  if((cLow===null)!==(cHigh===null)||
    (cLow!==null&&(grave===null||cLow<grave||cHigh>aguda||cLow>=cHigh))){
    error.textContent='A tessitura confortável precisa ter dois extremos dentro do alcance máximo.';return;
  }
  button.disabled=true;
  const data={nome:name,classificacao:type,grave,aguda,confortoGrave:cLow,confortoAguda:cHigh,
    ativo:draft.ativo,observacoes:draft.observacoes.trim(),atualizadoPor:signedEmail};
  try{
    if(mode==='cloud'){
      const fields={...data,atualizadoEm:serverTimestamp()};
      if(editId!=='new')await updateDoc(doc(db,COLLECTION,editId),fields);
      else await addDoc(collection(db,COLLECTION),{...fields,criadoPor:signedEmail,criadoEm:serverTimestamp()});
    }else{
      if(editId!=='new')singers=singers.map(p=>p.id===editId?{...p,...data}:p);
      else singers.push({id:'local-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),...data});
      persistLocal();
    }
    editId=null;draft=null;renderDirectory();
    message(name+' salvo '+(mode==='cloud'?'na nuvem.':'neste navegador (teste local).'));
  }catch(e){
    error.textContent=e.code==='permission-denied'?
      'Sem permissão de gravação. Verifique as regras do Firebase.':
      'Erro ao salvar. Confira sua conexão.';
  }finally{button.disabled=false;}
}

async function removeSinger(p){
  if(!authorized||mode==='none')return;
  if(!window.confirm('Excluir o cadastro de '+p.nome+'?'))return;
  try{
    if(mode==='cloud')await deleteDoc(doc(db,COLLECTION,p.id));
    else{singers=singers.filter(x=>x.id!==p.id);persistLocal();renderDirectory();}
    if(editId===p.id){editId=null;draft=null;}
    message(p.nome+' excluído.');
  }catch(_){message('Não foi possível excluir.');}
}

const scaleSingerId=name=>'escala-'+normalizePerson(name).replace(/[^a-z0-9]+/g,'-').slice(0,95);

async function importScale(silent=false){
  if(!authorized||mode==='none')return;
  const button=$('import-scale');
  button.disabled=true;
  if(!silent)message('Consultando a Escala Geral...');
  try{
    const scale=await getDoc(doc(db,'app_ipcvt','escala_geral_dados'));
    const members=scale.data()?.members;
    if(!members||typeof members!=='object')throw new Error('A Escala Geral ainda não possui cadastro acessível.');
    const names=new Set(singers.map(p=>normalizePerson(p.nome)));
    const pending=[];
    for(const type of ['Soprano','Contralto','Tenor']){
      for(const nameValue of Array.isArray(members[type])?members[type]:[]){
        const nome=String(nameValue||'').trim().replace(/\s+/g,' ');
        const normalized=normalizePerson(nome);
        if(!nome||nome.length>100||names.has(normalized))continue;
        names.add(normalized);
        pending.push({nome,classificacao:type,grave:null,aguda:null,
          confortoGrave:null,confortoAguda:null,ativo:true,observacoes:'',
          atualizadoPor:signedEmail});
      }
    }
    if(!pending.length){
      if(!silent)message('Todos os cantores da Escala Geral já estão cadastrados.');
      return;
    }
    if(mode==='cloud'){
      await runTransaction(db,async tx=>{
        const refs=pending.map(person=>doc(db,COLLECTION,scaleSingerId(person.nome)));
        const docs=await Promise.all(refs.map(ref=>tx.get(ref)));
        for(let i=0;i<refs.length;i++){
          if(docs[i].exists())continue;
          tx.set(refs[i],{...pending[i],criadoPor:signedEmail,
            criadoEm:serverTimestamp(),atualizadoEm:serverTimestamp()});
        }
      });
    }else{
      pending.forEach((p,i)=>singers.push({id:'local-scale-'+Date.now()+'-'+i,...p}));
      persistLocal();renderDirectory();
    }
    message(pending.length+' cantor(es) da Escala Geral adicionados. As notas permanecem em branco para avaliação.');
  }catch(e){
    if(!silent)message(e.message||'Falha ao consultar a Escala Geral.');
    else message('Não foi possível sincronizar os nomes da Escala Geral: '+(e.message||'verifique o acesso.'));
  }finally{button.disabled=mode==='none';}
}

function evaluate(event) {
  event.preventDefault();
  if (!authorized || mode === 'none') return;
  const low = $('melody-low').value, high = $('melody-high').value;
  const key = $('song-key').value;
  const filter = $('tone-group').value;
  const people = singers.filter(p => (!filter || p.classificacao === filter) && p.ativo !== false);
  const output = $('calculation-output');
  output.hidden = false;
  output.replaceChildren();
  try {
    const result = calculateTones(people, low === '' ? NaN : Number(low), high === '' ? NaN : Number(high),
      key === '' ? null : Number(key));
    selectedResult = result;
    renderResult(result.best);
  } catch (err) {
    output.append(dom('p','form-error',err.message));
  }
}
function shiftLabel(shift) {
  return shift === 0 ? 'Manter o tom' : 'Transpor ' + (shift > 0 ? '+' : '') + shift + ' semitons';
}
function toneLabel(result) {
  return result.key === null ? shiftLabel(result.shift) : KEY_LABELS[result.key] + ' · ' + shiftLabel(result.shift);
}
function renderResult(choice) {
  const output = $('calculation-output');
  output.hidden = false;
  output.replaceChildren();
  const top = dom('div','result-top'), desc = dom('div');
  desc.append(dom('p','eyebrow','SUGESTÃO PARA O GRUPO'));
  const title = dom('div','result-tone');
  title.append(dom('strong','',toneLabel(choice)));
  desc.append(title);
  desc.append(dom('p','result-detail',
    'Faixa da melodia transposta: ' +
    midiLabel(Number($('melody-low').value) + choice.shift) + ' — ' +
    midiLabel(Number($('melody-high').value) + choice.shift) + '.'));
  const badges = dom('div','result-badges');
  badges.append(dom('span','pill',choice.comfortable + '/' + choice.total + ' confortáveis'));
  if (choice.reachable !== choice.total) badges.append(dom('span','pill danger',
    (choice.total - choice.reachable) + ' fora do alcance máximo'));
  else if (choice.comfortable !== choice.total) badges.append(dom('span','pill warning',
    (choice.total - choice.comfortable) + ' no limite'));
  if (selectedResult.incomplete) badges.append(dom('span','pill warning',
    selectedResult.incomplete + ' sem medição (fora do cálculo)'));
  desc.append(badges);top.append(desc);output.append(top);
  const noComfort = choice.evaluations.filter(e => {
    const singer = singers.find(p => p.id === e.id);
    return singer && !Number.isInteger(singer.confortoGrave);
  }).length;
  if (noComfort) output.append(dom('p','result-detail',
    'Estimativa provisória: ' + noComfort + ' cantor(es) não têm tessitura confortável medida. Foi usado o alcance máximo.'));
  const others = selectedResult.all.filter(c => c.shift !== choice.shift).slice(0,3);
  const alt = dom('div','alternatives','Outras transposições para comparar: ');
  others.forEach(item => {
    const button = dom('button','',item.key === null
      ? shiftLabel(item.shift) : KEY_LABELS[item.key] + ' (' + (item.shift > 0 ? '+' : '') + item.shift + ')');
    button.type='button'; button.addEventListener('click', () => renderResult(item)); alt.append(button);
  });
  output.append(alt);
  const people = dom('div','result-people');
  choice.evaluations.sort((a,b) => a.nome.localeCompare(b.nome,'pt-BR'));
  for (const singer of choice.evaluations) {
    const personData = singers.find(p => p.id === singer.id);
    const estimated = personData && !Number.isInteger(personData.confortoGrave);
    const label = singer.status === 'confortavel' ? (estimated ? 'Compatível (estimado)' : 'Confortável') :
      singer.status === 'limite' ? 'No limite' : 'Fora do alcance';
    const card = dom('div','result-person ' + singer.status);
    card.append(dom('span','status-dot'));
    const detail = dom('div');
    detail.append(dom('strong','',singer.nome));
    detail.append(dom('small','',label + ' · ' + singer.classificacao +
      (singer.octave ? ' · ' + (singer.octave > 0 ? '+' : '') + singer.octave/12 + ' oitava(s)' : ' · oitava original')));
    card.append(detail);people.append(card);
  }
  output.append(people);
}
