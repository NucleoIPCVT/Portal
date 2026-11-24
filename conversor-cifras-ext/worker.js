function extractChart(){
 const root=document.querySelector('.cifra_cnt')||document.querySelector('#cifra')||document.querySelector('[data-testid="chord-sheet"]');
 const selectors='pre, .cifra_cnt, [data-testid="chord-sheet"], [class*="chordSheet"], [class*="ChordSheet"]';
 const candidates=[...new Set([...(root?[...root.querySelectorAll('pre'),root]:[]),...document.querySelectorAll(selectors)])].filter(e=>e.getClientRects().length);
 const mark='b,strong,[data-chord],.chord,[class*="chordName"],[class*="ChordName"]';
 const re=/^[A-G](?:#|b|♯|♭)?(?:[0-9mMaAjJsSuUdDiIgGoO+°ºøΔ()#b♯♭,.\-]*)?(?:\/[A-G](?:#|b|♯|♭)?)?$/;
 const score=e=>[...e.querySelectorAll(mark)].filter(n=>re.test(n.textContent.trim())).length;
 let chosen=candidates.sort((a,b)=>score(b)-score(a)||a.textContent.length-b.textContent.length)[0];
 if(!chosen||score(chosen)<2)return null;
 const lines=[{text:'',chords:[]}];
 const last=()=>lines[lines.length-1];
 function add(t){for(const [i,s] of t.replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').split('\n').entries()){if(i)lines.push({text:'',chords:[]});last().text+=s}}
 function nl(){if(last().text.length)lines.push({text:'',chords:[]})}
 function visit(node){if(node.nodeType===3){add(node.nodeValue||'');return}if(node.nodeType!==1)return;
 const e=node;if(e.matches('script,style,button,svg,[hidden],[aria-hidden="true"]'))return;
 if(e.tagName==='BR'){lines.push({text:'',chords:[]});return}
 const t=e.textContent.trim();if(e.matches(mark)&&re.test(t)){let raw=e.textContent.replace(/\u00a0/g,' ');last().chords.push({col:last().text.length+raw.indexOf(t),name:t});add(raw);return}
 const block=chosen.tagName!=='PRE'&&/^(DIV|P|SECTION|PRE|LI)$/.test(e.tagName);if(block)nl();for(const c of e.childNodes)visit(c);if(block)nl();
 }
 for(const c of chosen.childNodes)visit(c);
 if(lines.filter(l=>l.chords.length).length<1)return null;
 const title=document.querySelector('h1')?.innerText?.trim()||document.title;
 return {title,lines};
}
const allowed=u=>{try{const x=new URL(u);return x.protocol==='https:'&&['www.cifraclub.com.br','cifraclub.com.br'].includes(x.hostname)&&x.pathname.split('/').filter(Boolean).length>=2&&!x.username&&!x.password}catch{return false}};
chrome.runtime.onMessage.addListener((m,s,reply)=>{if(m?.type!=='ipcvt-cifra-import'||!s.url?.startsWith('https://nucleoipcvt.github.io/Portal/conversor-cifras.html')||!allowed(m.url))return false;(async()=>{let tab;try{tab=await chrome.tabs.create({url:m.url,active:false});for(let i=0;i<35;i++){await new Promise(r=>setTimeout(r,650));try{const [r]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:extractChart});if(r?.result){reply({ok:true,data:r.result});return}}catch{}}reply({ok:false,error:'Não encontrei a estrutura da cifra. Confira se o link abre normalmente no Cifra Club.'})}catch(e){reply({ok:false,error:String(e.message||e)})}finally{if(tab?.id)try{await chrome.tabs.remove(tab.id)}catch{}}})();return true});