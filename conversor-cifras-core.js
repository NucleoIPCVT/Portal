function convertLines(lines){
 const gap=' '.repeat(14), out=[]; const chordLine=l=>l&&Array.isArray(l.chords)&&l.chords.length>0;
 function instrumental(l){let s=l.text.split('');for(const c of l.chords)for(let j=c.col;j<c.col+c.name.length;j++)s[j]=' ';return s.join('').replace(/[\s()|]+/g,'')===''||/^\s*\[[^\]]+\]\s*$/.test(s.join('').trim());}
 function tokens(cs){return cs.map(c=>'['+c.name+']').join(gap)}
 for(let i=0;i<lines.length;i++){
  const l=lines[i];if(!chordLine(l)){out.push(l.text.trimEnd());continue}
  const cs=l.chords.slice().sort((a,b)=>a.col-b.col);
  if(!instrumental(l)){let s=l.text;for(const c of cs.slice().reverse())s=s.slice(0,c.col)+'['+c.name+']'+s.slice(c.col+c.name.length);out.push(s.trimEnd());continue}
  const label=l.text.match(/^\s*(\[[^\]]+\])/)?.[1];
  const next=lines[i+1];
  if(label){out.push(label);out.push(tokens(cs));continue}
  if(!next||chordLine(next)||!next.text.trim()||/^\s*(?:\[|[eEABDG]\s*[\|\-]|[()]*$)/.test(next.text)){out.push(tokens(cs));continue}
  let text=next.text.trimEnd(), inserts=new Map(), tail=[];
  for(const c of cs){let p=Math.max(0,c.col);if(p>=text.length){tail.push(c);continue}while(p<text.length&&/\s/.test(text[p]))p++;if(p>=text.length){tail.push(c);continue}if(!inserts.has(p))inserts.set(p,[]);inserts.get(p).push(c)}
  let s='';for(let j=0;j<text.length;j++){if(inserts.has(j))s+=tokens(inserts.get(j));s+=text[j]}
  if(tail.length)s+=' '+tokens(tail);out.push(s.trim());i++;
 }
 return out.join('\n').trim();
}
export { convertLines };

const chordPattern=/^[A-G](?:[#b♯♭])?(?:(?:maj|min|dim|aug|sus|add|omit|no|M|m|º|°|ø|Δ|[0-9+#b♯♭(),.\-])+)?(?:\/(?:[A-G](?:[#b♯♭])?|[0-9]+))?$/i;
const isChord=s=>/^[A-G]/.test(s)&&chordPattern.test(s);
function plainLines(raw){
 return raw.replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').split('\n').map(line=>{
  let text='';for(const char of line){text+=char==='\t'?' '.repeat(8-text.length%8):char}
  const label=text.match(/^\s*\[[^\]]+\]/)?.[0]||'';
  const rest=text.slice(label.length);
  const matches=[...rest.matchAll(/[^\s|]+/g)].map(m=>{const name=m[0].replace(/^[([]+|[\]]+$/g,'');return {name,col:label.length+m.index+m[0].indexOf(name)}});
  // Parentheses around instrumental sequences are separate from chord extensions.
  const clean=matches.map((m,i)=>{let name=m.name;if(!isChord(name)&&name.endsWith(')')&&isChord(name.slice(0,-1)))name=name.slice(0,-1);return {...m,name}}).filter(m=>m.name&&m.name!==')');
  const chords=clean.length&&clean.every(m=>isChord(m.name))?clean:[];
  return {text,chords};
 });
}
function htmlLines(raw){
 const template=document.createElement('template');template.innerHTML=raw;
 const root=template.content;
 for(const node of root.querySelectorAll('script,style,svg,iframe,object,button,img,[hidden],[aria-hidden="true"]'))node.remove();
 const mark='b,strong,[data-chord],.chord,[class*="chordName"],[class*="ChordName"]';
 const score=e=>[...e.querySelectorAll(mark)].filter(n=>isChord(n.textContent.trim())).length;
 const blocks=[...root.querySelectorAll('pre,.cifra_cnt,#cifra,[data-testid="chord-sheet"]')].filter(e=>score(e)>0);
 const selected=blocks.sort((a,b)=>score(b)-score(a)||a.textContent.length-b.textContent.length)[0]||root;
 const lines=[{text:'',chords:[]}];const current=()=>lines[lines.length-1];
 function add(raw){for(const ch of raw.replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ')){if(ch==='\n')lines.push({text:'',chords:[]});else current().text+=ch==='\t'?' '.repeat(8-current().text.length%8):ch}}
 function newline(){if(current().text.length)lines.push({text:'',chords:[]})}
 function visit(node){if(node.nodeType===3){add(node.nodeValue||'');return}if(node.nodeType!==1)return;
 const e=node;if(e.tagName==='BR'){add('\n');return}
 const raw=e.textContent.replace(/\u00a0/g,' '),name=raw.trim();if(e.matches(mark)&&isChord(name)){const lead=raw.slice(0,raw.indexOf(name));add(lead);current().chords.push({col:current().text.length,name});add(name);add(raw.slice(raw.indexOf(name)+name.length));return}
 const block=/^(DIV|P|SECTION|PRE|LI|TR)$/.test(e.tagName);if(block)newline();for(const child of e.childNodes)visit(child);if(block)newline();
 }
 for(const child of selected.childNodes)visit(child);
 // Require real markup, not a guess based on a single bold note.
 const marked=lines.reduce((sum,l)=>sum+l.chords.length,0);
 if(marked<2)return null;
 // Recover chord-only lines where the clipboard stripped some bold markup.
 return lines.map(l=>l.chords.length?l:plainLines(l.text)[0]);
}
function convertClipboard(html,text){
 let lines=null,mode='HTML';
 if(html&&html.length<=2000000)try{lines=htmlLines(html)}catch{}
 if(!lines){mode='texto';lines=plainLines(text||'')}
 if(lines.length>20000||lines.reduce((n,l)=>n+l.text.length,0)>500000)throw Error('Seleção muito grande. Copie somente a cifra.');
 const count=lines.reduce((n,l)=>n+l.chords.length,0);
 if(count<2)throw Error('Não encontrei acordes suficientes. Selecione somente o bloco completo da cifra no Cifra Club, incluindo os acordes, e copie novamente.');
 const result=convertLines(lines);if(!result.trim())throw Error('A seleção está vazia.');
 return {result,mode,count};
}
export { plainLines, htmlLines, convertClipboard };
