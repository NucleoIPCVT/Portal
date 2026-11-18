import { AccessError, firebaseBearerToken, verifyFirebaseIdToken, readCommissionMembership } from './auth.js';
const headers={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer'
};
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers});
// Injeção de dependências apenas para testes; exportação padrão usa serviços reais.
export function createHandler({verifyToken=verifyFirebaseIdToken,lookupMembership=readCommissionMembership}={}){
  return async function handle(request){
    const pathname=new URL(request.url).pathname;
    if(pathname==='/health'&&request.method==='GET')
      return json(200,{service:'ipcvt-planner-ia',status:'auth-development',firestoreConnected:false,capabilitiesEnabled:[]});
    if(pathname!=='/api/session')return json(404,{error:'not_found'});
    if(request.method!=='GET')return json(405,{error:'method_not_allowed'});
    try{
      const token=firebaseBearerToken(request);
      const identity=await verifyToken(token);
      await lookupMembership(identity.email,token);
      return json(200,{authenticated:true,authorized:true,uid:identity.uid,email:identity.email,capabilities:[]});
    }catch(error){
      if(error instanceof AccessError)return json(error.status,{error:error.code});
      return json(503,{error:'service_unavailable'});
    }
  };
}
const handle=createHandler();
export default {fetch(request){return handle(request);}};
