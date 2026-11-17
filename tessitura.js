import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, onSnapshot, addDoc, updateDoc, deleteDoc,
  writeBatch, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { hasPanelEntry } from './comissao-entrada.js?v=20261117-tessitura-v1';
import {
  NOTE_LABELS, KEY_LABELS, VOICE_TYPES, midiLabel, hasRange,
  comfortRange, normalizePerson, calculateTones
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
  lockActions(true);
  cloudWarning('Carregando cadastro na nuvem...', false);
  stopSingers = onSnapshot(collection(db, COLLECTION), snapshot => {
    if (!authorized) return;
    mode = 'cloud';
    singers = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    $('cloud-alert').hidden = true;
    lockActions(false);
    renderDirectory();
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

function addNoteOptions(select, allowEmpty = true, min = 24, max = 96) {
  if (allowEmpty) select.add(new Option('Selecione a nota', ''));
  for (let value = min; value <= max; value++) select.add(new Option(midiLabel(value), String(value)));
}
function setupControls() {
  for (const key of VOICE_TYPES) {
    $('field-type').add(new Option(key, key));
    $('singer-filter').add(new Option(key, key));
    $('tone-group').add(new Option(key, key));
  }
  KEY_LABELS.forEach((key, n) => $('song-key').add(new Option(key, String(n))));
  addNoteOptions($('melody-low'), true, 36, 96);
  addNoteOptions($('melody-high'), true, 36, 96);
  ['field-low','field-high','field-comfort-low','field-comfort-high'].forEach(id => addNoteOptions($(id)));
  ['singer-search','singer-filter','show-inactive'].forEach(id =>
    $(id).addEventListener(id === 'singer-search' ? 'input' : 'change', renderDirectory));
  $('add-singer').addEventListener('click', () => openEditor());
  $('close-singer').addEventListener('click', closeEditor);
  $('cancel-singer').addEventListener('click', closeEditor);
  $('singer-dialog').addEventListener('click', event => {
    if (event.target === $('singer-dialog')) closeEditor();
  });
  $('singer-form').addEventListener('submit', saveSinger);
  $('tone-form').addEventListener('submit', evaluate);
  $('import-scale').addEventListener('click', importScale);
  $('demo-button').addEventListener('click', enableLocalDemo);
  lockActions(mode === 'none');
  renderDirectory();
}
function enableLocalDemo() {
  if (!authorized) return;
  stopSingers?.(); stopSingers = null;
  mode = 'local';
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
    singers = Array.isArray(raw) ? raw.filter(x => x && typeof x.nome === 'string') : [];
  } catch (_) { singers = []; }
  lockActions(false);
  cloudWarning('Modo de teste local: os registros ficam apenas neste navegador e NÃO serão sincronizados ao Firebase.', false);
  message('Modo de teste local ativado.');
  renderDirectory();
}
function persistLocal() {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(singers)); }
  catch (_) { message('O navegador não permitiu salvar os dados locais.'); }
}
function renderDirectory() {
  $('metric-total').textContent = singers.filter(p => p.ativo !== false).length;
  $('metric-measured').textContent = singers.filter(p => p.ativo !== false && hasRange(p)).length;
  $('metric-types').textContent = new Set(singers.filter(p => p.ativo !== false).map(p => p.classificacao)).size;
  const term = normalizePerson($('singer-search').value);
  const type = $('singer-filter').value;
  const showInactive = $('show-inactive').checked;
  const filtered = singers.filter(p =>
    (showInactive || p.ativo !== false) &&
    (!term || normalizePerson(p.nome).includes(term)) &&
    (!type || p.classificacao === type));
  $('directory-count').textContent = filtered.length + (filtered.length === 1 ? ' registro' : ' registros');
  const root = $('singers-list');
  root.replaceChildren();
  if (!filtered.length) {
    const empty = dom('div', 'empty');
    const icon = dom('i', 'ph ph-users');
    empty.append(icon, dom('strong', '', singers.length ? 'Nenhum cantor encontrado.' : 'Nenhum cantor cadastrado ainda.'));
    empty.append(dom('p', '', singers.length
      ? 'Ajuste os filtros para visualizar os demais cantores.'
      : 'Use “Novo cantor” ou importe os nomes da Escala Geral.'));
    root.append(empty);
    return;
  }
  for (const typeName of VOICE_TYPES) {
    const people = filtered.filter(p => p.classificacao === typeName)
      .sort((a,b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
    if (!people.length) continue;
    const group = dom('section', 'singer-group');
    const title = dom('div', 'singer-group-title');
    title.append(dom('h3','',typeName), dom('span','group-count',String(people.length)));
    const wrapper = dom('div', 'table-scroll');
    const table = dom('table', 'singer-table');
    const thead = dom('thead'), headRow = dom('tr');
    ['Cantor','Alcance máximo','Tessitura confortável','Situação','Ações'].forEach(label => headRow.append(dom('th','',label)));
    thead.append(headRow);
    const tbody = dom('tbody');
    for (const person of people) {
      const tr = dom('tr');
      const nameCell = dom('td');
      nameCell.append(dom('span','singer-name',person.nome));
      if (person.observacoes) nameCell.append(dom('small','',person.observacoes.slice(0,80)));
      const maximum = dom('td','range-cell',hasRange(person) ? midiLabel(person.grave) + ' — ' + midiLabel(person.aguda) : 'Não medido');
      const comfortValid = Number.isInteger(person.confortoGrave) && Number.isInteger(person.confortoAguda);
      const comfort = dom('td','range-cell',comfortValid
        ? midiLabel(person.confortoGrave) + ' — ' + midiLabel(person.confortoAguda)
        : 'Não informado');
      const status = dom('td');
      const pill = dom('span', 'pill' + (person.ativo === false || !hasRange(person) ? ' warning' : ''),
        person.ativo === false ? 'Inativo' : hasRange(person) ? 'Avaliado' : 'Pendente');
      status.append(pill);
      if (hasRange(person) && !comfortValid) status.append(dom('small','','Conforto não medido'));
      const actions = dom('td');
      const actionRow = dom('div', 'inline-actions');
      const edit = dom('button','icon-action');
      edit.type='button'; edit.title='Editar cantor'; edit.setAttribute('aria-label','Editar ' + person.nome);
      edit.append(dom('i','ph ph-pencil-simple')); edit.addEventListener('click', () => openEditor(person));
      const remove = dom('button','icon-action delete');
      remove.type='button'; remove.title='Excluir cantor'; remove.setAttribute('aria-label','Excluir ' + person.nome);
      remove.append(dom('i','ph ph-trash')); remove.addEventListener('click', () => removeSinger(person));
      actionRow.append(edit,remove); actions.append(actionRow);
      tr.append(nameCell,maximum,comfort,status,actions); tbody.append(tr);
    }
    table.append(thead,tbody); wrapper.append(table); group.append(title,wrapper); root.append(group);
  }
}
function openEditor(person = null) {
  if (mode === 'none') return;
  editId = person?.id || null;
  $('singer-form').reset();
  $('singer-dialog-title').textContent = person ? 'Editar cantor' : 'Novo cantor';
  $('field-name').value = person?.nome || '';
  $('field-type').value = person?.classificacao || 'Soprano';
  $('field-active').checked = person?.ativo !== false;
  $('field-low').value = Number.isInteger(person?.grave) ? String(person.grave) : '';
  $('field-high').value = Number.isInteger(person?.aguda) ? String(person.aguda) : '';
  $('field-comfort-low').value = Number.isInteger(person?.confortoGrave) ? String(person.confortoGrave) : '';
  $('field-comfort-high').value = Number.isInteger(person?.confortoAguda) ? String(person.confortoAguda) : '';
  $('field-notes').value = person?.observacoes || '';
  $('form-error').textContent = '';
  $('singer-dialog').showModal();
  $('field-name').focus();
}
function closeEditor() { $('singer-dialog').close(); }
const selectedNote = id => $(id).value === '' ? null : Number($(id).value);
async function saveSinger(event) {
  event.preventDefault();
  if (!authorized || mode === 'none') return;
  const nome = $('field-name').value.trim().replace(/\s+/g,' ');
  const classificacao = $('field-type').value;
  const grave = selectedNote('field-low');
  const aguda = selectedNote('field-high');
  const confortoGrave = selectedNote('field-comfort-low');
  const confortoAguda = selectedNote('field-comfort-high');
  const observacoes = $('field-notes').value.trim();
  const erro = $('form-error');
  erro.textContent = '';
  if (!nome || nome.length > 100 || !VOICE_TYPES.includes(classificacao)) {
    erro.textContent = 'Informe um nome e uma classificação vocal.'; return;
  }
  if (singers.some(p => p.id !== editId && normalizePerson(p.nome) === normalizePerson(nome))) {
    erro.textContent = 'Este cantor já está cadastrado. Edite o registro existente.'; return;
  }
  if ((grave === null) !== (aguda === null) || (grave !== null && grave >= aguda)) {
    erro.textContent = 'Informe as duas notas do alcance máximo, da mais grave à mais aguda.'; return;
  }
  if ((confortoGrave === null) !== (confortoAguda === null) ||
      (confortoGrave !== null && (grave === null || confortoGrave < grave ||
        confortoAguda > aguda || confortoGrave >= confortoAguda))) {
    erro.textContent = 'A tessitura confortável deve ter duas notas dentro do alcance máximo.'; return;
  }
  const data = { nome, classificacao, grave, aguda, confortoGrave, confortoAguda,
    ativo: $('field-active').checked, observacoes, atualizadoPor: signedEmail };
  const button = $('save-singer');
  button.disabled = true;
  try {
    if (mode === 'cloud') {
      const fields = { ...data, atualizadoEm: serverTimestamp() };
      if (editId) await updateDoc(doc(db, COLLECTION, editId), fields);
      else await addDoc(collection(db, COLLECTION), {
        ...fields, criadoPor: signedEmail, criadoEm: serverTimestamp()
      });
    } else {
      if (editId) singers = singers.map(p => p.id === editId ? { ...p, ...data } : p);
      else singers.push({ id: 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2,8), ...data });
      persistLocal(); renderDirectory();
    }
    closeEditor();
    message('Cadastro de ' + nome + ' salvo' + (mode === 'local' ? ' neste navegador.' : ' na nuvem.'));
  } catch (error) {
    erro.textContent = error.code === 'permission-denied'
      ? 'Sem permissão para gravar. Publique as regras de acesso do Firestore.'
      : 'Não foi possível salvar. Confira a conexão e tente novamente.';
  } finally { button.disabled = false; }
}
async function removeSinger(person) {
  if (!authorized || mode === 'none') return;
  if (!window.confirm('Excluir o cadastro vocal de ' + person.nome + '?')) return;
  try {
    if (mode === 'cloud') await deleteDoc(doc(db, COLLECTION, person.id));
    else {
      singers = singers.filter(p => p.id !== person.id);
      persistLocal(); renderDirectory();
    }
    message(person.nome + ' excluído' + (mode === 'local' ? ' do teste local.' : ' da nuvem.'));
  } catch (_) { message('Não foi possível excluir. Verifique as permissões e a conexão.'); }
}
async function importScale() {
  if (!authorized || mode === 'none') return;
  const button = $('import-scale');
  button.disabled = true;
  message('Lendo integrantes atuais da Escala Geral...');
  try {
    const snapshot = await getDoc(doc(db, 'app_ipcvt', 'escala_geral_dados'));
    const members = snapshot.data()?.members;
    if (!members || typeof members !== 'object') throw new Error('O cadastro da Escala Geral não está disponível.');
    const incoming = [];
    const names = new Set(singers.map(p => normalizePerson(p.nome)));
    for (const type of ['Soprano','Contralto','Tenor']) {
      for (const original of Array.isArray(members[type]) ? members[type] : []) {
        const nome = String(original || '').trim();
        const normalized = normalizePerson(nome);
        if (!nome || nome.length > 100 || names.has(normalized)) continue;
        names.add(normalized);
        incoming.push({ nome, classificacao:type, grave:null, aguda:null,
          confortoGrave:null, confortoAguda:null, ativo:true, observacoes:'',
          atualizadoPor:signedEmail });
      }
    }
    if (!incoming.length) { message('Nenhum novo cantor encontrado na Escala Geral.'); return; }
    if (!window.confirm('Importar ' + incoming.length + ' cantor(es) da Escala Geral? As notas ficarão em branco até serem medidas.')) return;
    if (mode === 'cloud') {
      const batch = writeBatch(db);
      for (const entry of incoming) {
        batch.set(doc(collection(db, COLLECTION)), { ...entry, criadoPor:signedEmail,
          criadoEm:serverTimestamp(), atualizadoEm:serverTimestamp() });
      }
      await batch.commit();
    } else {
      incoming.forEach((entry,n) => singers.push({ ...entry,id:'local-import-'+Date.now()+'-'+n }));
      persistLocal();renderDirectory();
    }
    message(incoming.length + ' cantor(es) importados com sucesso. Preencha agora os alcances e tessituras.');
  } catch (error) { message(error.message || 'Erro ao importar os cantores da Escala Geral.'); }
  finally { button.disabled = false; }
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
