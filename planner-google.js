const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const DISPLAY_TIME_ZONE = 'America/Sao_Paulo';

export const googleScopes = Object.freeze([
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
]);

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function calendarError(message, code, status) {
  const error = new Error(message);
  error.name = 'GoogleCalendarError';
  error.code = code;
  if (status !== undefined) error.status = status;
  return error;
}

function invalidResponse() {
  return calendarError('O Google Agenda enviou uma resposta inválida. Tente atualizar novamente.', 'GOOGLE_INVALID_RESPONSE');
}

function localDate(value) {
  const parts = Object.fromEntries(dateFormatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function addDays(value, amount) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

// Find the start of a civil date in the actual IANA zone, without assuming UTC-3.
function localDayStart(value) {
  const anchor = Date.parse(`${value}T00:00:00.000Z`);
  let low = anchor - 36 * 60 * 60 * 1000;
  let high = anchor + 36 * 60 * 60 * 1000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (localDate(middle) < value) low = middle + 1;
    else high = middle;
  }
  if (localDate(low) !== value) throw invalidResponse();
  return new Date(low).toISOString();
}

function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function queryRange(from, to) {
  const timeMin = dateOnly(from) ? localDayStart(from) : instant(from);
  // Date-only bounds are inclusive in the Planner; RFC3339 upper bounds are exclusive.
  const timeMax = dateOnly(to) ? localDayStart(addDays(to, 1)) : instant(to);
  if (!timeMin || !timeMax || Date.parse(timeMax) <= Date.parse(timeMin)) {
    throw calendarError('Selecione um período válido para importar os eventos.', 'GOOGLE_INVALID_RANGE');
  }
  return { timeMin, timeMax };
}

function responseError(status, payload) {
  const details = payload?.error;
  const reasons = [
    details?.status,
    ...(Array.isArray(details?.errors) ? details.errors.map(item => item?.reason) : []),
    ...(Array.isArray(details?.details) ? details.details.map(item => item?.reason) : []),
  ].filter(value => typeof value === 'string').join(' ').toLowerCase();
  const message = typeof details?.message === 'string' ? details.message.toLowerCase() : '';
  if (status === 401) {
    return calendarError('Sua conexão com o Google Agenda expirou. Clique em “Conectar Google Agenda” para autorizar novamente.', 'GOOGLE_AUTH_EXPIRED', status);
  }
  if (status === 403 && (/accessnotconfigured|service_disabled|servicedisabled|api_disabled/.test(reasons) || /api.*(?:disabled|has not been used)/.test(message))) {
    return calendarError('A API Google Agenda ainda não está habilitada no projeto Google. Peça ao administrador para habilitar a Calendar API e tente novamente.', 'GOOGLE_API_DISABLED', status);
  }
  if (status === 403 && /insufficientpermissions|access_token_scope_insufficient/.test(reasons)) {
    return calendarError('A conexão com o Google não autorizou a leitura das agendas. Reconecte e permita o acesso ao Google Agenda.', 'GOOGLE_SCOPE_MISSING', status);
  }
  if (status === 429 || /ratelimitexceeded|quotaexceeded|resource_exhausted/.test(reasons)) {
    return calendarError('O Google Agenda atingiu um limite temporário de consultas. Aguarde um pouco e tente novamente.', 'GOOGLE_RATE_LIMITED', status);
  }
  if (status === 403) {
    return calendarError('Esta conta não tem permissão para consultar a agenda. Confira o compartilhamento e as permissões do Google Agenda.', 'GOOGLE_FORBIDDEN', status);
  }
  if (status === 404) {
    return calendarError('A agenda selecionada não está disponível para esta conta. Confira se ela ainda está compartilhada com você.', 'GOOGLE_CALENDAR_UNAVAILABLE', status);
  }
  return calendarError('Não foi possível consultar o Google Agenda. Tente novamente em alguns instantes.', 'GOOGLE_REQUEST_FAILED', status);
}

async function sourceId(calendarId, eventId) {
  const source = new TextEncoder().encode(JSON.stringify([calendarId, eventId]));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', source);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function normalizeEvent(event, calendar) {
  if (!event || typeof event.id !== 'string' || !event.id) throw invalidResponse();
  const cancelled = event.status === 'cancelled';
  const normalized = {
    id: await sourceId(calendar.id, event.id),
    source: 'google',
    sourceCalendarId: calendar.id,
    sourceEventId: event.id,
    sourceKey: `google:${calendar.id}:${event.id}`,
    status: typeof event.status === 'string' ? event.status : 'confirmed',
    calendarName: typeof calendar.summary === 'string' ? calendar.summary : '',
  };
  // Google descriptions may contain HTML. Render these values as text in the UI.
  for (const [source, target] of [['summary', 'title'], ['description', 'description'], ['location', 'location'], ['htmlLink', 'htmlLink'], ['updated', 'sourceUpdatedAt'], ['recurringEventId', 'recurringEventId']]) {
    if (typeof event[source] === 'string') normalized[target] = event[source];
    else if (!cancelled) normalized[target] = '';
  }
  if (event.originalStartTime && typeof event.originalStartTime === 'object') {
    normalized.originalStartTime = {};
    for (const key of ['date', 'dateTime', 'timeZone']) {
      if (typeof event.originalStartTime[key] === 'string') normalized.originalStartTime[key] = event.originalStartTime[key];
    }
  } else if (!cancelled) normalized.originalStartTime = null;

  const start = event.start;
  const end = event.end;
  const allDay = typeof start?.date === 'string' || typeof end?.date === 'string';
  const timed = typeof start?.dateTime === 'string' || typeof end?.dateTime === 'string';
  if (allDay || timed) {
    normalized.allDay = allDay;
    normalized.timeZone = start?.timeZone || end?.timeZone || DISPLAY_TIME_ZONE;
  }
  if (allDay) {
    normalized.startAt = null;
    normalized.endAt = null;
    if (start?.date !== undefined) {
      if (!dateOnly(start.date)) throw invalidResponse();
      normalized.startDate = start.date;
    }
    if (end?.date !== undefined) {
      if (!dateOnly(end.date)) throw invalidResponse();
      normalized.endDate = addDays(end.date, -1);
    }
  } else if (timed) {
    if (start?.dateTime !== undefined) {
      normalized.startAt = instant(start.dateTime);
      if (!normalized.startAt) throw invalidResponse();
      normalized.startDate = localDate(normalized.startAt);
    }
    if (end?.dateTime !== undefined) {
      normalized.endAt = instant(end.dateTime);
      if (!normalized.endAt) throw invalidResponse();
      const endMillis = Date.parse(normalized.endAt);
      const startMillis = normalized.startAt ? Date.parse(normalized.startAt) : -Infinity;
      normalized.endDate = localDate(endMillis > startMillis ? endMillis - 1 : endMillis);
    }
  }
  // Cancellation tombstones omit unknown fields, preserving details during an upsert.
  return normalized;
}

export class GoogleCalendarClient {
  #token;
  #fetchImpl;

  constructor(token, { fetchImpl = globalThis.fetch } = {}) {
    if (typeof token !== 'string' || !token.trim()) {
      throw calendarError('Conecte sua conta ao Google Agenda antes de importar.', 'GOOGLE_TOKEN_MISSING');
    }
    if (typeof fetchImpl !== 'function') throw new TypeError('É necessário um cliente HTTP para consultar o Google Agenda.');
    this.#token = token;
    this.#fetchImpl = fetchImpl.bind(globalThis);
  }

  async #get(url) {
    let response;
    try {
      response = await this.#fetchImpl(url.toString(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.#token}`, Accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch {
      throw calendarError('Não foi possível acessar o Google Agenda. Confira sua conexão e tente novamente.', 'GOOGLE_NETWORK_ERROR');
    }
    let payload;
    try { payload = await response.json(); } catch { /* Never expose provider response text. */ }
    if (!response.ok) throw responseError(response.status, payload);
    if (!payload || typeof payload !== 'object' || (payload.items !== undefined && !Array.isArray(payload.items))) throw invalidResponse();
    return payload;
  }

  async #pages(path, parameters) {
    const items = [];
    const seenTokens = new Set();
    let pageToken;
    do {
      const url = new URL(`${CALENDAR_API}${path}`);
      for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const page = await this.#get(url);
      items.push(...(page.items || []));
      if (page.nextPageToken !== undefined && typeof page.nextPageToken !== 'string') throw invalidResponse();
      pageToken = page.nextPageToken;
      if (pageToken && seenTokens.has(pageToken)) throw invalidResponse();
      if (pageToken) seenTokens.add(pageToken);
    } while (pageToken);
    return items;
  }

  async listCalendars() {
    const items = await this.#pages('/users/me/calendarList', { showHidden: 'true', maxResults: '250' });
    const calendars = new Map();
    for (const item of items) {
      if (item?.deleted) continue;
      if (typeof item?.id !== 'string' || !item.id) throw invalidResponse();
      calendars.set(item.id, {
        id: item.id,
        summary: typeof item.summary === 'string' ? item.summary : '',
        backgroundColor: typeof item.backgroundColor === 'string' ? item.backgroundColor : '',
        accessRole: typeof item.accessRole === 'string' ? item.accessRole : '',
      });
    }
    return [...calendars.values()];
  }

  async readEvents(calendar, { from, to } = {}) {
    if (typeof calendar?.id !== 'string' || !calendar.id) {
      throw calendarError('Selecione uma agenda para importar os eventos.', 'GOOGLE_CALENDAR_MISSING');
    }
    if (['freeBusyReader', 'none'].includes(calendar.accessRole)) {
      throw calendarError('Esta agenda compartilha apenas disponibilidade. Peça permissão para ver os detalhes dos eventos antes de importar.', 'GOOGLE_CALENDAR_NO_DETAIL_ACCESS');
    }
    const range = queryRange(from, to);
    const items = await this.#pages(`/calendars/${encodeURIComponent(calendar.id)}/events`, {
      ...range,
      singleEvents: 'true',
      showDeleted: 'true',
      timeZone: DISPLAY_TIME_ZONE,
      maxResults: '2500',
    });
    const events = new Map();
    for (const item of items) {
      const normalized = await normalizeEvent(item, calendar);
      events.set(normalized.sourceKey, normalized);
    }
    return [...events.values()];
  }
}
