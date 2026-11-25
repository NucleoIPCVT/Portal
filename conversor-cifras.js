import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getAuth,onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { getFirestore,doc,onSnapshot } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { hasPanelEntry } from './comissao-entrada.js?v=20261124-cifras-v1';
import { preparePaste, convertPrepared } from './conversor-cifras-core.js?v=20261124-colar-v7';
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
function gate(msg,loading=false){allowed=false;$('gate').hidden=false;$('app').hidden=true;setGateMessage(loading?'Verificando acesso':'Acesso ao conversor',msg);pending=null;prepared=null;$('paste-box').value='';$('source-info').textContent='';original='';$('editor').value='';render()}
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
      stop=onSnapshot(doc(db,'comissao_acessos',email),{includeMetadataChanges:true},snap=>{
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



let prepared=null;
function updateSourceInfo(){
 const p=prepared||preparePaste('', $('paste-box').value);
 $('source-info').textContent=(p.mode==='HTML'?'Formatação HTML reconhecida':'Texto com espaços preservados')+' · '+p.count+' acordes identificados';
}
function convertSource(){
 if(!allowed)return;
 try{
 const p=prepared||preparePaste('', $('paste-box').value);
 if(!p.display.trim())throw Error('Cole uma cifra no campo original.');
 if($('editor').value!==original&&$('editor').value&&!confirm('Substituir o resultado que foi editado?'))return;
 original=convertPrepared(p);$('editor').value=original;render();updateSourceInfo();
 status('Cifra convertida. Confira o alinhamento antes de copiar.');
 }catch(error){status(error.message,true)}
}
$('paste-box').addEventListener('paste',event=>{
 if(!allowed||!event.clipboardData)return;
 const html=event.clipboardData.getData('text/html'),text=event.clipboardData.getData('text/plain');
 if(!html&&!text)return;
 event.preventDefault();
 try{
 const p=preparePaste(html,text);
 if(!p.display.trim())throw Error('A área de transferência não contém texto de cifra.');
 prepared=p;$('paste-box').value=p.display;updateSourceInfo();status('Cifra colada. Confira os acordes e clique em Converter.');
 }catch(error){prepared=null;$('paste-box').value=text;updateSourceInfo();status('O HTML não pôde ser interpretado. O texto original foi preservado.',true)}
});
$('paste-box').addEventListener('input',()=>{prepared=null;updateSourceInfo()});
$('manual-convert').onclick=convertSource;
$('clear-source').onclick=()=>{if(!allowed)return;if($('paste-box').value&&!confirm('Limpar a cifra original?'))return;prepared=null;$('paste-box').value='';$('source-info').textContent='';status('Campo original limpo.');$('paste-box').focus()};
function render(){const value=$('editor').value,preview=$('preview');preview.replaceChildren();let count=0;for(const part of value.split(/(\[[^\]\n]+\])/g)){if(/^\[[^\]\n]+\]$/.test(part)){const span=document.createElement('span');const chord=/^\[[A-G](?:#|b|♯|♭)?(?:[0-9mMaAjJsSuUdDiIgGoO+°ºøΔ()#b♯♭,.\-]*)?(?:\/[A-G](?:#|b|♯|♭)?)?\]$/.test(part);span.className=chord?'chord':'part';span.textContent=part;preview.append(span);if(chord)count++}else preview.append(document.createTextNode(part))}$('count').textContent=count+' acordes';$('copy').disabled=!value.trim();$('txt').disabled=!value.trim();$('undo').disabled=!original||original===value}
$('editor').oninput=render;$('undo').onclick=()=>{if(allowed&&confirm('Restaurar a cifra importada e descartar edições?')){$('editor').value=original;render()}};$('clear').onclick=()=>{if(allowed&&(!$('editor').value||confirm('Limpar a cifra atual?'))){$('editor').value='';original='';render();status('Editor limpo.')}};
$('copy').onclick=async()=>{if(!allowed)return;try{await navigator.clipboard.writeText($('editor').value);status('Cifra copiada. Cole no aplicativo de louvor.')}catch{$('editor').focus();$('editor').select();status('Texto selecionado. Pressione Ctrl+C para copiar.',true)}};
function save(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500)}
$('txt').onclick=()=>{if(allowed)save(new Blob([$('editor').value],{type:'text/plain;charset=utf-8'}),'cifra-ipcvt.txt')};
render();
startAuth();
