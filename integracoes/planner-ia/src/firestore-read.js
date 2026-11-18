import { AccessError, PROJECT_ID } from './auth.js';

export const READABLE_COLLECTIONS = Object.freeze(['plans','buckets','tasks','events','routines','activity']);
const kinds = new Set(READABLE_COLLECTIONS);
const ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/comissao_planner/main/`;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;

export function parseReadOptions(searchParams) {
  for (const key of searchParams.keys()) {
    if (key !== 'pageSize' && key !== 'pageToken') throw new AccessError(400, 'invalid_query');
    if (searchParams.getAll(key).length > 1) throw new AccessError(400, 'invalid_query');
  }
  const rawSize = searchParams.get('pageSize');
  const pageSize = rawSize === null ? DEFAULT_PAGE_SIZE : Number(rawSize);
  if ((rawSize !== null && !/^[1-9]\d{0,2}$/.test(rawSize)) || !Number.isInteger(pageSize)
      || pageSize < 1 || pageSize > MAX_PAGE_SIZE) throw new AccessError(400, 'invalid_page_size');
  const pageToken = searchParams.get('pageToken') || '';
  if (pageToken.length > 2048 || /[\x00-\x1F\x7F]/.test(pageToken)) throw new AccessError(400, 'invalid_page_token');
  return { pageSize, pageToken };
}

function fromFirestoreValue(value, depth = 0) {
  if (depth > 18 || !value || typeof value !== 'object' || Array.isArray(value)) throw new AccessError(503,'invalid_firestore_response');
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('referenceValue' in value) return value.referenceValue;
  if ('bytesValue' in value) return value.bytesValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) {
    const n = Number(value.integerValue);
    return Number.isSafeInteger(n) ? n : String(value.integerValue);
  }
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('geoPointValue' in value) return value.geoPointValue;
  if ('arrayValue' in value) {
    const vals = value.arrayValue?.values ?? [];
    if (!Array.isArray(vals) || vals.length > 200) throw new AccessError(503,'invalid_firestore_response');
    return vals.map(v => fromFirestoreValue(v,depth+1));
  }
  if ('mapValue' in value) return fromFirestoreFields(value.mapValue?.fields ?? {},depth+1);
  throw new AccessError(503,'invalid_firestore_response');
}
function fromFirestoreFields(fields,depth=0) {
  if (!fields || typeof fields!=='object' || Array.isArray(fields) || Object.keys(fields).length > 120)
    throw new AccessError(503,'invalid_firestore_response');
  const output = Object.create(null);
  for (const [key, value] of Object.entries(fields)) output[key] = fromFirestoreValue(value,depth+1);
  return output;
}
export function deserializeDocument(document,kind) {
  const prefix=`projects/${PROJECT_ID}/databases/(default)/documents/comissao_planner/main/${kind}/`;
  if (!document || typeof document.name!=='string' || !document.name.startsWith(prefix))
    throw new AccessError(503,'invalid_firestore_response');
  const id=document.name.slice(prefix.length);
  if (!id || id.includes('/') || id.length > 200) throw new AccessError(503,'invalid_firestore_response');
  const fields=fromFirestoreFields(document.fields ?? {});
  return { ...fields, id };
}

export async function listPlannerDocuments(kind,token,searchParams,{fetchImpl=fetch}={}) {
  if (!kinds.has(kind)) throw new AccessError(404,'not_found');
  const {pageSize,pageToken}=parseReadOptions(searchParams);
  const endpoint=new URL(ROOT+kind);
  endpoint.searchParams.set('pageSize',String(pageSize));
  if (pageToken) endpoint.searchParams.set('pageToken',pageToken);
  let response;
  try {
    response=await fetchImpl(endpoint.toString(),{
      method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      signal:AbortSignal.timeout(8000)
    });
  } catch { throw new AccessError(503,'firestore_unavailable'); }
  if (response.status===401 || response.status===403) throw new AccessError(403,'not_authorized');
  if (!response.ok) throw new AccessError(503,'firestore_unavailable');
  let body;
  try { body=await response.json(); } catch { throw new AccessError(503,'invalid_firestore_response'); }
  if (!body || typeof body !== 'object' || (body.documents!==undefined && !Array.isArray(body.documents))
      || (body.nextPageToken!==undefined && typeof body.nextPageToken!=='string'))
    throw new AccessError(503,'invalid_firestore_response');
  const docs=body.documents??[];
  if (docs.length > pageSize) throw new AccessError(503,'invalid_firestore_response');
  const items=docs.map(doc=>deserializeDocument(doc,kind));
  return {kind,items,pageSize,nextPageToken:body.nextPageToken||null,hasMore:Boolean(body.nextPageToken)};
}
