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
