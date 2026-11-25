function convertLines(lines){
 const gap=' '.repeat(14), out=[]; const chordLine=l=>l&&Array.isArray(l.chords)&&l.chords.length>0;
 function instrumental(l){let s=l.text.split('');for(const c of l.chords)for(let j=c.col;j<c.col+c.name.length;j++)s[j]=' ';const rest=s.join('');return rest.slice(section(rest)?.[0].length||0,repeat(rest)?.index??rest.length).replace(/[\s()|]+/g,'')==='';}
 function tokens(cs){return cs.map(c=>'['+c.name+']').join(gap)}
 for(let i=0;i<lines.length;i++){
  const l=lines[i];if(!chordLine(l)){out.push(l.text.trimEnd());continue}
  const cs=l.chords.slice().sort((a,b)=>a.col-b.col);
  if(!instrumental(l)){let s=l.text;for(const c of cs.slice().reverse())s=s.slice(0,c.col)+'['+c.name+']'+s.slice(c.col+c.name.length);out.push(s.trimEnd());continue}
  const label=section(l.text)?.[1]?.trim(),rep=repeat(l.text)?.[1];
  const next=lines[i+1];
  if(label||rep){if(label)out.push(label);out.push(tokens(cs)+(rep?' '+rep:''));continue}
  if(!next||chordLine(next)||!next.text.trim()||section(next.text)||/^\s*(?:Tom|Capo|Afinação|Key)\s*:/i.test(next.text)||/^\s*(?:\[|[eEABDG]\s*[\|\-]|[()]*$)/.test(next.text)){out.push(tokens(cs));continue}
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
function clean(raw){return String(raw||'').replace(/\r\n?/g,'\n').replace(/[\u200b-\u200f\u2060\ufeff\u00ad]/g,'').replace(/[\u00a0\u202f\u2000-\u200a\u3000]/g,' ')}
function section(text){return text.match(/^\s*(\[(?![A-G](?:[#b♯♭])?\])[^\]]+\]|(?:INTRO(?:DUÇÃO)?|SOLO|INSTRUMENTAL|INTERLÚDIO|PONTE|FINAL|REFRÃO|VERSO(?:\s+\d+)?|ESTROFE(?:\s+\d+)?)(?=\s|:|$)\s*:?)\s*/i)}
function repeat(text){return text.match(/\s*(\(\s*\d+\s*[xX×]\s*\)|\d+\s*[xX×])\s*$/)}
function compactParagraphs(lines){
 const gaps=[];let last=-1;for(let i=0;i<lines.length;i++)if(lines[i].text.trim()){if(last>=0)gaps.push(i-last-1);last=i}
 const positive=gaps.filter(n=>n>0);if(gaps.length<3||positive.length/gaps.length<.8)return lines;
 const base=Math.min(...positive),out=[];let blank=0;for(const l of lines){if(!l.text.trim()){blank++;continue}if(out.length)for(let i=0;i<Math.max(0,blank-base);i++)out.push({text:'',chords:[]});out.push(l);blank=0}return out;
}
function plainLines(raw){
 return compactParagraphs(clean(raw).split('\n').map(line=>{
  let text='';for(const char of line.replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g,(_,a,b)=>a??b)){text+=char==='\t'?' '.repeat(8-text.length%8):char}
  const label=section(text)?.[0]||'';
  const rest=text.slice(label.length,repeat(text)?.index??text.length);
  const matches=[...rest.matchAll(/[^\s|]+/g)].map(m=>{let name=m[0],off=0;if(/^[()\[\]{}]+$/.test(name))return null;while(!isChord(name)&&/^[([{]/.test(name)){name=name.slice(1);off++}while(!isChord(name)&&/[)\]}]$/.test(name))name=name.slice(0,-1);return {name,col:label.length+m.index+off}}).filter(Boolean);
  const chords=matches.length&&matches.every(m=>isChord(m.name))?matches:[];
  return {text,chords};
 }));
}
function htmlLines(raw){
 const template=document.createElement('template');template.innerHTML=raw;
 const root=template.content;
 for(const node of root.querySelectorAll('script,style,svg,iframe,object,button,img,[hidden],[aria-hidden="true"]'))node.remove();
 const mark='b,strong,[data-chord],.chord,[class*="chordName"],[class*="ChordName"],span[style*="font-weight: bold"],span[style*="font-weight: 700"],span[style*="font-weight:bold"],span[style*="font-weight:700"]';
 const score=e=>[...e.querySelectorAll(mark)].filter(n=>isChord(n.textContent.trim())).length;
 const blocks=[...root.querySelectorAll('pre,.cifra_cnt,#cifra,[data-testid="chord-sheet"]')].filter(e=>score(e)>0);
 const selected=blocks.sort((a,b)=>score(b)-score(a)||a.textContent.length-b.textContent.length)[0]||root;
 const lines=[{text:'',chords:[]}];const current=()=>lines[lines.length-1];
 function add(raw){for(const ch of clean(raw)){if(ch==='\n')lines.push({text:'',chords:[]});else current().text+=ch==='\t'?' '.repeat(8-current().text.length%8):ch}}
 function newline(){if(current().text.length)lines.push({text:'',chords:[]})}
 function visit(node){if(node.nodeType===3){add(node.nodeValue||'');return}if(node.nodeType!==1)return;
 const e=node;if(e.tagName==='BR'){add('\n');return}
 const raw=clean(e.textContent),name=raw.trim();if(e.matches(mark)&&isChord(name)){const lead=raw.slice(0,raw.indexOf(name));add(lead);current().chords.push({col:current().text.length,name});add(name);add(raw.slice(raw.indexOf(name)+name.length));return}
 const block=/^(DIV|P|SECTION|PRE|LI|TR)$/.test(e.tagName);if(block)newline();for(const child of e.childNodes)visit(child);if(block)newline();
 }
 for(const child of selected.childNodes)visit(child);
 // Require real markup, not a guess based on a single bold note.
 const marked=lines.reduce((sum,l)=>sum+l.chords.length,0);
 if(marked<1)return null;
 // Recover chord-only lines where the clipboard stripped some bold markup.
 return compactParagraphs(lines.map(l=>l.chords.length?l:(plainLines(l.text)[0]||{text:'',chords:[]})));
}
function convertClipboard(html,text){
 let lines=null,mode='HTML';
 if(html&&html.length<=2000000)try{lines=htmlLines(html)}catch{}
 const plain=plainLines(text||'');
 if(!lines||(!lines.some(l=>!l.chords.length&&l.text.trim())&&plain.some(l=>!l.chords.length&&l.text.trim()))){mode='texto';lines=plain}
 if(lines.length>20000||lines.reduce((n,l)=>n+l.text.length,0)>500000)throw Error('Seleção muito grande. Copie somente a cifra.');
 const count=lines.reduce((n,l)=>n+l.chords.length,0);
 if(count<1)throw Error('Não encontrei acordes suficientes. Selecione somente o bloco completo da cifra no Cifra Club, incluindo os acordes, e copie novamente.');
 const result=convertLines(lines);if(!result.trim())throw Error('A seleção está vazia.');
 return {result,mode,count};
}
function preparePaste(html,text){
 const raw=clean(text);
 let rich=null;
 if(html&&html.length<=2000000)try{rich=htmlLines(html)}catch{}
 const plain=plainLines(raw);
 const score=l=>l.reduce((n,x)=>n+x.chords.length,0);
 // Prefer the plain clipboard for spacing unless the HTML preserves at least as many notes and comparable lyric text.
 const lyricSize=l=>l.filter(x=>!x.chords.length).map(x=>x.text.replace(/\s/g,'')).join('').length;
 let lines=plain,mode='texto';
 if(rich&&score(rich)>score(plain)&&(!raw||lyricSize(rich)>=lyricSize(plain)*0.85)){lines=rich;mode='HTML'}
 const display=lines.map(l=>l.text).join('\n').replace(/^\n+|\n+$/g,'');
 return {lines,display,mode,count:score(lines)};
}
function convertPrepared(prepared){
 const {lines,count}=prepared;
 if(lines.length>20000||lines.reduce((n,l)=>n+l.text.length,0)>500000)throw Error('Seleção muito grande. Copie somente a cifra.');
 if(!count)throw Error('Não encontrei acordes em linhas separadas. Confira se os acordes vieram junto com a letra e ajuste o texto original.');
 return convertLines(lines);
}
export { plainLines, htmlLines, convertClipboard, preparePaste, convertPrepared, isChord };

