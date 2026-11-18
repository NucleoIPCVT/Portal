import { AccessError, firebaseBearerToken, verifyFirebaseIdToken, readCommissionMembership } from './auth.js';
import { READABLE_COLLECTIONS, listPlannerDocuments } from './firestore-read.js';
import { validateCreateRequest, normalizeDraft, draftHash, createPlannerDocument } from './create.js';
import { verifyApprovalReceipt } from './approval.js';
const headers = {
  'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer', 'Vary':'Authorization'
};
const json = (status,value) => new Response(JSON.stringify(value),{status,headers});
const collections = new Set(READABLE_COLLECTIONS);
const writable = new Set(['plans','buckets','tasks']);
async function readBody(request) {
  if (Number(request.headers.get('content-length') || 0) > 26000) throw new AccessError(413,'payload_too_large');
  if (!request.body) throw new AccessError(400,'invalid_body');
  const reader = request.body.getReader();
  const chunks=[];let total=0;
  for (;;) {
    const {value,done} = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 26000) { await reader.cancel(); throw new AccessError(413,'payload_too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);let offset=0;
  for (const chunk of chunks) { bytes.set(chunk,offset);offset+=chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
  catch { throw new AccessError(400,'invalid_body'); }
}
export function createHandler({ verifyToken=verifyFirebaseIdToken, lookupMembership=readCommissionMembership,
  listItems=listPlannerDocuments, createRecord=createPlannerDocument,
  checkApproval=verifyApprovalReceipt }={}) {
  return async function handle(request,env={}) {
    const url=new URL(request.url),path=url.pathname;
    if (path==='/health' && request.method==='GET')
      return json(200,{service:'ipcvt-planner-ia',status:'creation-development',firestoreConnected:false,capabilitiesEnabled:[]});
    const kind = /^\/api\/([a-z]+)$/.exec(path)?.[1];
    const previewKind=/^\/api\/preview\/(plans|buckets|tasks)$/.exec(path)?.[1];
    const createKind=/^\/api\/create\/(plans|buckets|tasks)$/.exec(path)?.[1];
    const isSession=path==='/api/session',isRead=Boolean(kind&&collections.has(kind));
    if (!isSession && !isRead && !previewKind && !createKind) return json(404,{error:'not_found'});
    if ((isSession || isRead) ? request.method!=='GET' : request.method!=='POST')
      return json(405,{error:'method_not_allowed'});
    try {
      const token=firebaseBearerToken(request);
      const identity=await verifyToken(token);
      await lookupMembership(identity.email,token);
      if (isSession) return json(200,{
        authenticated:true,authorized:true,uid:identity.uid,email:identity.email,capabilities:['read','preview_creation']
      });
      if (isRead) return json(200,await listItems(kind,token,url.searchParams));
      const body=validateCreateRequest(await readBody(request));
      const kindToUse=previewKind||createKind;
      const draft=await normalizeDraft(kindToUse,body.draft,body.idempotencyKey);
      const digest=await draftHash(draft);
      if (previewKind) return json(200,{kind:kindToUse,draft,draftHash:digest,idempotencyKey:body.idempotencyKey,
        persisted:false,requiresHumanApproval:true});
      // Nenhuma IA pode emitir recibos de aprovacao. Sem aprovador humano integrado,
      // este endpoint permanece tecnicamente desligado, mesmo com token Google valido.
      await checkApproval(body.approval,{
        uid:identity.uid,email:identity.email,kind:kindToUse,idempotencyKey:body.idempotencyKey,draftHash:digest
      },env.APPROVAL_SECRET);
      return json(201,await createRecord(kindToUse,draft,identity,body.idempotencyKey,token));
    }catch(error){
      if(error instanceof AccessError) return json(error.status,{error:error.code});
      return json(503,{error:'service_unavailable'});
    }
  };
}
const handle=createHandler();
export default {fetch(request,env){return handle(request,env);}};
