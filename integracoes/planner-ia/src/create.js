import { AccessError, PROJECT_ID } from './auth.js';

const KINDS = new Set(['plans', 'buckets', 'tasks']);
const FIRESTORE_ROOT = `projects/${PROJECT_ID}/databases/(default)/documents`;
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/;
const KEY_RE = /^[A-Za-z0-9_-]{16,128}$/;
const MAIL_RE = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;
const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

function invalid() { throw new AccessError(400, 'invalid_draft'); }
function record(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const own = Object.keys(value);
  if (own.some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) invalid();
}
function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) invalid();
  return value.trim();
}
function date(value) {
  if (value === '' || value == null) return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid();
  const t = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(t.valueOf()) || t.toISOString().slice(0, 10) !== value) invalid();
  return value;
}
function validateDates(startDate, dueDate) {
  if (startDate && dueDate && startDate > dueDate) invalid();
}
function id(value, allowEmpty = false) {
  if (allowEmpty && value === '') return '';
  if (typeof value !== 'string' || !ID_RE.test(value)) invalid();
  return value;
}
function people(items = []) {
  if (!Array.isArray(items) || items.length > 10) invalid();
  return items.map(item => {
    record(item, ['email', 'name']);
    const email = text(item.email ?? '', 254).toLowerCase();
    const name = text(item.name ?? '', 120);
    if ((!email && !name) || (email && !MAIL_RE.test(email))) invalid();
    return { email, name };
  });
}
function checklist(items = []) {
  if (!Array.isArray(items) || items.length > 20) invalid();
  return items.map(item => {
    record(item, ['text'], ['text']);
    return { id: crypto.randomUUID(), text: text(item.text, 300, true), done: false };
  });
}
function dependencies(items = []) {
  if (!Array.isArray(items) || items.length > 20) invalid();
  const list = items.map(item => id(item));
  if (new Set(list).size !== list.length) invalid();
  return list;
}
export function validateDraft(kind, input) {
  if (!KINDS.has(kind)) throw new AccessError(404, 'not_found');
  if (kind === 'plans') {
    record(input, ['name', 'kind', 'description', 'startDate', 'dueDate'], ['name']);
    const name = text(input.name, 100, true);
    const type = input.kind ?? 'project';
    if (!['project', 'continuous'].includes(type)) invalid();
    const startDate = date(input.startDate ?? '');
    const dueDate = date(input.dueDate ?? '');
    validateDates(startDate, dueDate);
    return { name, kind: type, description: text(input.description ?? '', 5000), startDate, dueDate, deleted: false };
  }
  if (kind === 'buckets') {
    record(input, ['planId', 'name', 'order'], ['planId', 'name']);
    const order = input.order ?? 0;
    if (!Number.isInteger(order) || order < 0 || order > 10000) invalid();
    return { planId: id(input.planId), name: text(input.name, 80, true), order, deleted: false };
  }
  record(input, ['planId', 'bucketId', 'title', 'description', 'team', 'assignees', 'startDate', 'dueDate', 'priority', 'checklist', 'dependencyIds', 'eventId'], ['planId', 'title']);
  const startDate = date(input.startDate ?? '');
  const dueDate = date(input.dueDate ?? '');
  validateDates(startDate, dueDate);
  return {
    planId: id(input.planId), bucketId: id(input.bucketId ?? '', true), title: text(input.title, 160, true),
    description: text(input.description ?? '', 10000), team: text(input.team ?? '', 120),
    assignees: people(input.assignees), startDate, dueDate,
    status: 'todo', priority: (() => { const priority = input.priority ?? 'normal'; if (!PRIORITIES.has(priority)) invalid(); return priority; })(),
    checklist: checklist(input.checklist), dependencyIds: dependencies(input.dependencyIds),
    eventId: id(input.eventId ?? '', true), dateMode: 'manual', dueOffsetDays: null, deleted: false
  };
}
// Canonicalizacao e ID estavel: o mesmo pedido nao cria registros duplicados.
// Checklist IDs sao aleatorios no formato, mas devem ser deterministicos entre preview e commit.
export async function sha256Hex(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2,'0')).join('');
}
export function validateCreateRequest(body) {
  record(body, ['draft', 'idempotencyKey', 'approval'], ['draft', 'idempotencyKey']);
  if (typeof body.idempotencyKey !== 'string' || !KEY_RE.test(body.idempotencyKey)) invalid();
  return { draft: body.draft, idempotencyKey: body.idempotencyKey, approval: body.approval };
}
export async function normalizeDraft(kind, draft, key) {
  const output = validateDraft(kind, draft);
  if (kind === 'tasks') {
    for (let i = 0; i < output.checklist.length; ++i) {
      const hex = await sha256Hex(`${key}:checklist:${i}`);
      output.checklist[i].id = `ia_check_${hex.slice(0,32)}`;
    }
  }
  return output;
}
export async function draftHash(normalized) { return sha256Hex(JSON.stringify(normalized)); }
export async function stableDocumentId(uid, kind, idempotencyKey) {
  if (!KINDS.has(kind) || !KEY_RE.test(idempotencyKey)) invalid();
  const hash = await sha256Hex(`${uid}\n${kind}\n${idempotencyKey}`);
  return `ia_${kind.slice(0,-1)}_${hash.slice(0,48)}`;
}
function firestoreValue(input) {
  if (input === null) return { nullValue: null };
  if (typeof input === 'string') return { stringValue: input };
  if (typeof input === 'boolean') return { booleanValue: input };
  if (Number.isSafeInteger(input)) return { integerValue: String(input) };
  if (Array.isArray(input)) return { arrayValue: { values: input.map(firestoreValue) } };
  if (input && typeof input === 'object') return { mapValue: { fields: firestoreFields(input) } };
  invalid();
}
function firestoreFields(data) {
  return Object.fromEntries(Object.entries(data).map(([k,v]) => [k, firestoreValue(v)]));
}
// So documentos NOVOS. O Firestore rejeita replays via currentDocument.exists=false.
// Grava registro E auditoria juntos em um commit atomico.
export async function createPlannerDocument(kind, normalized, identity, idempotencyKey, token, {fetchImpl = fetch} = {}) {
  if (!KINDS.has(kind)) throw new AccessError(404, 'not_found');
  const docId = await stableDocumentId(identity.uid, kind, idempotencyKey);
  const auditId = `audit_${docId}`;
  const planId = kind === 'plans' ? docId : normalized.planId;
  const activity = {
    entityType: kind, entityId: docId, title: String(normalized.title || normalized.name).slice(0,160),
    action: 'created', origin: 'automatic', actor: identity.email, actorUid: identity.uid,
    planId, team: normalized.team ?? '', dueDate: normalized.dueDate ?? '', changes: []
  };
  const docName = `${FIRESTORE_ROOT}/comissao_planner/main/${kind}/${docId}`;
  const activityName = `${FIRESTORE_ROOT}/comissao_planner/main/activity/${auditId}`;
  const payload = {
    writes: [
      {
        update: { name: docName, fields: firestoreFields({ ...normalized, version: 1, createdBy: identity.email, updatedBy: identity.email }) },
        updateTransforms: [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }
        ], currentDocument: { exists: false }
      },
      {
        update: { name: activityName, fields: firestoreFields(activity) },
        updateTransforms: [{ fieldPath: 'timestamp', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { exists: false }
      }
    ]
  };
  let response;
  try {
    response = await fetchImpl(`https://firestore.googleapis.com/v1/${FIRESTORE_ROOT}:commit`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(8000)
    });
  } catch { throw new AccessError(503, 'firestore_unavailable'); }
  if (response.status === 409 || response.status === 412) throw new AccessError(409, 'duplicate_or_conflict');
  if ([401,403].includes(response.status)) throw new AccessError(403, 'not_authorized');
  if (!response.ok) throw new AccessError(503, 'firestore_write_failed');
  return { created: true, kind, id: docId, auditId };
}
