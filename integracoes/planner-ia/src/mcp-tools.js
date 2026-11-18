// Núcleo das ferramentas MCP. NUNCA executar sem verificação OAuth + Firebase do usuário.
export const TOOL_DESCRIPTORS=Object.freeze([
 {name:'listar_planos',description:'Lista planos; use nextPageToken para próximas páginas.',inputSchema:{type:'object',properties:{pageSize:{type:'integer',minimum:1,maximum:50},pageToken:{type:'string'}},additionalProperties:false}},
 {name:'listar_buckets',description:'Lista etapas/buckets dos planos.',inputSchema:{type:'object',properties:{pageSize:{type:'integer',minimum:1,maximum:50},pageToken:{type:'string'}},additionalProperties:false}},
 {name:'listar_demandas',description:'Lista demandas, responsáveis, status, prazos e dependências.',inputSchema:{type:'object',properties:{pageSize:{type:'integer',minimum:1,maximum:50},pageToken:{type:'string'}},additionalProperties:false}},
 {name:'listar_eventos',description:'Lista eventos internos do Planner (não inclui fontes públicas iCal).',inputSchema:{type:'object',properties:{pageSize:{type:'integer',minimum:1,maximum:50},pageToken:{type:'string'}},additionalProperties:false}},
 {name:'consultar_atrasos',description:'Resume demandas atrasadas no fuso de São Paulo; indica se resultado é parcial.',inputSchema:{type:'object',properties:{apenasMinhas:{type:'boolean'},maximoResultados:{type:'integer',minimum:1,maximum:100}},additionalProperties:false}},
 {name:'preparar_criacao',description:'Prepara uma criação sem salvar; exige confirmação humana externa antes de qualquer gravação.',inputSchema:{type:'object',properties:{tipo:{type:'string',enum:['plans','buckets','tasks']},rascunho:{type:'object'},chaveIdempotencia:{type:'string',minLength:16,maxLength:128}},required:['tipo','rascunho','chaveIdempotencia'],additionalProperties:false}}
]);
const CATALOG=new Set(TOOL_DESCRIPTORS.map(t=>t.name));
const LIST_TYPES={listar_planos:'plans',listar_buckets:'buckets',listar_demandas:'tasks',listar_eventos:'events'};
const MAX_PAGES=20;
function bad(message){const e=new Error(message);e.code='invalid_arguments';throw e;}
function object(value){if(!value||typeof value!=='object'||Array.isArray(value))bad('Argumentos inválidos.');}
function keys(value,allowed){object(value);if(Object.keys(value).some(k=>!allowed.includes(k)))bad('Argumentos desconhecidos.');}
function pagination(input){
 keys(input,['pageSize','pageToken']);
 const pageSize=input.pageSize??25,pageToken=input.pageToken??'';
 if(!Number.isInteger(pageSize)||pageSize<1||pageSize>50||typeof pageToken!=='string'||pageToken.length>2048)bad('Paginação inválida.');
 return {pageSize,pageToken};
}
export async function calculateOverdue({list,identity,options={},clock=()=>new Date()}={}){
 keys(options,['apenasMinhas','maximoResultados']);
 if(options.apenasMinhas!==undefined&&typeof options.apenasMinhas!=='boolean')bad('Filtro inválido.');
 const max=options.maximoResultados??50;
 if(!Number.isInteger(max)||max<1||max>100)bad('Limite inválido.');
 if(typeof identity?.email!=='string')throw new Error('Identidade ausente.');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(clock());
 const seen=new Set(),out=[];let count=0,scanned=0,cursor='';
 for(let page=0;page<MAX_PAGES;page++){
  const r=await list('tasks',{pageSize:50,pageToken:cursor});
  if(!r||!Array.isArray(r.items))throw new Error('Leitura incompleta do Planner.');
  scanned+=r.items.length;
  for(const task of r.items){
   const due=typeof task.dueDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate)?task.dueDate:'';
   const mine=Array.isArray(task.assignees)&&task.assignees.some(p=>typeof p?.email==='string'&&p.email.toLowerCase()===identity.email.toLowerCase());
   if(!due||due>=today||task.deleted||task.status==='done'||options.apenasMinhas&&!mine)continue;
   count++;
   if(out.length<max)out.push({id:task.id,title:task.title,planId:task.planId,dueDate:due,status:task.status,assignees:task.assignees??[]});
  }
  const next=r.nextPageToken||'';
  if(!next)return {hoje:today,fuso:'America/Sao_Paulo',quantidadeAtrasadas:count,exibidas:out.length,demandas:out,registrosLidos:scanned,resultadoCompleto:true};
  if(typeof next!=='string'||seen.has(next))throw new Error('Paginação inválida.');
  seen.add(next);cursor=next;
 }
 return {hoje:today,fuso:'America/Sao_Paulo',quantidadeAtrasadasParcial:count,exibidas:out.length,demandas:out,registrosLidos:scanned,resultadoCompleto:false,aviso:'Limite de leitura atingido; contagem parcial.'};
}
export function createMcpTools({list,preview,identity,clock}={}){
 if(typeof list!=='function'||typeof preview!=='function'||typeof identity?.email!=='string')throw new Error('MCP requer contexto autenticado.');
 return {catalog:TOOL_DESCRIPTORS,async execute(name,args={}){
  if(!CATALOG.has(name))bad('Ferramenta desconhecida.');
  if(Object.hasOwn(LIST_TYPES,name))return list(LIST_TYPES[name],pagination(args));
  if(name==='consultar_atrasos')return calculateOverdue({list,identity,options:args,clock});
  if(name==='preparar_criacao'){
   keys(args,['tipo','rascunho','chaveIdempotencia']);
   if(!['plans','buckets','tasks'].includes(args.tipo)||typeof args.chaveIdempotencia!=='string'||!/^[-_A-Za-z0-9]{16,128}$/.test(args.chaveIdempotencia))bad('Pedido inválido.');
   object(args.rascunho);
   const result=await preview(args.tipo,{draft:args.rascunho,idempotencyKey:args.chaveIdempotencia});
   return {...result,gravado:false,confirmacaoHumanaObrigatoria:true};
  }
  bad('Ferramenta indisponível.');
 }};
}
