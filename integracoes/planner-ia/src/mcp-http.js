import { TOOL_DESCRIPTORS } from './mcp-tools.js';
const VERSION='2025-11-25';
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const fail=(id,code,message)=>({jsonrpc:'2.0',id,error:{code,message}});
const ok=(id,value)=>({jsonrpc:'2.0',id,result:value});
const rpcId=v=>typeof v==='string'&&v.length<=128||Number.isSafeInteger(v);
export async function handleMcpMessage(msg,{tools}={}){
 if(!msg||typeof msg!=='object'||Array.isArray(msg)||msg.jsonrpc!=='2.0'||typeof msg.method!=='string')return fail(null,-32600,'Invalid request');
 if(msg.method==='notifications/initialized'&&msg.id===undefined)return null;
 if(!rpcId(msg.id))return fail(null,-32600,'Invalid request id');
 const id=msg.id;
 if(msg.method==='initialize')return ok(id,{protocolVersion:VERSION,capabilities:{tools:{listChanged:false}},serverInfo:{name:'IPCVT Planner',version:'0.1.0'},instructions:'Somente consulta e prévia. Não diga que um registro foi criado após a prévia.'});
 if(msg.method==='ping')return ok(id,{});
 if(msg.method==='tools/list')return ok(id,{tools:TOOL_DESCRIPTORS});
 if(msg.method==='tools/call'){
  const name=msg.params?.name,args=msg.params?.arguments??{};
  if(typeof name!=='string'||!TOOL_DESCRIPTORS.some(t=>t.name===name))return fail(id,-32602,'Unknown tool');
  try {
   const data=await tools.execute(name,args);
   return ok(id,{content:[{type:'text',text:JSON.stringify(data)}],isError:false});
  }catch(err){
   return ok(id,{content:[{type:'text',text:err?.code==='invalid_arguments'?'Argumentos inválidos.':'Não foi possível completar a consulta.'}],isError:true});
  }
 }
 return fail(id,-32601,'Method not found');
}
export async function handleMcpHttp(request,{tools,allowedOrigins=[]}={}){
 const origin=request.headers.get('origin');
 if(origin&&!allowedOrigins.includes(origin))return new Response('',{status:403,headers});
 if(request.method!=='POST')return new Response('',{status:405,headers:{...headers,Allow:'POST'}});
 if(!request.headers.get('content-type')?.startsWith('application/json'))return new Response('',{status:415,headers});
 const accept=request.headers.get('accept')||'';
 if(!accept.includes('application/json')&&!accept.includes('text/event-stream'))return new Response('',{status:406,headers});
 if(Number(request.headers.get('content-length')||0)>26000)return new Response('',{status:413,headers});
 const reader=request.body?.getReader();
 if(!reader)return new Response(JSON.stringify(fail(null,-32700,'Parse error')),{status:400,headers});
 const chunks=[];let total=0;
 for(;;){
  const {value,done}=await reader.read();
  if(done)break;
  total+=value.byteLength;
  if(total>26000){await reader.cancel();return new Response('',{status:413,headers});}
  chunks.push(value);
 }
 const bytes=new Uint8Array(total);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 let raw;
 try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
 catch{return new Response(JSON.stringify(fail(null,-32700,'Parse error')),{status:400,headers});}
 let message;
 try{message=JSON.parse(raw);}catch{return new Response(JSON.stringify(fail(null,-32700,'Parse error')),{status:400,headers});}
 if(Array.isArray(message))return new Response(JSON.stringify(fail(null,-32600,'Batch not supported')),{status:400,headers});
 const reply=await handleMcpMessage(message,{tools});
 if(reply===null)return new Response(null,{status:202,headers});
 return new Response(JSON.stringify(reply),{status:200,headers});
}
