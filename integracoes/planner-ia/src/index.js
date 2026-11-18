import { AccessError, firebaseBearerToken, verifyFirebaseIdToken, readCommissionMembership } from './auth.js';
import { READABLE_COLLECTIONS, listPlannerDocuments } from './firestore-read.js';
const headers={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'Vary':'Authorization'
};
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers});
const collections=new Set(READABLE_COLLECTIONS);

// A injeção de dependências existe apenas para testes; produção usa tokens reais.
export function createHandler({verifyToken=verifyFirebaseIdToken,lookupMembership=readCommissionMembership,listItems=listPlannerDocuments}={}){
  return async function handle(request){
    const url=new URL(request.url);
    const path=url.pathname;
    if(path==='/health' && request.method==='GET')
      return json(200,{service:'ipcvt-planner-ia',status:'read-development',firestoreConnected:false,capabilitiesEnabled:[]});
    const kind = /^\/api\/([a-z]+)$/.exec(path)?.[1];
    const isSession = path==='/api/session';
    const isRead=Boolean(kind && collections.has(kind));
    if(!isSession && !isRead) return json(404,{error:'not_found'});
    if(request.method!=='GET') return json(405,{error:'method_not_allowed'});
    try {
      const token=firebaseBearerToken(request);
      const identity=await verifyToken(token);
      await lookupMembership(identity.email,token);
      if(isSession) return json(200,{
        authenticated:true,authorized:true,uid:identity.uid,email:identity.email,capabilities:['read']
      });
      return json(200,await listItems(kind,token,url.searchParams));
    } catch(error) {
      if(error instanceof AccessError) return json(error.status,{error:error.code});
      return json(503,{error:'service_unavailable'});
    }
  };
}
const handle=createHandler();
export default {fetch(request){return handle(request);}};
