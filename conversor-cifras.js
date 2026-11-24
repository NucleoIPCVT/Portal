import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getAuth,onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { getFirestore,doc,onSnapshot } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { hasPanelEntry } from './comissao-entrada.js?v=20261124-cifras-v1';
import { convertClipboard } from './conversor-cifras-core.js?v=20261124-clipboard-v1';
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
function gate(msg,loading=false){allowed=false;$('gate').hidden=false;$('app').hidden=true;setGateMessage(loading?'Verificando acesso':'Acesso ao conversor',msg);pending=null;$('import').disabled=false;$('workspace').hidden=true;$('paste-fallback').hidden=true;$('paste-box').value='';original='';$('editor').value='';render()}
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

function sourceUrl(){const u=new URL($('url').value.trim());if(u.protocol!=='https:'||!['cifraclub.com.br','www.cifraclub.com.br'].includes(u.hostname)||u.port||u.username||u.password||u.pathname.split('/').filter(Boolean).length<2)throw Error('Informe um link HTTPS de uma música do Cifra Club.');return u}
$('form').onsubmit=e=>{e.preventDefault();if(!allowed)return;try{const url=sourceUrl();window.open(url.href,'_blank','noopener,noreferrer');$('clipboard-help').hidden=false;status('Na nova aba, escolha a versão e o tom, selecione a cifra completa e copie (Ctrl+C). Depois volte aqui.')}catch(err){status(err.message,true)}};
function applyClipboard(html,text){
 if(!allowed)return;
 if($('editor').value!==original&&$('editor').value&&!confirm('Substituir a cifra que está sendo editada?'))return;
 try{const data=convertClipboard(html,text);original=data.result;try{song=sourceUrl().pathname.split('/').filter(Boolean).at(-1)||'cifra-ipcvt'}catch{song='cifra-ipcvt'}
 $('editor').value=original;$('workspace').hidden=false;$('paste-fallback').hidden=true;$('paste-box').value='';render();
 status(data.mode==='HTML'?'Cifra convertida pelo HTML original. Confira a posição dos acordes.':'Cifra convertida pelo texto copiado. Confira o alinhamento: a área de transferência não forneceu marcações HTML.');
 $('workspace').scrollIntoView({behavior:'smooth',block:'start'});
 }catch(err){status(err.message,true)}
}
function fallback(){if(!allowed)return;$('paste-fallback').hidden=false;$('paste-box').focus();status('O navegador não liberou a leitura automática. Pressione Ctrl+V no campo abaixo; ele também aproveita o HTML copiado, quando disponível.',true)}
$('import').onclick=async()=>{if(!allowed||pending)return;const id=Symbol();pending=id;$('import').disabled=true;
 try{let html='',text='';if(navigator.clipboard?.read){try{for(const item of await navigator.clipboard.read()){if(!html&&item.types.includes('text/html'))html=await (await item.getType('text/html')).text();if(!text&&item.types.includes('text/plain'))text=await (await item.getType('text/plain')).text();if(html||text)break}}catch{}}if(!html&&!text&&navigator.clipboard?.readText)try{text=await navigator.clipboard.readText()}catch{}
 if(!allowed||pending!==id)return;if(html||text)applyClipboard(html,text);else fallback();
 }catch{fallback()}finally{if(pending===id){pending=null;$('import').disabled=false}}};
$('paste-box').addEventListener('paste',event=>{if(!allowed)return;const data=event.clipboardData;if(!data)return;event.preventDefault();applyClipboard(data.getData('text/html'),data.getData('text/plain'))});
$('manual-convert').onclick=()=>applyClipboard('',$('paste-box').value);
$('manual-open').onclick=()=>{if(allowed){$('workspace').hidden=false;$('editor').focus()}};
function render(){const value=$('editor').value,preview=$('preview');preview.replaceChildren();let count=0;for(const part of value.split(/(\[[^\]\n]+\])/g)){if(/^\[[^\]\n]+\]$/.test(part)){const span=document.createElement('span');const chord=/^\[[A-G](?:#|b|♯|♭)?(?:[0-9mMaAjJsSuUdDiIgGoO+°ºøΔ()#b♯♭,.\-]*)?(?:\/[A-G](?:#|b|♯|♭)?)?\]$/.test(part);span.className=chord?'chord':'part';span.textContent=part;preview.append(span);if(chord)count++}else preview.append(document.createTextNode(part))}$('count').textContent=count+' acordes';$('copy').disabled=!value.trim();$('txt').disabled=!value.trim();$('undo').disabled=!original||original===value}
$('editor').oninput=render;$('undo').onclick=()=>{if(allowed&&confirm('Restaurar a cifra importada e descartar edições?')){$('editor').value=original;render()}};$('clear').onclick=()=>{if(allowed&&(!$('editor').value||confirm('Limpar a cifra atual?'))){$('editor').value='';original='';render();status('Editor limpo.')}};
$('copy').onclick=async()=>{if(!allowed)return;try{await navigator.clipboard.writeText($('editor').value);status('Cifra copiada. Cole no aplicativo de louvor.')}catch{$('editor').focus();$('editor').select();status('Texto selecionado. Pressione Ctrl+C para copiar.',true)}};
function save(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500)}
$('txt').onclick=()=>{if(allowed)save(new Blob([$('editor').value],{type:'text/plain;charset=utf-8'}),song.replace(/[^\p{L}\p{N} _-]/gu,'').trim().slice(0,80)+'.txt')};
render();
startAuth();
