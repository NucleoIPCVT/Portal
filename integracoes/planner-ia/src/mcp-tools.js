// Núcleo das ferramentas MCP. NUNCA executar sem verificação OAuth + Firebase do usuário.
import { TASK_QUERY_DESCRIPTORS, isPlannerDate, plannerToday, queryAssignees, queryDeadlines, readTaskPages } from './task-queries.js';
export const TOOL_DESCRIPTORS=Object.freeze([
 {name:'listar_planos',description:'Lista planos; use nextPageToken para próximas páginas.',inputSchema:{type:'object',properties:{pageSize:{type:'integer',minimum:1,maximum:50},pageToken:{type:'string'}},additionalProperties:false}},
 {name:'listar_buckets',description:'Lista etapas/buckets dos planos.',inputSchema:{type:'object',properties:{pageSize:{type:'integer',minimum:1,maximum:50},pageToken:{type:'string'}},additionalProperties:false}},
 {name:'listar_demandas',description:'Lista demandas, responsáveis, status, prazos e dependências.',inputSchema:{type:'object',properties:{pageSize:{type:'integer',minimum:1,maximum:50},pageToken:{type:'string'}},additionalProperties:false}},
 {name:'listar_eventos',description:'Lista eventos internos do Planner (não inclui fontes públicas iCal).',inputSchema:{type:'object',properties:{pageSize:{type:'integer',minimum:1,maximum:50},pageToken:{type:'string'}},additionalProperties:false}},
 {name:'consultar_atrasos',description:'Resume demandas atrasadas no fuso de São Paulo; indica se resultado é parcial.',inputSchema:{type:'object',properties:{apenasMinhas:{type:'boolean'},maximoResultados:{type:'integer',minimum:1,maximum:100}},additionalProperties:false}},
 {name:'preparar_criacao',description:'Prepara uma criação sem salvar; exige confirmação humana externa antes de qualquer gravação.',inputSchema:{type:'object',properties:{tipo:{type:'string',enum:['plans','buckets','tasks']},rascunho:{type:'object'},chaveIdempotencia:{type:'string',minLength:16,maxLength:128}},required:['tipo','rascunho','chaveIdempotencia'],additionalProperties:false}},
 ...TASK_QUERY_DESCRIPTORS
]);
const CATALOG=new Set(TOOL_DESCRIPTORS.map(t=>t.name));
const LIST_TYPES={listar_planos:'plans',listar_buckets:'buckets',listar_demandas:'tasks',listar_eventos:'events'};
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
 const today = plannerToday(clock);
 const demandas = [];
 let count = 0;
 const page = await readTaskPages(list, task => {
   if (task.deleted || task.status === 'done' || !isPlannerDate(task.dueDate) || task.dueDate >= today) return;
   const mine = Array.isArray(task.assignees) && task.assignees.some(person => typeof person?.email === 'string' && person.email.toLowerCase() === identity.email.toLowerCase());
   if (options.apenasMinhas && !mine) return;
   count++;
   if (demandas.length < max) demandas.push({ id: task.id, title: task.title, planId: task.planId, dueDate: task.dueDate, status: task.status, assignees: task.assignees ?? [] });
 });
 const total = page.resultadoCompleto ? { quantidadeAtrasadas: count } : { quantidadeAtrasadasParcial: count };
 return { ...page, ...total, hoje: today, fuso: 'America/Sao_Paulo', exibidas: demandas.length, demandas };
}
export function createMcpTools({list,preview,identity,clock}={}){
 if(typeof list!=='function'||typeof preview!=='function'||typeof identity?.email!=='string')throw new Error('MCP requer contexto autenticado.');
 return {catalog:TOOL_DESCRIPTORS,async execute(name,args={}){
  if(!CATALOG.has(name))bad('Ferramenta desconhecida.');
  if(Object.hasOwn(LIST_TYPES,name))return list(LIST_TYPES[name],pagination(args));
  if(name==='consultar_atrasos')return calculateOverdue({list,identity,options:args,clock});
  if(name==='consultar_prazos')return queryDeadlines(list,args);
  if(name==='consultar_responsaveis')return queryAssignees(list,args,clock);
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
