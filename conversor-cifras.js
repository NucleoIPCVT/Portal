import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getAuth,onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { getFirestore,doc,onSnapshot } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { hasPanelEntry } from './comissao-entrada.js?v=20261124-cifras-v1';
import { convertLines } from './conversor-cifras-core.js?v=1';
const firebase=initializeApp({
  apiKey: 'AIzaSyAg9w5QohkcmXUFRgLfSI5Sh1chnCD1Owc',
  authDomain: 'repertorio-ipcvt.firebaseapp.com',
  projectId: 'repertorio-ipcvt',
  storageBucket: 'repertorio-ipcvt.firebasestorage.app',
  messagingSenderId: '774659782213',
  appId: '1:774659782213:web:5e9cbf88fec30eb382152c'
},'ipcvt-comissao');
const auth=getAuth(firebase),db=getFirestore(firebase),$=id=>document.getElementById(id);
let allowed=false,stop=null,seq=0,pending=null,original='',song='cifra-ipcvt';
let accessTimer=null;
const setGateMessage=(title,msg)=>{$('gate').querySelector('h1').textContent=title;$('gate-message').textContent=msg;};
function gate(msg,loading=false){allowed=false;$('gate').hidden=false;$('app').hidden=true;setGateMessage(loading?'Verificando acesso':'Acesso ao conversor',msg);pending=null;$('import').disabled=false;original='';$('editor').value='';render()}
function clearAccessTimer(){clearTimeout(accessTimer);accessTimer=null}
function deadline(p,ms,msg){let t;return Promise.race([p,new Promise((_,reject)=>{t=setTimeout(()=>reject(Error(msg)),ms)})]).finally(()=>clearTimeout(t))}
function startAuth(){
  let firstTimer=setTimeout(()=>{gate('O serviço de login não respondeu. Atualize a página ou volte à Comissão.')},12000);
  onAuthStateChanged(auth,async user=>{
    clearTimeout(firstTimer);const id=++seq;stop?.();stop=null;clearAccessTimer();
    gate('Conferindo sua conta Google...',true);
    if(!user){gate('Entre no Painel da Comissão e abra a ferramenta pelo painel.');return}
    try{
      const token=await deadline(user.getIdTokenResult(),12000,'A validação da conta Google demorou demais. Abra novamente a Comissão.');
      if(id!==seq)return;
      const email=(user.email||'').trim().toLowerCase();
      if(!email||!user.emailVerified||token.claims.firebase?.sign_in_provider!=='google.com'){gate('Entre com uma conta Google verificada e autorizada.');return}
      if(!hasPanelEntry('cifras',user.uid)){gate('A entrada desta aba expirou ou não foi registrada. Abra o Conversor novamente pelo Painel da Comissão.');return}
      setGateMessage('Verificando acesso','Consultando sua autorização no Firebase...');
      accessTimer=setTimeout(()=>{if(id===seq&&!allowed)gate('A consulta de autorização não respondeu. Confira a conexão e tente novamente pela Comissão.')},12000);
      stop=onSnapshot(doc(db,'comissao_acessos',email),snap=>{
        if(id!==seq)return;
        // Não liberar acesso com uma resposta apenas do cache.
        if(snap.metadata?.fromCache)return;
        clearAccessTimer();
        if(!snap.exists()||snap.data().ativo!==true){gate('Sua conta não está autorizada na Comissão.');return}
        allowed=true;$('gate').hidden=true;$('app').hidden=false;
      },error=>{if(id!==seq)return;clearAccessTimer();gate('Não foi possível verificar a autorização no Firebase ('+(error.code||'falha de conexão')+').')});
    }catch(error){if(id===seq){clearAccessTimer();gate(error.message||'Não foi possível validar sua sessão.')}}
  },error=>{clearTimeout(firstTimer);clearAccessTimer();gate('Falha ao iniciar o login ('+(error.code||'erro de conexão')+').')});
}
function theme(){const dark=document.documentElement.dataset.portalTheme==='dark';$('theme').querySelector('i').className=dark?'ph ph-sun':'ph ph-moon-stars';$('theme').setAttribute('aria-label',dark?'Ativar modo claro':'Ativar modo escuro');$('theme').setAttribute('aria-pressed',String(dark));document.querySelector('meta[name=theme-color]').content=dark?'#252b34':'#eef6ff'}
$('theme').onclick=()=>{document.documentElement.dataset.portalTheme=document.documentElement.dataset.portalTheme==='dark'?'light':'dark';try{localStorage.setItem('ipcvt-portal-theme',document.documentElement.dataset.portalTheme)}catch{}theme()};theme();
function status(s,error=false){$('status').textContent=s;$('status').classList.toggle('error',error)}
const IMPORT_URL='https://ipcvt-cifras-importador.hudsonamorim08.workers.dev/import';
$('form').onsubmit=async e=>{e.preventDefault();if(!allowed||pending)return;let url;try{url=new URL($('url').value.trim());if(url.protocol!=='https:'||!['cifraclub.com.br','www.cifraclub.com.br'].includes(url.hostname)||url.port||!/^\/[a-z0-9_-]+\/[a-z0-9_-]+\/?$/i.test(url.pathname)||url.username||url.password)throw Error()}catch{status('Informe um link HTTPS de uma música do Cifra Club.',true);return}
if($('editor').value!==original&&$('editor').value&&!confirm('Substituir a cifra que está sendo editada?'))return;
const id=crypto.randomUUID();pending=id;$('import').disabled=true;status('Consultando o Cifra Club...');
const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
try{const token=await auth.currentUser.getIdToken();const response=await fetch(IMPORT_URL,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({url:url.href}),signal:controller.signal});const m=await response.json();if(!allowed||pending!==id)return;if(!response.ok||!m.ok)throw Error(m.error||'Não foi possível importar.');
const data=m.data;if(!Array.isArray(data?.lines)||data.lines.length>20000)throw Error('Estrutura da cifra inválida.');const result=convertLines(data.lines);if(!result.trim())throw Error('Nenhuma cifra identificada.');original=result;song=String(data.title||'cifra-ipcvt');$('editor').value=result;render();status('Cifra importada: '+song+'. Confira as posições antes de copiar.')}catch(err){if(allowed&&pending===id)status(err.name==='AbortError'?'Tempo limite da consulta. Tente novamente.':err.message||'Falha ao consultar a origem.',true)}finally{clearTimeout(timer);if(pending===id){pending=null;$('import').disabled=false}}};
function render(){const value=$('editor').value,preview=$('preview');preview.replaceChildren();let count=0;for(const part of value.split(/(\[[^\]\n]+\])/g)){if(/^\[[^\]\n]+\]$/.test(part)){const span=document.createElement('span');const chord=/^\[[A-G](?:#|b|♯|♭)?(?:[0-9mMaAjJsSuUdDiIgGoO+°ºøΔ()#b♯♭,.\-]*)?(?:\/[A-G](?:#|b|♯|♭)?)?\]$/.test(part);span.className=chord?'chord':'part';span.textContent=part;preview.append(span);if(chord)count++}else preview.append(document.createTextNode(part))}$('count').textContent=count+' acordes';$('copy').disabled=!value.trim();$('txt').disabled=!value.trim();$('undo').disabled=!original||original===value}
$('editor').oninput=render;$('undo').onclick=()=>{if(allowed&&confirm('Restaurar a cifra importada e descartar edições?')){$('editor').value=original;render()}};$('clear').onclick=()=>{if(allowed&&(!$('editor').value||confirm('Limpar a cifra atual?'))){$('editor').value='';original='';render();status('Editor limpo.')}};
$('copy').onclick=async()=>{if(!allowed)return;try{await navigator.clipboard.writeText($('editor').value);status('Cifra copiada. Cole no aplicativo de louvor.')}catch{$('editor').focus();$('editor').select();status('Texto selecionado. Pressione Ctrl+C para copiar.',true)}};
function save(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500)}
$('txt').onclick=()=>{if(allowed)save(new Blob([$('editor').value],{type:'text/plain;charset=utf-8'}),song.replace(/[^\p{L}\p{N} _-]/gu,'').trim().slice(0,80)+'.txt')};
render();
startAuth();
